/**
 * Giữ cho app điện thoại (Capacitor) luôn: đã đăng ký token push với server,
 * và có sẵn lịch nhắc cục bộ cho vài ngày tới.
 *
 * Chạy một lần ở App sau khi đã đăng nhập. Ở trình duyệt thường thì hook này
 * không làm gì — mọi nhánh đều thoát sớm ở `isNative()`.
 */
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { isNative, registerForPush, syncLocalNotifications } from '@/lib/native'
import { trpc } from '@/lib/trpc'

/** Đặt lại lịch cục bộ mỗi 6 tiếng khi app còn mở. */
const RESYNC_MS = 6 * 60 * 60_000
/** Xin trước ngần này ngày. Nhiều hơn cũng vô ích: iOS chỉ giữ 64 cái. */
const HORIZON_DAYS = 3

export function useNativeBridge(enabled: boolean) {
  const navigate = useNavigate()
  const register = trpc.notify.registerNative.useMutation()
  const registered = useRef(false)

  const upcoming = trpc.notify.upcoming.useQuery(
    { days: HORIZON_DAYS },
    { enabled: enabled && isNative(), refetchInterval: RESYNC_MS, refetchOnWindowFocus: true },
  )

  // 1. Đăng ký token FCM. Chỉ một lần mỗi phiên: token hiếm khi đổi giữa chừng,
  //    và mỗi lần gọi là một lần bật hộp thoại xin quyền trên Android 13+.
  useEffect(() => {
    if (!enabled || !isNative() || registered.current) return
    registered.current = true
    void (async () => {
      try {
        const reg = await registerForPush()
        await register.mutateAsync(reg)
      } catch {
        // Không quấy người dùng ở đây: màn hình Cài đặt có nút bật lại kèm lý do
        // thất bại. Bật app lên mà ăn ngay một cảnh báo thì khó chịu hơn nhiều.
        registered.current = false
      }
    })()
    // `register` là mutation ổn định của tRPC, đưa vào deps chỉ gây chạy lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // 2. Gương lịch nhắc xuống máy để không phụ thuộc mạng.
  useEffect(() => {
    if (!enabled || !isNative() || !upcoming.data) return
    void syncLocalNotifications(
      upcoming.data.map((n) => ({
        id: n.id, tag: n.tag, title: n.title, body: n.body, url: n.url, fireAt: n.fireAt,
      })),
    )
  }, [enabled, upcoming.data])

  // 3. Bấm vào thông báo → mở đúng màn hình.
  useEffect(() => {
    if (!enabled || !isNative()) return
    let cancelled = false
    const handles: Array<{ remove: () => Promise<void> }> = []

    void (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const open = (url: unknown) => navigate(typeof url === 'string' && url.startsWith('/') ? url : '/')

      const added = await Promise.all([
        PushNotifications.addListener('pushNotificationActionPerformed', (a) =>
          open(a.notification.data?.url),
        ),
        LocalNotifications.addListener('localNotificationActionPerformed', (a) =>
          open(a.notification.extra?.url),
        ),
      ])
      if (cancelled) { await Promise.all(added.map((h) => h.remove())).catch(() => {}); return }
      handles.push(...added)
    })()

    return () => {
      cancelled = true
      void Promise.all(handles.map((h) => h.remove())).catch(() => {})
    }
  }, [enabled, navigate])
}
