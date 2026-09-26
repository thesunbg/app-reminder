import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, EmptyState, Spinner } from '@/components/ui'
import { addDays, fullDate, minutesLabel, nowVnTime, relativeDay, today } from '@/lib/format'
import { trpc } from '@/lib/trpc'

type Status = 'DONE' | 'PARTIAL' | 'SKIPPED'

export default function Today() {
  const [date, setDate] = useState(today())
  const utils = trpc.useUtils()
  const day = trpc.routine.day.useQuery({ date })
  const me = trpc.auth.me.useQuery()

  const mark = trpc.routine.mark.useMutation({
    onSuccess: () => {
      void utils.routine.day.invalidate()
      void utils.stats.summary.invalidate()
      void utils.routine.week.invalidate()
    },
  })

  const items = day.data?.items ?? []
  const done = items.filter((i) => i.log?.status === 'DONE').length
  const partial = items.filter((i) => i.log?.status === 'PARTIAL').length
  const progress = items.length === 0 ? 0 : Math.round(((done + partial * 0.5) / items.length) * 100)
  const isToday = date === today()
  const now = nowVnTime()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <header className="mb-4 flex items-center gap-2">
        <button className="btn btn-ghost !px-3" onClick={() => setDate(addDays(date, -1))} aria-label="Ngày trước">‹</button>
        <div className="flex-1 text-center">
          <p className="text-base font-bold">{relativeDay(date) ?? fullDate(date)}</p>
          {relativeDay(date) && <p className="text-xs" style={{ color: 'var(--muted)' }}>{fullDate(date)}</p>}
        </div>
        <button className="btn btn-ghost !px-3" onClick={() => setDate(addDays(date, 1))} aria-label="Ngày sau">›</button>
        {!isToday && (
          <button className="btn btn-ghost !px-3 text-xs" onClick={() => setDate(today())}>Hôm nay</button>
        )}
      </header>

      {items.length > 0 && (
        <div className="card mb-4 flex items-center gap-4 px-4 py-3">
          <ProgressRing value={progress} />
          <div>
            <p className="font-semibold">
              {done}/{items.length} việc
              {partial > 0 && <span className="ml-1 text-sm font-normal" style={{ color: 'var(--muted)' }}>(+{partial} làm dở)</span>}
            </p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {progress === 100 ? 'Xong hết rồi 🎉' : `Còn ${items.length - done - partial} việc chưa làm`}
            </p>
          </div>
        </div>
      )}

      {me.data?.role === 'CHILD' && isToday && <StudyToday childId={me.data.id} />}

      {day.isLoading && <Spinner />}

      {!day.isLoading && items.length === 0 && (
        <EmptyState icon="🌤" title="Không có việc nào hôm nay" hint="Thêm công việc định kỳ ở tab Quản lý để lịch tự sinh mỗi ngày." />
      )}

      <ul className="flex flex-col gap-2">
        {items.map(({ routine, log, canEdit }) => {
          const status = log?.status as Status | undefined
          const overdue = isToday && !status && routine.timeOfDay < now
          const pending = mark.isPending && mark.variables?.routineId === routine.id
          // việc của phụ huynh khác: thấy được nhưng không tick hộ được
          const lockedBy = canEdit ? null : routine.owner.name
          return (
            <li
              key={routine.id}
              className="card flex items-center gap-3 px-3 py-3"
              style={
                status || lockedBy
                  ? { opacity: lockedBy && !status ? 0.8 : 0.68 }
                  : overdue
                    ? { borderColor: 'color-mix(in srgb, var(--warn) 55%, var(--border))' }
                    : undefined
              }
            >
              <button
                onClick={() => mark.mutate({ routineId: routine.id, date, status: 'DONE' })}
                disabled={pending || !canEdit}
                aria-label={
                  lockedBy
                    ? `Việc của ${lockedBy}, chỉ người đó tick được`
                    : status === 'DONE' ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'
                }
                title={lockedBy ? `Việc của ${lockedBy} — chỉ người đó tick được` : undefined}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold text-white transition"
                style={
                  status === 'DONE'
                    ? { background: 'var(--ok)', borderColor: 'var(--ok)' }
                    : status === 'PARTIAL'
                      ? { background: 'var(--warn)', borderColor: 'var(--warn)' }
                      : status === 'SKIPPED'
                        ? { background: 'var(--muted)', borderColor: 'var(--muted)' }
                        : { borderColor: 'var(--border)' }
                }
              >
                {status === 'DONE' ? '✓' : status === 'PARTIAL' ? '½' : status === 'SKIPPED' ? '–' : ''}
              </button>

              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: routine.color }} />

              <div className="min-w-0 flex-1">
                <p className={`truncate font-semibold ${status === 'DONE' ? 'line-through' : ''}`}>{routine.title}</p>
                <p className="flex items-center gap-1.5 text-xs" style={{ color: overdue ? 'var(--warn)' : 'var(--muted)' }}>
                  <span className="tabular-nums">{routine.timeOfDay}</span>
                  <span>·</span>
                  <span>{minutesLabel(routine.durationMin)}</span>
                  {overdue && !lockedBy && <><span>·</span><span className="font-semibold">quá giờ</span></>}
                  {lockedBy && <><span>·</span><span>việc của {lockedBy}</span></>}
                </p>
              </div>

              {me.data?.role === 'PARENT' && routine.owner.id !== me.data.id && (
                <Avatar name={routine.owner.name} color={routine.owner.avatarColor} size={26} />
              )}

              {canEdit && (
                <div className="flex gap-1">
                  <MiniBtn active={status === 'PARTIAL'} title="Làm dở" onClick={() => mark.mutate({ routineId: routine.id, date, status: 'PARTIAL' })} disabled={pending}>½</MiniBtn>
                  <MiniBtn active={status === 'SKIPPED'} title="Bỏ qua" onClick={() => mark.mutate({ routineId: routine.id, date, status: 'SKIPPED' })} disabled={pending}>–</MiniBtn>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Con nhìn thấy ngay hôm nay học gì và bài nào phải nộp — không phải mở tab khác. */
function StudyToday({ childId }: { childId: string }) {
  const utils = trpc.useUtils()
  const d = trpc.study.dashboard.useQuery({ childId })
  const toggle = trpc.study.homeworkToggle.useMutation({ onSuccess: () => void utils.study.invalidate() })
  const x = d.data
  if (!x) return null
  // bài không có hạn không chen vào màn hình Hôm nay — nó không đến hạn hôm nay
  const due = [...x.homework.overdue, ...x.homework.pending].filter((h) => h.date && h.date <= addDays(today(), 1))
  if (x.todayClasses.length === 0 && due.length === 0) return null
  return (
    <div className="card mb-4 px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-sm font-semibold">🎓 Học tập</p>
        <Link to="/hoc-tap" className="text-xs underline" style={{ color: 'var(--muted)' }}>xem hết</Link>
      </div>
      {x.todayClasses.length > 0 && (
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          Hôm nay: {x.todayClasses.map((c) => c.subject).join(' · ')}
        </p>
      )}
      {due.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {due.map((h) => (
            <li key={h.id} className="flex items-center gap-2 text-sm">
              <button
                onClick={() => toggle.mutate({ id: h.id, done: true })}
                aria-label="Đánh dấu xong"
                className="h-5 w-5 shrink-0 rounded-full border-2"
                style={{ borderColor: h.date! < today() ? 'var(--danger)' : 'var(--border)' }}
              />
              <span className="font-medium">{h.title}</span>
              <span className="text-xs" style={{ color: h.date! < today() ? 'var(--danger)' : 'var(--muted)' }}>
                {[h.subject, h.date! < today() ? 'quá hạn' : h.date === today() ? 'nộp hôm nay' : 'nộp ngày mai']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MiniBtn({ children, active, title, onClick, disabled }: {
  children: React.ReactNode; active: boolean; title: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 rounded-lg border text-xs font-bold"
      style={{
        borderColor: active ? 'var(--brand)' : 'var(--border)',
        background: active ? 'var(--brand-soft)' : 'transparent',
        color: active ? 'var(--brand)' : 'var(--muted)',
      }}
    >
      {children}
    </button>
  )
}

function ProgressRing({ value }: { value: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0" role="img" aria-label={`Hoàn thành ${value}%`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
      <circle
        cx="28" cy="28" r={r} fill="none"
        stroke={value === 100 ? 'var(--ok)' : 'var(--brand)'}
        strokeWidth="6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
        transform="rotate(-90 28 28)"
        style={{ transition: 'stroke-dashoffset 320ms ease' }}
      />
      <text x="28" y="32" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text)">{value}%</text>
    </svg>
  )
}
