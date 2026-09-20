import { useState } from 'react'
import { Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { fullDate, weekdayShort } from '@/lib/format'
import { trpc } from '@/lib/trpc'

type Calendar = 'LUNAR' | 'SOLAR'
type EventType = 'DEATH_ANNIVERSARY' | 'BIRTHDAY' | 'OTHER'

const TYPE_META: Record<EventType, { label: string; icon: string; color: string }> = {
  DEATH_ANNIVERSARY: { label: 'Ngày giỗ', icon: '🕯', color: '#7c3aed' },
  BIRTHDAY: { label: 'Sinh nhật', icon: '🎂', color: '#db2777' },
  OTHER: { label: 'Sự kiện', icon: '📌', color: '#0891b2' },
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

export default function Events() {
  const utils = trpc.useUtils()
  const list = trpc.event.list.useQuery()
  const upcoming = trpc.event.upcoming.useQuery({ days: 180 })
  const [open, setOpen] = useState(false)

  const remove = trpc.event.remove.useMutation({
    onSuccess: () => {
      void utils.event.list.invalidate()
      void utils.event.upcoming.invalidate()
      void utils.notify.recent.invalidate()
    },
  })

  const refresh = () => {
    setOpen(false)
    void utils.event.list.invalidate()
    void utils.event.upcoming.invalidate()
    void utils.notify.upcomingCount.invalidate()
  }

  const next = upcoming.data ?? []

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Giỗ chạp & sinh nhật</h1>
        <button className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Đóng' : '+ Thêm'}
        </button>
      </div>

      {open && <EventForm onDone={refresh} />}

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
                    <span className="text-sm font-bold leading-none">
                      {Number(o.solarDate.slice(8, 10))}/{Number(o.solarDate.slice(5, 7))}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {meta.icon} {o.event.title}
                    </p>
                    <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                      {o.lunar
                        ? `${o.lunar.day}/${o.lunar.month}${o.lunar.leap ? ' nhuận' : ''} âm lịch`
                        : 'dương lịch'}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold"
                    style={
                      o.daysUntil <= 3
                        ? { background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }
                        : { color: 'var(--muted)' }
                    }
                  >
                    {daysLabel(o.daysUntil)}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <h2 className="mb-2 mt-4 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
        Tất cả ({list.data?.length ?? 0})
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
                  {e.calendar === 'LUNAR'
                    ? `${e.lunarDay}/${e.lunarMonth}${e.lunarLeap ? ' nhuận' : ''} âm lịch`
                    : `${e.solarDate?.slice(-5).split('-').reverse().join('/')} dương lịch`}
                  {e.nextDate && ` · tới: ${fullDate(e.nextDate)}`}
                </p>
              </div>
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
            </li>
          )
        })}
      </ul>

      {!list.isLoading && (list.data?.length ?? 0) === 0 && !open && (
        <EmptyState
          icon="🕯"
          title="Chưa có ngày nào được ghi"
          hint="Thêm ngày giỗ theo âm lịch hoặc sinh nhật theo dương lịch — app sẽ nhắc trước nhiều ngày."
        />
      )}
    </div>
  )
}

function EventForm({ onDone }: { onDone: () => void }) {
  const [calendar, setCalendar] = useState<Calendar>('LUNAR')
  const [type, setType] = useState<EventType>('DEATH_ANNIVERSARY')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [lunarDay, setLunarDay] = useState(15)
  const [lunarMonth, setLunarMonth] = useState(7)
  const [lunarLeap, setLunarLeap] = useState(false)
  const [solarDate, setSolarDate] = useState('')
  const [remindBeforeDays, setRemind] = useState<number[]>([7, 3, 1, 0])
  const [remindAtTime, setRemindAt] = useState('08:00')

  const create = trpc.event.create.useMutation({ onSuccess: onDone })
  const preview = trpc.event.previewLunar.useQuery(
    { lunarDay, lunarMonth, lunarLeap, years: 4 },
    { enabled: calendar === 'LUNAR' },
  )

  const valid =
    title.trim().length > 0 && (calendar === 'LUNAR' || /^\d{4}-\d{2}-\d{2}$/.test(solarDate))

  function submit() {
    if (calendar === 'LUNAR') {
      create.mutate({
        calendar: 'LUNAR', title: title.trim(), type, lunarDay, lunarMonth, lunarLeap,
        remindBeforeDays, remindAtTime, note: note.trim() || null,
      })
    } else {
      create.mutate({
        calendar: 'SOLAR', title: title.trim(), type,
        solarDate: solarDate.slice(5), // chỉ giữ MM-DD để lặp hàng năm
        yearly: true, remindBeforeDays, remindAtTime, note: note.trim() || null,
      })
    }
  }

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
        {(['LUNAR', 'SOLAR'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCalendar(c)}
            className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
            style={calendar === c ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
          >
            {c === 'LUNAR' ? 'Âm lịch (giỗ)' : 'Dương lịch (sinh nhật)'}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tên</span>
        <input
          className="input-base"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={calendar === 'LUNAR' ? 'Giỗ ông nội' : 'Sinh nhật mẹ'}
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

      {calendar === 'LUNAR' ? (
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
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Ngày dương (lặp hàng năm, năm chỉ dùng để ghi nhớ)
          </span>
          <input className="input-base" type="date" value={solarDate} onChange={(e) => setSolarDate(e.target.value)} />
        </label>
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
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Giờ nhắc trong ngày</span>
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
