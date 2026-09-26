import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Spinner } from '@/components/ui'
import { fullDate, today } from '@/lib/format'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Day = RouterOutputs['event']['calendar'][number]
type Mode = 'solar' | 'lunar'

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  DEATH_ANNIVERSARY: { icon: '🕯', color: '#7c3aed', label: 'Ngày giỗ' },
  BIRTHDAY: { icon: '🎂', color: '#db2777', label: 'Sinh nhật' },
  OTHER: { icon: '📌', color: '#0891b2', label: 'Sự kiện' },
}

const pad = (n: number) => String(n).padStart(2, '0')
const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`
/** 0 = thứ 2 … 6 = chủ nhật */
const dow = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

export default function CalendarPage() {
  const t = today()
  const [mode, setMode] = useState<Mode>('solar')
  const [ym, setYm] = useState({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) })
  const [lunar, setLunar] = useState<{ year: number; month: number; leap: boolean } | null>(null)
  const [selected, setSelected] = useState<string>(t)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Lịch</h1>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
          {([['solar', 'Dương lịch'], ['lunar', 'Âm lịch']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className="rounded-lg px-3 py-1 text-xs font-semibold transition"
              style={mode === id ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'solar' ? (
        <SolarMonth ym={ym} setYm={setYm} selected={selected} onSelect={setSelected} today={t} />
      ) : (
        <LunarMonth lunar={lunar} setLunar={setLunar} selected={selected} onSelect={setSelected} today={t} />
      )}
    </div>
  )
}

// ---------- tháng dương, ghi chú ngày âm ----------

function SolarMonth({ ym, setYm, selected, onSelect, today: t }: {
  ym: { y: number; m: number }; setYm: (v: { y: number; m: number }) => void
  selected: string; onSelect: (d: string) => void; today: string
}) {
  const from = `${ym.y}-${pad(ym.m)}-01`
  const lastDay = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()
  const to = `${ym.y}-${pad(ym.m)}-${pad(lastDay)}`
  const q = trpc.event.calendar.useQuery({ from, to })
  const shift = (n: number) => {
    const d = new Date(Date.UTC(ym.y, ym.m - 1 + n, 1))
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
  }
  const days = q.data ?? []
  const first = days[0]
  const last = days.at(-1)
  const lunarSpan = first && last
    ? first.lunar.month === last.lunar.month
      ? `tháng ${first.lunar.month}${first.lunar.leap ? ' nhuận' : ''} năm ${first.lunar.year} âm lịch`
      : `tháng ${first.lunar.month}${first.lunar.leap ? 'n' : ''} – ${last.lunar.month}${last.lunar.leap ? 'n' : ''} âm lịch`
    : ''

  return (
    <>
      <MonthNav
        title={`Tháng ${ym.m} / ${ym.y}`}
        subtitle={lunarSpan}
        onPrev={() => shift(-1)}
        onNext={() => shift(1)}
        onToday={() => { setYm({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) }); onSelect(t) }}
      />
      {q.isLoading ? <Spinner /> : (
        <Grid
          leading={first ? dow(first.date) : 0}
          days={days}
          selected={selected}
          today={t}
          onSelect={onSelect}
          big={(d) => String(Number(d.date.slice(8, 10)))}
          small={(d) => d.lunar.day === 1 ? `${d.lunar.day}/${d.lunar.month}${d.lunar.leap ? 'n' : ''}` : String(d.lunar.day)}
          smallStrong={(d) => d.lunar.day === 1 || d.lunar.day === 15}
        />
      )}
      <DayDetail day={days.find((d) => d.date === selected)} />
    </>
  )
}

// ---------- tháng âm, ghi chú ngày dương ----------

function LunarMonth({ lunar, setLunar, selected, onSelect, today: t }: {
  lunar: { year: number; month: number; leap: boolean } | null
  setLunar: (v: { year: number; month: number; leap: boolean }) => void
  selected: string; onSelect: (d: string) => void; today: string
}) {
  // chưa chọn tháng âm nào → lấy tháng âm của hôm nay qua lịch dương
  const seed = trpc.event.calendar.useQuery({ from: t, to: t }, { enabled: !lunar })
  const current = lunar ?? (seed.data?.[0] ? { year: seed.data[0].lunar.year, month: seed.data[0].lunar.month, leap: seed.data[0].lunar.leap } : null)
  const q = trpc.event.lunarCalendar.useQuery(current!, { enabled: Boolean(current) })
  if (!current || q.isLoading) return <Spinner />
  const data = q.data
  if (!data) return null

  return (
    <>
      <MonthNav
        title={`Tháng ${current.month}${current.leap ? ' nhuận' : ''} năm ${current.year} (âm)`}
        subtitle={`${data.length} ngày · ${fmtShort(data.from)} → ${fmtShort(data.to)} dương lịch`}
        onPrev={() => setLunar(data.prev)}
        onNext={() => setLunar(data.next)}
        onToday={() => {
          const d0 = seed.data?.[0]
          if (d0) setLunar({ year: d0.lunar.year, month: d0.lunar.month, leap: d0.lunar.leap })
          onSelect(t)
        }}
      />
      <Grid
        leading={dow(data.from)}
        days={data.days}
        selected={selected}
        today={t}
        onSelect={onSelect}
        big={(d) => String(d.lunar.day)}
        small={(d) => `${Number(d.date.slice(8, 10))}/${Number(d.date.slice(5, 7))}`}
        smallStrong={(d) => d.date.endsWith('-01')}
      />
      <DayDetail day={data.days.find((d) => d.date === selected)} />
    </>
  )
}

function fmtShort(date: string) {
  return `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`
}

// ---------- phần dùng chung ----------

function MonthNav({ title, subtitle, onPrev, onNext, onToday }: { title: string; subtitle: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <button className="btn btn-ghost !px-3" onClick={onPrev} aria-label="Tháng trước">‹</button>
      <div className="flex-1 text-center">
        <p className="font-bold">{title}</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{subtitle}</p>
      </div>
      <button className="btn btn-ghost !px-3" onClick={onNext} aria-label="Tháng sau">›</button>
      <button className="btn btn-ghost !px-3 text-xs" onClick={onToday}>Hôm nay</button>
    </div>
  )
}

function Grid({ leading, days, selected, today: t, onSelect, big, small, smallStrong }: {
  leading: number; days: Day[]; selected: string; today: string; onSelect: (d: string) => void
  big: (d: Day) => string; small: (d: Day) => string; smallStrong: (d: Day) => boolean
}) {
  return (
    <Card className="p-2 sm:p-3">
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
        {WEEKDAYS.map((w, i) => <span key={w} style={i === 6 ? { color: 'var(--danger)' } : undefined}>{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leading }, (_, i) => <span key={`lead${i}`} />)}
        {days.map((d) => {
          const isToday = d.date === t
          const isSel = d.date === selected
          const sunday = dow(d.date) === 6
          return (
            <button
              key={d.date}
              onClick={() => onSelect(d.date)}
              className="flex min-h-14 flex-col items-stretch rounded-lg px-1 py-1 text-left transition sm:min-h-[4.5rem]"
              style={{
                background: isSel ? 'var(--brand-soft)' : 'var(--surface-2)',
                outline: isToday ? '2px solid var(--brand)' : 'none',
                outlineOffset: -2,
              }}
              aria-label={fullDate(d.date)}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className="text-sm font-bold leading-none" style={{ color: sunday ? 'var(--danger)' : isToday ? 'var(--brand)' : undefined }}>{big(d)}</span>
                <span className="text-[10px] leading-none" style={{ color: smallStrong(d) ? 'var(--brand)' : 'var(--muted)', fontWeight: smallStrong(d) ? 700 : 400 }}>{small(d)}</span>
              </span>
              <span className="mt-1 flex flex-col gap-0.5">
                {d.events.slice(0, 2).map((e) => {
                  const m = TYPE_META[e.type] ?? TYPE_META.OTHER!
                  // ngày giữa/cuối của sự kiện dài: bỏ icon, thêm dấu nối để thấy nó tiếp diễn
                  const cont = e.dayCount > 1 && e.dayIndex > 1
                  return (
                    <span
                      key={e.occurrenceId}
                      className="truncate rounded px-1 text-[10px] leading-4 text-white"
                      style={{ background: m.color, opacity: cont ? 0.72 : 1 }}
                      title={`${e.title}${e.dayCount > 1 ? ` (ngày ${e.dayIndex}/${e.dayCount})` : ''}`}
                    >
                      {cont ? '↳' : m.icon} {e.title}
                    </span>
                  )
                })}
                {d.events.length > 2 && <span className="text-[10px]" style={{ color: 'var(--muted)' }}>+{d.events.length - 2}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function DayDetail({ day }: { day: Day | undefined }) {
  if (!day) return null
  const l = day.lunar
  return (
    <Card className="mt-3 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="font-semibold">{fullDate(day.date)}</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {l.day}/{l.month}{l.leap ? ' (nhuận)' : ''} âm lịch · năm {l.year}
        </p>
      </div>
      {day.events.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Không có sự kiện. <Link to="/su-kien" className="underline">Thêm ngày lễ / sự kiện</Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {day.events.map((e) => {
            const m = TYPE_META[e.type] ?? TYPE_META.OTHER!
            return (
              <li key={e.occurrenceId} className="flex items-center gap-3 text-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base" style={{ background: `color-mix(in srgb, ${m.color} 18%, transparent)` }}>{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {e.title}
                    {e.dayCount > 1 && (
                      <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--muted)' }}>
                        ngày {e.dayIndex}/{e.dayCount}
                      </span>
                    )}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {[
                      m.label,
                      e.endDate ? `${dm(e.startDate)} → ${dm(e.endDate)}` : null,
                      e.startTime ? (e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime) : null,
                      e.calendar === 'LUNAR' ? 'theo âm lịch' : 'theo dương lịch',
                      e.note || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

