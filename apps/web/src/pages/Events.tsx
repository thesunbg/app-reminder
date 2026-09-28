import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { fullDate, today, weekdayShort } from '@/lib/format'
import { holidayMeta, holidaySpan, lunarLabel } from '@/lib/holidays'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Calendar = 'LUNAR' | 'LUNAR_MONTHLY' | 'SOLAR'
type EventType = 'DEATH_ANNIVERSARY' | 'BIRTHDAY' | 'OTHER'

const TYPE_META: Record<EventType, { label: string; icon: string; color: string }> = {
  DEATH_ANNIVERSARY: { label: 'Ngày giỗ', icon: '🕯', color: '#7c3aed' },
  BIRTHDAY: { label: 'Sinh nhật', icon: '🎂', color: '#db2777' },
  OTHER: { label: 'Sự kiện', icon: '📌', color: '#0891b2' },
}

const CALENDAR_TABS: Array<[Calendar, string]> = [
  ['SOLAR', 'Dương lịch'],
  ['LUNAR', 'Âm lịch (giỗ)'],
  ['LUNAR_MONTHLY', 'Mùng 1 · Rằm'],
]

/** "Mùng 1", "Ngày rằm", hay "Ngày 10 âm" — cách người Việt thật sự gọi. */
export function lunarDayLabel(day: number): string {
  if (day === 1) return 'Mùng 1'
  if (day === 15) return 'Ngày rằm'
  return `Ngày ${day} âm`
}

const PRESET_REMIND: Array<{ label: string; days: number[] }> = [
  { label: '7 · 3 · 1 · đúng ngày', days: [7, 3, 1, 0] },
  { label: '30 · 7 · đúng ngày', days: [30, 7, 0] },
  { label: '3 · đúng ngày', days: [3, 0] },
  { label: 'chỉ đúng ngày', days: [0] },
]

function daysLabel(n: number): string {
  if (n === 0) return 'Hôm nay'
  if (n === 1) return 'Ngày mai'
  return `Còn ${n} ngày`
}

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`

/** "3/10" hoặc "3/10 → 4/10" cho sự kiện nhiều ngày. */
function spanLabel(start: string, end: string | null | undefined): string {
  return end ? `${dm(start)} → ${dm(end)}` : dm(start)
}

/** "07:00" / "07:00–17:00" / "" — giờ sự kiện diễn ra, không phải giờ nhắc. */
function timeLabel(startTime: string | null | undefined, endTime: string | null | undefined): string {
  if (!startTime) return ''
  return endTime ? `${startTime}–${endTime}` : startTime
}

export default function Events() {
  const utils = trpc.useUtils()
  const list = trpc.event.list.useQuery()
  const upcoming = trpc.event.upcoming.useQuery({ days: 180 })
  // Đi từ lịch sang ("+ Thêm sự kiện ngày 3/10") thì mở sẵn form với ngày đó.
  const [params, setParams] = useSearchParams()
  const fromCalendar = params.get('ngay')
  const [open, setOpen] = useState(Boolean(fromCalendar))

  const remove = trpc.event.remove.useMutation({
    onSuccess: () => {
      void utils.event.list.invalidate()
      void utils.event.upcoming.invalidate()
      void utils.notify.recent.invalidate()
    },
  })

  const refresh = () => {
    setOpen(false)
    // xoá tham số đi, nếu không bấm "+ Thêm" lần sau lại nhảy về ngày cũ
    if (fromCalendar) setParams({}, { replace: true })
    void utils.event.list.invalidate()
    void utils.event.upcoming.invalidate()
    void utils.notify.upcomingCount.invalidate()
  }

  const next = upcoming.data ?? []

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Ngày lễ & sự kiện</h1>
        <button className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Đóng' : '+ Thêm'}
        </button>
      </div>

      {open && <EventForm key={fromCalendar ?? 'moi'} presetDate={fromCalendar} onDone={refresh} />}

      {(list.isLoading || upcoming.isLoading) && <Spinner />}

      {next.length > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Sắp tới</h2>
          <ul className="flex flex-col gap-3">
            {next.slice(0, 8).map((o) => {
              const meta = TYPE_META[o.event.type as EventType]
              return (
                <li key={o.id} className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                      {weekdayShort(o.solarDate)}
                    </span>
                    <span className="text-sm font-bold leading-none">{dm(o.solarDate)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {meta.icon} {o.event.title}
                    </p>
                    <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                      {[
                        o.endDate ? `${spanLabel(o.solarDate, o.endDate)} · ${o.dayCount} ngày` : null,
                        timeLabel(o.event.startTime, o.event.endTime) || null,
                        o.lunar
                          ? `${o.lunar.day}/${o.lunar.month}${o.lunar.leap ? ' nhuận' : ''} âm lịch`
                          : 'dương lịch',
                        o.event.calendar === 'LUNAR_MONTHLY' ? 'hàng tháng' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold"
                    style={
                      o.ongoing || o.daysUntil <= 3
                        ? { background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }
                        : { color: 'var(--muted)' }
                    }
                  >
                    {o.ongoing
                      ? o.dayCount > 1
                        ? `Đang diễn ra · ngày ${o.dayIndex}/${o.dayCount}`
                        : 'Đang diễn ra'
                      : daysLabel(o.daysUntil)}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <HolidaySection />

      <h2 className="mb-2 mt-4 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
        Của nhà mình ({list.data?.length ?? 0})
      </h2>
      <ul className="flex flex-col gap-2">
        {(list.data ?? []).map((e) => {
          const meta = TYPE_META[e.type as EventType]
          return (
            <li key={e.id} className="card flex items-center gap-3 px-3 py-3">
              <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {meta.icon} {e.title}
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                  {e.calendar === 'LUNAR_MONTHLY'
                    ? `${lunarDayLabel(e.lunarDay ?? 1)} hàng tháng (âm lịch)`
                    : e.calendar === 'LUNAR'
                    ? `${e.lunarDay}/${e.lunarMonth}${e.lunarLeap ? ' nhuận' : ''} âm lịch`
                    : `${e.solarDate?.slice(-5).split('-').reverse().join('/')}${
                        e.endDate ? ` → ${e.endDate.slice(-5).split('-').reverse().join('/')}` : ''
                      } ${e.yearly ? 'hàng năm' : 'một lần'}`}
                  {timeLabel(e.startTime, e.endTime) && ` · ${timeLabel(e.startTime, e.endTime)}`}
                  {e.nextDate &&
                    (e.ongoing
                      ? ' · đang diễn ra'
                      : ` · tới: ${fullDate(e.nextDate)}`)}
                </p>
              </div>
              {e.birthdayUserId ? (
                // sinh nhật lấy từ hồ sơ thành viên: sửa ở Cài đặt, không sửa ở đây
                <Link to="/cai-dat" className="shrink-0 text-xs underline" style={{ color: 'var(--muted)' }}>
                  từ ngày sinh
                </Link>
              ) : (
                <button
                  className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
                  onClick={() => {
                    if (confirm(`Xoá "${e.title}"? Các nhắc nhở của nó cũng bị xoá.`)) {
                      remove.mutate({ id: e.id })
                    }
                  }}
                  disabled={remove.isPending}
                >
                  Xoá
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {!list.isLoading && (list.data?.length ?? 0) === 0 && !open && (
        <EmptyState
          icon="🕯"
          title="Chưa có ngày nào được ghi"
          hint="Thêm ngày giỗ theo âm lịch, sinh nhật theo dương lịch, hoặc một sự kiện có ngày cụ thể như chuyến đi 3–4/10 — app sẽ nhắc trước nhiều ngày."
        />
      )}
    </div>
  )
}

/**
 * Lễ tết Việt Nam — danh mục dựng sẵn của app, không phải sự kiện của nhà nên
 * không có nút sửa/xoá. Ai muốn một ngày riêng (giỗ, chuyến đi) thì thêm sự
 * kiện ở trên.
 */
function HolidaySection() {
  const [openYear, setOpenYear] = useState(false)
  const year = Number(today().slice(0, 4))
  const upcoming = trpc.holiday.upcoming.useQuery({ days: 365, limit: 6 })
  const all = trpc.holiday.year.useQuery({ year }, { enabled: openYear })

  const rows = upcoming.data ?? []
  if (rows.length === 0 && !openYear) return null

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">🏮 Lễ tết Việt Nam</h2>
        <button className="btn btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => setOpenYear((v) => !v)}>
          {openYear ? 'Thu gọn' : `Cả năm ${year}`}
        </button>
      </div>

      {!openYear && (
        <ul className="flex flex-col gap-3">
          {rows.map((h) => (
            <li key={`${h.id}-${h.startDate}`} className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl"
                style={{ background: 'var(--surface-2)' }}
              >
                <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                  {weekdayShort(h.startDate)}
                </span>
                <span className="text-sm font-bold leading-none">{dm(h.startDate)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {holidayMeta(h.category).icon} {h.title}
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                  {[
                    h.dayOff ? 'được nghỉ' : null,
                    h.calendar === 'LUNAR' ? lunarLabel(h.lunar) : null,
                    h.dayCount > 1 ? `${holidaySpan(h.startDate, h.endDate)} · ${h.dayCount} ngày` : null,
                    h.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold"
                style={
                  h.ongoing || h.daysUntil <= 3
                    ? { background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }
                    : { color: 'var(--muted)' }
                }
              >
                {h.ongoing
                  ? h.dayCount > 1
                    ? `Đang diễn ra · ngày ${h.dayIndex}/${h.dayCount}`
                    : 'Hôm nay'
                  : daysLabel(h.daysUntil)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {openYear && (all.isLoading ? <Spinner /> : <YearList rows={all.data ?? []} />)}

      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        Ngày âm lịch được quy đổi cho từng năm, nên Tết và Trung Thu luôn đúng ngày.
        Bật/tắt nhắc ở Cài đặt → Nhắc nhở.
      </p>
    </Card>
  )
}

/** Cả năm, gom theo tháng dương — nhìn một phát thấy tháng nào có gì. */
function YearList({ rows }: { rows: RouterOutputs['holiday']['year'] }) {
  const t = today()
  const months = new Map<number, typeof rows>()
  for (const h of rows) {
    const m = Number(h.startDate.slice(5, 7))
    months.set(m, [...(months.get(m) ?? []), h])
  }

  return (
    <div className="flex flex-col gap-3">
      {[...months.entries()].map(([month, list]) => (
        <div key={month}>
          <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tháng {month}</p>
          <ul className="flex flex-col gap-1">
            {list.map((h) => {
              const meta = holidayMeta(h.category)
              const past = (h.endDate ?? h.startDate) < t
              return (
                <li
                  key={`${h.id}-${h.startDate}`}
                  className="flex items-baseline gap-2 text-sm"
                  style={past ? { opacity: 0.5 } : undefined}
                >
                  <span className="w-16 shrink-0 tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                    {holidaySpan(h.startDate, h.endDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {meta.icon} {h.title}
                    {h.calendar === 'LUNAR' && (
                      <span className="ml-1.5 text-xs" style={{ color: 'var(--muted)' }}>{lunarLabel(h.lunar)}</span>
                    )}
                  </span>
                  {h.dayOff && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' }}
                    >
                      nghỉ
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function EventForm({ presetDate, onDone }: { presetDate?: string | null; onDone: () => void }) {
  // Dương lịch là mặc định: phần lớn thứ người ta thêm (chuyến đi, lịch hẹn,
  // sinh nhật) đều theo dương. Âm lịch chỉ dành cho giỗ chạp.
  const [calendar, setCalendar] = useState<Calendar>('SOLAR')
  const [type, setType] = useState<EventType>('OTHER')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [lunarDay, setLunarDay] = useState(15)
  const [lunarMonth, setLunarMonth] = useState(7)
  const [lunarLeap, setLunarLeap] = useState(false)
  const [solarDate, setSolarDate] = useState(presetDate ?? '')
  const [endDate, setEndDate] = useState('')
  /** true = lặp hàng năm (sinh nhật, lễ); false = một lần, có năm cụ thể (chuyến đi) */
  // chọn một ngày cụ thể trên lịch thì gần như chắc chắn là việc một lần
  const [yearly, setYearly] = useState(!presetDate)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [remindBeforeDays, setRemind] = useState<number[]>([7, 3, 1, 0])
  const [remindAtTime, setRemindAt] = useState('08:00')

  const create = trpc.event.create.useMutation({ onSuccess: onDone })
  const preview = trpc.event.previewLunar.useQuery(
    { lunarDay, lunarMonth, lunarLeap, years: 4 },
    { enabled: calendar === 'LUNAR' },
  )
  const monthlyPreview = trpc.event.previewLunarMonthly.useQuery(
    { lunarDay, count: 4 },
    { enabled: calendar === 'LUNAR_MONTHLY' },
  )

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(solarDate)
  const endOk = endDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(endDate)
  // sự kiện một lần mang năm cụ thể nên ngày kết thúc phải sau; hàng năm thì
  // được vắt qua giao thừa (28/12 → 2/1), server đã cho phép ca đó.
  const rangeOk = !endDate || yearly || endDate >= solarDate
  const valid =
    (title.trim().length > 0 || calendar === 'LUNAR_MONTHLY') &&
    (calendar !== 'SOLAR' || (dateOk && endOk && rangeOk))

  const times = {
    startTime: startTime || null,
    endTime: startTime && endTime ? endTime : null,
  }

  function submit() {
    if (calendar === 'LUNAR_MONTHLY') {
      create.mutate({
        calendar: 'LUNAR_MONTHLY', title: title.trim() || lunarDayLabel(lunarDay), type, lunarDay,
        remindBeforeDays, remindAtTime, note: note.trim() || null, ...times,
      })
      return
    }
    if (calendar === 'LUNAR') {
      create.mutate({
        calendar: 'LUNAR', title: title.trim(), type, lunarDay, lunarMonth, lunarLeap,
        remindBeforeDays, remindAtTime, note: note.trim() || null, ...times,
      })
    } else {
      // lặp hàng năm thì bỏ phần năm đi, chỉ giữ MM-DD; một lần thì giữ nguyên
      const cut = (d: string) => (yearly ? d.slice(5) : d)
      create.mutate({
        calendar: 'SOLAR', title: title.trim(), type,
        solarDate: cut(solarDate),
        endDate: endDate ? cut(endDate) : null,
        yearly, remindBeforeDays, remindAtTime, note: note.trim() || null, ...times,
      })
    }
  }

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
        {CALENDAR_TABS.map(([c, label]) => (
          <button
            key={c}
            onClick={() => setCalendar(c)}
            className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
            style={calendar === c ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tên</span>
        <input
          className="input-base"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            calendar === 'LUNAR'
              ? 'Giỗ ông nội'
              : calendar === 'LUNAR_MONTHLY'
                ? lunarDayLabel(lunarDay)
                : yearly ? 'Sinh nhật mẹ' : 'Đi Mù Cang Chải'
          }
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Loại</span>
        <select className="input-base" value={type} onChange={(e) => setType(e.target.value as EventType)}>
          <option value="DEATH_ANNIVERSARY">Ngày giỗ</option>
          <option value="BIRTHDAY">Sinh nhật</option>
          <option value="OTHER">Sự kiện khác</option>
        </select>
      </label>

      {calendar === 'LUNAR_MONTHLY' ? (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ngày âm, lặp mỗi tháng</span>
            <div className="flex gap-2">
              {[1, 15].map((d) => (
                <button
                  key={d}
                  onClick={() => setLunarDay(d)}
                  className="btn btn-ghost flex-1 !py-1.5 text-xs"
                  style={lunarDay === d ? { color: 'var(--brand)', borderColor: 'var(--brand)' } : undefined}
                >
                  {lunarDayLabel(d)}
                </button>
              ))}
              <select
                className="input-base !w-24"
                value={lunarDay}
                onChange={(e) => setLunarDay(Number(e.target.value))}
                aria-label="Ngày âm khác"
              >
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>ngày {d}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Những lần tới rơi vào:
            </p>
            {monthlyPreview.isLoading && <p className="text-xs" style={{ color: 'var(--muted)' }}>Đang tính…</p>}
            <ul className="flex flex-col gap-1">
              {(monthlyPreview.data ?? []).map((p) => (
                <li key={p.solarDate} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">{fullDate(p.solarDate)}</span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {p.lunar.day}/{p.lunar.month}{p.lunar.leap ? ' nhuận' : ''} âm
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
              Năm nhuận có 13 lần — tháng nhuận cũng có {lunarDayLabel(lunarDay).toLowerCase()} của nó.
            </p>
          </div>
        </>
      ) : calendar === 'LUNAR' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ngày âm</span>
              <select className="input-base" value={lunarDay} onChange={(e) => setLunarDay(Number(e.target.value))}>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tháng âm</span>
              <select className="input-base" value={lunarMonth} onChange={(e) => setLunarMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lunarLeap} onChange={(e) => setLunarLeap(e.target.checked)} />
            <span>Là tháng nhuận</span>
          </label>

          <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Rơi vào ngày dương lịch:
            </p>
            {preview.isLoading && <p className="text-xs" style={{ color: 'var(--muted)' }}>Đang tính…</p>}
            <ul className="flex flex-col gap-1">
              {(preview.data ?? []).map((p) => (
                <li key={p.lunarYear} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Năm âm {p.lunarYear}</span>
                  <span className="text-right text-xs font-medium">
                    {p.solarDate ? fullDate(p.solarDate) : '—'}
                    {p.usedDay !== lunarDay && (
                      <span style={{ color: 'var(--warn)' }}> (tháng thiếu → cúng {p.usedDay})</span>
                    )}
                    {lunarLeap && !p.usedLeap && (
                      <span style={{ color: 'var(--warn)' }}> (năm không nhuận → tháng thường)</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
            {([[true, 'Lặp hàng năm'], [false, 'Một lần']] as const).map(([v, label]) => (
              <button
                key={label}
                onClick={() => setYearly(v)}
                className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
                style={yearly === v
                  ? { background: 'var(--surface)', color: 'var(--brand)' }
                  : { color: 'var(--muted)' }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                {yearly ? 'Ngày (năm chỉ để ghi nhớ)' : 'Ngày bắt đầu'}
              </span>
              <input className="input-base" type="date" value={solarDate} onChange={(e) => setSolarDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Ngày kết thúc (nếu kéo dài)
              </span>
              <input
                className="input-base"
                type="date"
                value={endDate}
                min={yearly ? undefined : solarDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>

          {endDate && !rangeOk && (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>
              Ngày kết thúc phải sau ngày bắt đầu.
            </p>
          )}
          {endDate && rangeOk && dateOk && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {yearly && endDate < solarDate
                ? 'Sự kiện vắt qua giao thừa — sẽ tính sang năm sau.'
                : `Kéo dài ${
                    Math.round(
                      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${solarDate}T00:00:00Z`)) / 86_400_000,
                    ) + 1
                  } ngày.`}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Giờ bắt đầu (tuỳ chọn)
              </span>
              <input className="input-base" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Giờ kết thúc
              </span>
              <input
                className="input-base"
                type="time"
                value={endTime}
                disabled={!startTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Nhắc trước</span>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_REMIND.map((p) => {
            const on = p.days.join(',') === remindBeforeDays.join(',')
            return (
              <button
                key={p.label}
                onClick={() => setRemind(p.days)}
                className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                style={on
                  ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
                  : { borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Giờ bắn thông báo (khác giờ sự kiện ở trên)
        </span>
        <input className="input-base !w-auto" type="time" value={remindAtTime} onChange={(e) => setRemindAt(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ghi chú (tuỳ chọn)</span>
        <input className="input-base" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cúng ở nhà bác cả" />
      </label>

      {create.error && <ErrorNote message={create.error.message} />}

      <button className="btn btn-primary" disabled={!valid || create.isPending} onClick={submit}>
        {create.isPending ? 'Đang lưu…' : 'Lưu'}
      </button>
    </Card>
  )
}
