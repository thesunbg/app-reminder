/** VAPID public key ở dạng base64url; PushManager cần Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string }

export function checkPushSupport(): PushSupport {
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'Trình duyệt không hỗ trợ Service Worker' }
  if (!('PushManager' in window)) return { ok: false, reason: 'Trình duyệt không hỗ trợ Web Push' }
  if (!('Notification' in window)) return { ok: false, reason: 'Trình duyệt không hỗ trợ thông báo' }
  // iOS chỉ cho Web Push khi PWA đã được thêm vào màn hình chính
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (isIOS && !standalone) {
    return { ok: false, reason: 'Trên iPhone/iPad cần thêm app vào Màn hình chính trước (Chia sẻ → Thêm vào MH chính)' }
  }
  return { ok: true }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.ready
  return reg
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const support = checkPushSupport()
  if (!support.ok) return null
  const reg = await registration()
  return reg.pushManager.getSubscription()
}

export type SubscribeResult = { endpoint: string; p256dh: string; auth: string; platform: string }

export async function subscribePush(vapidPublicKey: string): Promise<SubscribeResult> {
  const support = checkPushSupport()
  if (!support.ok) throw new Error(support.reason)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Bạn đã chặn thông báo cho trang này. Mở cài đặt trình duyệt để bật lại.'
        : 'Bạn chưa cho phép hiển thị thông báo.',
    )
  }

  const reg = await registration()
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }))

  const json = sub.toJSON()
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error('Trình duyệt không trả về khoá mã hoá')

  return {
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    platform: navigator.userAgent.slice(0, 80),
  }
}

export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}
