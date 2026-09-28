/**
 * Link đăng ký lịch (.ics).
 *
 * Trong nhà luôn có người không chịu cài thêm app. Dán một URL vào Lịch iPhone
 * hay Google Calendar là ngày giỗ, Tết, sinh nhật, chuyến đi hiện thẳng ở chỗ
 * họ vẫn nhìn mỗi ngày.
 */
import { useState } from 'react'
import { Card, ErrorNote } from '@/components/ui'
import { trpc } from '@/lib/trpc'

function when(d: Date | null | undefined): string {
  if (!d) return 'chưa lần nào'
  return new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

export default function CalendarFeed() {
  const utils = trpc.useUtils()
  const status = trpc.event.icalStatus.useQuery()
  // token thô chỉ có ĐÚNG MỘT LẦN, ngay sau khi tạo: server chỉ giữ hash
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = trpc.event.icalCreate.useMutation({
    onSuccess: (r) => {
      setUrl(r.url)
      setCopied(false)
      void utils.event.icalStatus.invalidate()
    },
  })
  const revoke = trpc.event.icalRevoke.useMutation({
    onSuccess: () => {
      setUrl(null)
      void utils.event.icalStatus.invalidate()
    },
  })

  const s = status.data

  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-1 font-semibold">Lịch cho iPhone / Google Calendar</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
        Đăng ký một link là ngày giỗ, lễ tết, sinh nhật và chuyến đi của nhà hiện
        thẳng trong lịch của điện thoại — người không cài app vẫn thấy. Việc định
        kỳ hằng ngày cố ý không xuất, đổ vào đó chỉ làm hỏng lịch.
      </p>

      {url && (
        <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
          <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--warn)' }}>
            Dán ngay bây giờ — link chỉ hiện một lần. Mất thì tạo lại (link cũ sẽ hỏng).
          </p>
          <p className="mb-2 break-all rounded-lg px-2 py-1.5 text-xs" style={{ background: 'var(--surface)' }}>
            {url}
          </p>
          <button
            className="btn btn-ghost !py-1.5 text-xs"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }}
          >
            {copied ? '✓ Đã chép' : 'Chép link'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => create.mutate()} disabled={create.isPending}>
          {s?.enabled ? 'Tạo link mới' : 'Tạo link'}
        </button>
        {s?.enabled && (
          <button
            className="btn btn-ghost !py-1.5 text-xs"
            onClick={() => {
              if (confirm('Thu hồi link? Lịch đã đăng ký ở các máy sẽ ngừng cập nhật.')) revoke.mutate()
            }}
            disabled={revoke.isPending}
          >
            Thu hồi
          </button>
        )}
        {s?.enabled && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Đang bật · lịch tải về lần cuối: {when(s.lastUsedAt)}
          </span>
        )}
      </div>

      {s?.enabled && (
        <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          iPhone: Cài đặt → Lịch → Tài khoản → Thêm tài khoản → Khác → Thêm lịch
          đã đăng ký. Google Calendar: Cài đặt → Thêm lịch → Từ URL.
        </p>
      )}

      {(create.error || revoke.error) && (
        <ErrorNote message={(create.error ?? revoke.error)!.message} />
      )}
    </Card>
  )
}
