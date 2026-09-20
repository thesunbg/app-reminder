import webpush from 'web-push'
import { db } from '../db.js'
import { env } from '../env.js'

export const webPushEnabled = () =>
  env.VAPID_PUBLIC_KEY.length > 0 && env.VAPID_PRIVATE_KEY.length > 0

if (webPushEnabled()) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || 'mailto:admin@localhost',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  )
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } }

/**
 * Seam để test: mặc định là web-push thật, test thay bằng hàm giả.
 * Không có nó thì muốn test logic quản lý thiết bị phải dựng server TLS —
 * tức là đi test lại tầng mã hoá của web-push chứ không phải code ở đây.
 */
export type PushSender = (target: PushTarget, body: string) => Promise<void>

const realSender: PushSender = async (target, body) => {
  await webpush.sendNotification(target, body, { TTL: 60 * 60 })
}

let sender: PushSender = realSender

/** Chỉ dùng trong test. Trả về hàm khôi phục sender thật. */
export function __setPushSender(fn: PushSender): () => void {
  sender = fn
  return () => { sender = realSender }
}

/**
 * Gửi tới mọi thiết bị của user. Endpoint hết hạn (404/410) sẽ bị xoá —
 * nếu không, danh sách thiết bị sẽ phình ra và mỗi lần gửi đều tốn thời gian
 * chờ các endpoint chết.
 * @returns số thiết bị nhận được
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!webPushEnabled()) throw new Error('VAPID chưa được cấu hình')
  const devices = await db.pushDevice.findMany({ where: { userId } })
  if (devices.length === 0) throw new Error('Chưa có thiết bị nào đăng ký Web Push')

  const body = JSON.stringify(payload)
  const dead: string[] = []
  let ok = 0

  await Promise.all(
    devices.map(async (d) => {
      try {
        await sender({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, body)
        ok++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(d.id)
      }
    }),
  )

  if (dead.length > 0) {
    await db.pushDevice.deleteMany({ where: { id: { in: dead } } })
  }
  if (ok === 0) throw new Error('Không thiết bị nào nhận được Web Push')
  return ok
}
