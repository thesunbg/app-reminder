import { Card } from '@/components/ui'
import { trpc } from '@/lib/trpc'

const KIND_LABEL: Record<string, string> = {
  ROUTINE_UPCOMING: 'Sắp đến giờ',
  ROUTINE_DUE: 'Đến giờ',
  ROUTINE_NAG: 'Nhắc lại',
  EVENT_AHEAD: 'Sắp tới ngày',
  EVENT_TODAY: 'Hôm nay',
  NOTE_AHEAD: 'Ghi chú sắp đến hạn',
  NOTE_DUE: 'Ghi chú đến hạn',
  DAILY_DIGEST: 'Tổng kết cuối ngày',
}

const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Đang chờ', color: 'var(--muted)' },
  SENDING: { label: 'Đang gửi', color: 'var(--warn)' },
  SENT: { label: 'Đã gửi', color: 'var(--ok)' },
  FAILED: { label: 'Hỏng', color: 'var(--danger)' },
  CANCELLED: { label: 'Đã huỷ', color: 'var(--muted)' },
}

function when(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
  }).format(d)
}

export default function NotifyLog() {
  const recent = trpc.notify.recent.useQuery({ limit: 25 })
  const rows = recent.data ?? []

  return (
    <Card className="p-4">
      <h2 className="mb-1 font-semibold">Nhật ký thông báo</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
        Để biết cái gì đã gửi, cái gì hỏng — đừng đoán.
      </p>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          Chưa có thông báo nào được lên lịch.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((n) => {
            const st = STATUS[n.status] ?? STATUS.PENDING!
            return (
              <li key={n.id} className="flex items-start gap-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: st.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {KIND_LABEL[n.kind] ?? n.kind} · {when(n.fireAt)} · {st.label}
                    {n.attempts > 1 && ` · thử ${n.attempts} lần`}
                    {n.status === 'SENT' && n.channels.length > 0 && ` · ${n.channels.join(', ')}`}
                  </p>
                  {n.error && n.status !== 'SENT' && (
                    <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--danger)' }} title={n.error}>
                      {n.error}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
