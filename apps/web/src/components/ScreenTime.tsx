/**
 * Báo cáo thời lượng dùng máy tính + quản lý agent (Phase 8).
 *
 * Nằm trong tab Học tập vì nó là một mặt của việc theo dõi con. Con xem được
 * đúng màn hình này về máy của mình — minh bạch là một phần thiết kế, không
 * phải tuỳ chọn (docs/PLAN.md mục 1).
 */
import { lazy, Suspense, useState } from 'react'
import { Card, EmptyState, ErrorNote, Spinner, StatTile } from '@/components/ui'
import { minutesLabel } from '@/lib/format'
import { trpc } from '@/lib/trpc'

// recharts đã là chunk riêng ở trang Thống kê; giữ nguyên cách đó ở đây.
const DayChart = lazy(() => import('@/components/ScreenTimeChart'))

const CATEGORY_LABEL: Record<string, string> = {
  work: 'Làm việc',
  study: 'Học tập',
  entertainment: 'Giải trí',
  social: 'Mạng xã hội',
  other: 'Khác',
}
const CATEGORY_COLOR: Record<string, string> = {
  work: '#4f46e5',
  study: '#16a34a',
  entertainment: '#f59e0b',
  social: '#dc2626',
  other: '#64748b',
}

const RANGES = [
  { days: 7, label: '7 ngày' },
  { days: 14, label: '14 ngày' },
  { days: 30, label: '30 ngày' },
]

export default function ScreenTime({ userId, canManage }: { userId: string; canManage: boolean }) {
  const [days, setDays] = useState(14)
  const summary = trpc.screen.summary.useQuery({ userId, from: isoDaysAgo(days - 1) })

  if (summary.isLoading) return <Spinner />
  const s = summary.data
  if (!s) return null

  if (s.devices.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon="💻"
          title="Chưa ghép máy tính nào"
          hint="Cài agent lên máy để thấy mỗi ngày dùng máy bao lâu, vào những app gì. Agent chỉ đọc tên app và số phút — không chặn, không chụp màn hình."
        />
        {canManage && <Devices userId={userId} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
              style={days === r.days ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile label="Tổng cộng" value={minutesLabel(s.totalMinutes)} />
        <StatTile label="Trung bình ngày có dùng" value={minutesLabel(s.avgPerActiveDay)} />
        <StatTile label="Số ngày có dùng" value={s.byDay.filter((d) => d.minutes > 0).length} unit={`/${s.byDay.length}`} />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Mỗi ngày</h2>
        <Suspense fallback={<Spinner />}>
          <DayChart byDay={s.byDay} />
        </Suspense>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Theo nhóm</h2>
        {s.byCategory.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Chưa có dữ liệu trong khoảng này.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {s.byCategory.map((c) => (
              <li key={c.category}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {minutesLabel(c.minutes)} · {Math.round((c.minutes / Math.max(1, s.totalMinutes)) * 100)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(c.minutes / Math.max(1, s.totalMinutes)) * 100}%`,
                      background: CATEGORY_COLOR[c.category] ?? CATEGORY_COLOR.other,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">App dùng nhiều nhất</h2>
        {s.byApp.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Chưa có dữ liệu trong khoảng này.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {s.byApp.map((a) => (
              <li key={a.app} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: CATEGORY_COLOR[a.category] ?? CATEGORY_COLOR.other }}
                  title={CATEGORY_LABEL[a.category] ?? a.category}
                />
                <span className="min-w-0 flex-1 truncate">{a.app}</span>
                <span className="shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>{minutesLabel(a.minutes)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Devices userId={userId} readOnly={!canManage} />
    </div>
  )
}

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() + 7 * 60 * 60_000)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- máy đã ghép

function Devices({ userId, readOnly = false }: { userId: string; readOnly?: boolean }) {
  const utils = trpc.useUtils()
  const devices = trpc.screen.devices.useQuery({ userId })
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)

  const create = trpc.screen.createDevice.useMutation({
    onSuccess: (d) => {
      setFresh({ name: d.device.name, token: d.token })
      setName('')
      void utils.screen.invalidate()
    },
  })
  const remove = trpc.screen.removeDevice.useMutation({ onSuccess: () => void utils.screen.invalidate() })

  const list = devices.data ?? []

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">Máy tính</h2>

      {list.length === 0 ? (
        <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>Chưa ghép máy nào.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {list.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.name}</span>
                <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
                  {d.lastReportAt
                    ? `báo cáo lúc ${new Date(d.lastReportAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
                    : 'chưa gửi báo cáo nào'}
                </span>
              </span>
              {!readOnly && (
                <button
                  className="btn btn-ghost !py-1 text-xs"
                  onClick={() => { if (confirm(`Gỡ "${d.name}"? Toàn bộ dữ liệu đã báo cáo của máy này sẽ bị xoá.`)) remove.mutate({ id: d.id }) }}
                  disabled={remove.isPending}
                >
                  Gỡ
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {fresh && (
        <div className="mb-3 rounded-xl px-3 py-3" style={{ background: 'var(--surface-2)' }}>
          <p className="mb-1 text-xs font-semibold">Token cho “{fresh.name}”</p>
          <p className="mb-2 break-all font-mono text-xs">{fresh.token}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Chép ngay — token <b>chỉ hiện một lần</b>. Dán vào{' '}
            <code>~/.family-hub-agent/config.json</code> trên máy đó, xem
            <code> apps/agent/README.md</code>.
          </p>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <input
            className="input-base !w-auto flex-1"
            placeholder="Tên máy, vd “MacBook của Minh”"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn-ghost !py-1.5 text-xs"
            onClick={() => create.mutate({ userId, name: name.trim() })}
            disabled={create.isPending || name.trim().length === 0}
          >
            {create.isPending ? 'Đang tạo…' : 'Thêm máy'}
          </button>
        </div>
      )}
      {create.error && <ErrorNote message={create.error.message} />}
      {remove.error && <ErrorNote message={remove.error.message} />}

      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        Agent chỉ đọc tên app đang dùng và số phút. Không chụp màn hình, không
        đọc nội dung, không chặn gì. Chặn và giới hạn giờ dùng Screen Time
        (Apple) hoặc Family Link (Google).
      </p>
    </Card>
  )
}
