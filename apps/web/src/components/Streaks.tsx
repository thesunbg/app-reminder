/**
 * Chuỗi liên tiếp + huy hiệu.
 *
 * Với trẻ tiểu học, "12 ngày liên tiếp tập thể dục" là động lực mạnh hơn mọi
 * biểu đồ — nên nó phải to, đứng riêng, và không bị reset khi đổi bộ lọc thời
 * gian của trang Thống kê.
 */
import { Card } from '@/components/ui'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Streak = RouterOutputs['stats']['streaks'][number]

/** Huy hiệu: mốc càng cao thì càng hiếm, biểu tượng phải khác hẳn nhau. */
const BADGE: Record<number, { icon: string; label: string }> = {
  7: { icon: '🔥', label: 'Một tuần' },
  30: { icon: '⭐', label: 'Một tháng' },
  100: { icon: '💎', label: '100 lần' },
  365: { icon: '👑', label: 'Một năm' },
}

export function streakUnit(s: Pick<Streak, 'daily'>) {
  return s.daily ? 'ngày' : 'lần'
}

/** Ngọn lửa nhỏ để gắn cạnh tên việc ở màn hình Hôm nay. */
export function StreakFlame({ streak }: { streak: Streak }) {
  if (streak.current < 3) return null // chuỗi 1–2 chưa phải thành tích, khoe sớm thành nhảm
  return (
    <span
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
      style={{ background: 'color-mix(in srgb, var(--warn) 16%, transparent)', color: 'var(--warn)' }}
      title={`${streak.current} ${streakUnit(streak)} liên tiếp · kỷ lục ${streak.best}`}
    >
      🔥 {streak.current}
    </span>
  )
}

export default function Streaks({ ownerId }: { ownerId?: string }) {
  const q = trpc.stats.streaks.useQuery({ ownerId })
  const rows = (q.data ?? []).filter((s) => s.current > 0 || s.best > 0)
  if (rows.length === 0) return null

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">🔥 Chuỗi liên tiếp</h2>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>tính trên toàn bộ lịch sử</span>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((s) => {
          const unit = streakUnit(s)
          const pct = s.nextMilestone ? Math.min(100, Math.round((s.current / s.nextMilestone) * 100)) : 100
          return (
            <li key={s.routineId}>
              <div className="flex items-baseline gap-2">
                <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</span>
                {/* huy hiệu kèm luôn số mốc, nếu không nó trông như hình trang trí */}
                {s.badges.map((b) => (
                  <span
                    key={b}
                    className="shrink-0 rounded px-1 text-[11px] font-semibold"
                    style={{ background: 'var(--surface-2)' }}
                    title={`${BADGE[b]?.label}: đã từng ${b} ${unit} liên tiếp`}
                  >
                    {BADGE[b]?.icon}{b}
                  </span>
                ))}
                <span className="shrink-0 text-sm font-bold" style={{ color: s.current > 0 ? 'var(--warn)' : 'var(--muted)' }}>
                  {s.current} {unit}
                </span>
              </div>

              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: s.current > 0 ? 'var(--warn)' : 'var(--border)' }}
                />
              </div>

              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
                {s.toNext !== null && s.nextMilestone !== null
                  ? `Còn ${s.toNext} ${unit} nữa là mốc ${s.nextMilestone}`
                  : 'Đã qua mọi mốc 👑'}
                {s.best > s.current && ` · kỷ lục ${s.best} ${unit}`}
              </p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
