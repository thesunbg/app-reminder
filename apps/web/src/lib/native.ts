/**
 * Cầu nối sang lớp native khi app chạy trong vỏ Capacitor (Phase 7).
 *
 * Cùng một bundle chạy cả ở trình duyệt lẫn trong app điện thoại. Mọi thứ ở
 * đây đều phải tự tắt êm khi không có lớp native — `isNative()` trả false thì
 * không hàm nào trong file này làm gì cả.
 *
 * Hai cơ chế nhắc, cố ý chồng lên nhau:
 *  1. **Push (FCM)** — server chủ động bắn, nội dung luôn mới, nhưng chỉ tới
 *     khi máy có mạng và Apple/Google chịu chuyển.
 *  2. **Local notification** — app tự đặt lịch trước trên máy, hệ điều hành
 *     bắn đúng giờ kể cả không mạng. Bù đúng chỗ push yếu nhất.
 *
 * Trùng nhau thì sao? Hai bên dùng chung `tag`/`thread-id` theo id thông báo
 * nên hệ điều hành gộp lại, người dùng thấy một dòng.
 */
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications, type Token } from '@capacitor/push-notifications'

export const isNative = () => Capacitor.isNativePlatform()

/** 'ios' | 'android' — chỉ gọi khi isNative(). */
export const nativePlatform = () => Capacitor.getPlatform() as 'ios' | 'android'

/**
 * Token đã đăng ký của máy này, nhớ lại giữa các lần mở app.
 *
 * Không có API nào đọc token FCM hiện tại mà không gọi `register()` lần nữa
 * (và lần nữa là lại xin quyền trên Android 13+), nên phải tự nhớ. Chỉ dùng
 * để biết "máy này đã bật chưa" và để gỡ đúng bản ghi khi tắt.
 */
const TOKEN_KEY = 'fh.native.token'

export function rememberedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function remember(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // chế độ riêng tư chặn localStorage — chỉ mất phần hiển thị, không sao
  }
}

export type NativeRegistration = {
  token: string
  platform: 'ios' | 'android'
  model?: string
  appVersion?: string
}

/**
 * Xin quyền thông báo rồi lấy token FCM của máy này.
 *
 * Token về qua sự kiện `registration` chứ không phải giá trị trả về của
 * `register()`, nên phải bọc trong Promise. Có timeout vì nếu thiết bị không
 * lấy được token (máy Android không có Google Play Services chẳng hạn) thì sự
 * kiện đó **không bao giờ** tới và màn hình Cài đặt sẽ quay mãi.
 */
export async function registerForPush(timeoutMs = 15_000): Promise<NativeRegistration> {
  if (!isNative()) throw new Error('Chỉ dùng được trong app điện thoại')

  let status = await PushNotifications.checkPermissions()
  if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
    status = await PushNotifications.requestPermissions()
  }
  if (status.receive !== 'granted') {
    throw new Error('Bạn chưa cho phép app gửi thông báo. Mở Cài đặt của máy để bật lại.')
  }

  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      void cleanup()
      reject(new Error('Không lấy được mã thiết bị từ Firebase. Kiểm tra mạng rồi thử lại.'))
    }, timeoutMs)

    let handles: Array<{ remove: () => Promise<void> }> = []
    const cleanup = async () => {
      clearTimeout(timer)
      await Promise.all(handles.map((h) => h.remove())).catch(() => {})
    }

    void (async () => {
      handles = await Promise.all([
        PushNotifications.addListener('registration', (t: Token) => {
          void cleanup()
          resolve(t.value)
        }),
        PushNotifications.addListener('registrationError', (err: { error: string }) => {
          void cleanup()
          reject(new Error(err.error))
        }),
      ])
      await PushNotifications.register()
    })()
  })

  remember(token)
  const info = await Device.getInfo().catch(() => null)
  return {
    token,
    platform: nativePlatform(),
    model: info ? `${info.manufacturer ?? ''} ${info.model}`.trim().slice(0, 80) : undefined,
    appVersion: info?.osVersion?.slice(0, 40),
  }
}

/** Gỡ đăng ký trên máy này (vẫn phải gọi `notify.unregisterNative` để xoá ở server). */
export async function unregisterPush(): Promise<void> {
  remember(null)
  if (!isNative()) return
  await PushNotifications.removeAllListeners().catch(() => {})
  await PushNotifications.unregister().catch(() => {})
}

// ------------------------------------------------------- local notifications

export type UpcomingItem = { id: string; title: string; body: string; url: string; fireAt: Date }

/**
 * Local notification cần id dạng **số 32-bit**, còn thông báo của server là
 * cuid. Băm cuid thành số (FNV-1a) để mỗi lần đồng bộ lại ra đúng id cũ —
 * nhờ vậy đặt lại lịch là ghi đè chứ không đẻ thêm bản trùng.
 */
export function localId(cuid: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < cuid.length; i++) {
    h ^= cuid.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Android yêu cầu id khác 0; giữ trong khoảng dương của int32.
  return (h >>> 1) || 1
}

/**
 * Đặt lại toàn bộ lịch nhắc cục bộ theo danh sách server trả về.
 *
 * Xoá hết rồi đặt lại thay vì so sánh từng cái: danh sách chỉ vài chục dòng,
 * mà logic "cái nào đã đổi giờ, cái nào đã bị huỷ vì tick xong" thì rất dễ
 * sai — và sai kiểu đó là người dùng bị nhắc một việc đã làm xong.
 *
 * @returns số thông báo đã đặt
 */
export async function syncLocalNotifications(items: UpcomingItem[]): Promise<number> {
  if (!isNative()) return 0

  let perm = await LocalNotifications.checkPermissions()
  if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
    perm = await LocalNotifications.requestPermissions()
  }
  if (perm.display !== 'granted') return 0

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
  }

  // Giờ đã qua thì hệ điều hành bắn ngay lập tức — lọc bỏ, nếu không mở app
  // buổi tối sẽ ăn một tràng nhắc của cả ngày hôm nay.
  const future = items.filter((i) => i.fireAt.getTime() > Date.now() + 5_000)
  if (future.length === 0) return 0

  await LocalNotifications.schedule({
    notifications: future.map((i) => ({
      id: localId(i.id),
      title: i.title,
      body: i.body,
      schedule: { at: i.fireAt, allowWhileIdle: true },
      // gộp với push cùng nội dung thay vì hiện hai lần
      group: i.id,
      threadIdentifier: i.id,
      extra: { notificationId: i.id, url: i.url },
    })),
  })
  return future.length
}

/** Xoá sạch lịch cục bộ — dùng khi đăng xuất, để máy không nhắc việc của người cũ. */
export async function clearLocalNotifications(): Promise<void> {
  if (!isNative()) return
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length === 0) return
  await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
}
