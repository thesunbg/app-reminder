import { useState } from 'react'
import { Avatar, Card, ErrorNote, Spinner } from '@/components/ui'
import { minutesLabel } from '@/lib/format'
import { trpc } from '@/lib/trpc'

const DAYS = [
  { code: 'MO', label: 'T2' }, { code: 'TU', label: 'T3' }, { code: 'WE', label: 'T4' },
  { code: 'TH', label: 'T5' }, { code: 'FR', label: 'T6' }, { code: 'SA', label: 'T7' },
  { code: 'SU', label: 'CN' },
]
const COLORS = ['#4f46e5', '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#7c3aed', '#db2777']

/** Mô tả rrule bằng tiếng Việt cho người dùng đọc. */
function describeRRule(rrule: string): string {
  if (rrule === 'FREQ=DAILY') return 'Hàng ngày'
  const m = /BYDAY=([A-Z,]+)/.exec(rrule)
  if (!m?.[1]) return rrule
  const codes = m[1].split(',')
  if (codes.length === 7) return 'Hàng ngày'
  if (codes.join(',') === 'MO,TU,WE,TH,FR') return 'Các ngày trong tuần'
  if (codes.join(',') === 'SA,SU') return 'Cuối tuần'
  return codes.map((c) => DAYS.find((d) => d.code === c)?.label ?? c).join(', ')
}

export default function Routines() {
  const utils = trpc.useUtils()
  const me = trpc.auth.me.useQuery()
  const members = trpc.family.members.useQuery()
  const list = trpc.routine.list.useQuery({})
  const [open, setOpen] = useState(false)

  const archive = trpc.routine.archive.useMutation({
    onSuccess: () => { void utils.routine.list.invalidate(); void utils.routine.day.invalidate(); void utils.routine.week.invalidate() },
  })

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Công việc định kỳ</h1>
        <button className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Đóng' : '+ Thêm'}
        </button>
      </div>

      {open && (
        <RoutineForm
          members={members.data ?? []}
          canAssign={me.data?.role === 'PARENT'}
          onDone={() => {
            setOpen(false)
            void utils.routine.list.invalidate()
            void utils.routine.day.invalidate()
            void utils.routine.week.invalidate()
          }}
        />
      )}

      {list.isLoading && <Spinner />}

      <ul className="flex flex-col gap-2">
        {(list.data ?? []).map((r) => (
          <li key={r.id} className="card flex items-center gap-3 px-3 py-3">
            <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: r.color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{r.title}</p>
              <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                {r.timeOfDay} · {minutesLabel(r.durationMin)} · {describeRRule(r.rrule)}
                {r.category !== 'general' && ` · ${r.category}`}
              </p>
            </div>
            <Avatar name={r.owner.name} color={r.owner.avatarColor} size={28} />
            <button
              className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
              onClick={() => { if (confirm(`Lưu trữ "${r.title}"? Lịch sử vẫn được giữ lại.`)) archive.mutate({ id: r.id }) }}
              disabled={archive.isPending}
            >
              Lưu trữ
            </button>
          </li>
        ))}
      </ul>

      {!list.isLoading && (list.data?.length ?? 0) === 0 && !open && (
        <Card className="px-6 py-10 text-center">
          <p className="font-semibold">Chưa có công việc nào</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Bấm “+ Thêm” để tạo việc đầu tiên, ví dụ “Học tiếng Anh 06:00 hàng ngày”.
          </p>
        </Card>
      )}
    </div>
  )
}

type Member = { id: string; name: string; avatarColor: string }

function RoutineForm({ members, canAssign, onDone }: { members: Member[]; canAssign: boolean; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Học')
  const [timeOfDay, setTimeOfDay] = useState('06:00')
  const [durationMin, setDurationMin] = useState(60)
  const [color, setColor] = useState(COLORS[0]!)
  const [mode, setMode] = useState<'daily' | 'weekdays' | 'custom'>('daily')
  const [picked, setPicked] = useState<string[]>(['MO', 'WE', 'FR'])
  const [ownerId, setOwnerId] = useState<string>('')
  const [remindBeforeMin, setRemindBeforeMin] = useState(10)

  const create = trpc.routine.create.useMutation({ onSuccess: onDone })

  const rrule =
    mode === 'daily' ? 'FREQ=DAILY'
    : mode === 'weekdays' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    : `FREQ=WEEKLY;BYDAY=${picked.join(',')}`

  const invalid = mode === 'custom' && picked.length === 0

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tên công việc</span>
        <input className="input-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Học tiếng Anh" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Giờ bắt đầu</span>
          <input className="input-base" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Thời lượng (phút)</span>
          <input className="input-base" type="number" min={1} max={1440} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Nhóm</span>
          <input className="input-base" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Học" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Nhắc trước (phút)</span>
          <input className="input-base" type="number" min={0} max={1440} value={remindBeforeMin} onChange={(e) => setRemindBeforeMin(Number(e.target.value))} />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Lặp lại</span>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
          {([['daily', 'Hàng ngày'], ['weekdays', 'T2–T6'], ['custom', 'Tuỳ chọn']] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
              style={mode === m ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'custom' && (
          <div className="mt-1 flex gap-1">
            {DAYS.map((d) => {
              const on = picked.includes(d.code)
              return (
                <button
                  key={d.code}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d.code) : [...p, d.code]))}
                  className="h-9 flex-1 rounded-lg border text-xs font-semibold"
                  style={on
                    ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
                    : { borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Màu</span>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Chọn màu ${c}`}
              className="h-7 w-7 rounded-full transition"
              style={{ background: c, outline: color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }}
            />
          ))}
        </div>
      </div>

      {canAssign && members.length > 1 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Giao cho</span>
          <select className="input-base" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Tôi</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}

      {create.error && <ErrorNote message={create.error.message} />}

      <button
        className="btn btn-primary"
        disabled={create.isPending || title.trim().length === 0 || invalid}
        onClick={() =>
          create.mutate({
            title: title.trim(), category, color, durationMin, timeOfDay, rrule,
            remindBeforeMin, ...(ownerId ? { ownerId } : {}),
          })
        }
      >
        {create.isPending ? 'Đang lưu…' : 'Tạo công việc'}
      </button>
    </Card>
  )
}
