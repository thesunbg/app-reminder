/**
 * Push native qua Firebase Cloud Messaging HTTP v1.
 *
 * Vì sao FCM chứ không phải APNs trực tiếp: một endpoint lo cả Android lẫn iOS
 * (Firebase nhận uỷ quyền APNs key), nên chỉ phải giữ một loại khoá. Đổi lại
 * phải tự ký JWT service account — nhưng đó là ~30 dòng dưới đây, nhẹ hơn
 * nhiều so với kéo về `firebase-admin` (hàng chục MB, mang theo cả gRPC).
 *
 * HTTP v1 chứ không phải API "legacy" (khoá máy chủ): Google đã tắt legacy
 * từ 2024, bất kỳ hướng dẫn nào còn nói tới `key=AAAA...` đều đã lỗi thời.
 */
import { createSign } from 'node:crypto'
import { db } from '../db.js'
import { env } from '../env.js'

export type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
}

/** Lỗi cấu hình đọc được — nói rõ sai ở đâu thay vì ném JSON.parse thô. */
function parseServiceAccount(raw: string): ServiceAccount | null {
  if (!raw.trim()) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT không phải JSON hợp lệ')
  }
  const sa = json as Partial<ServiceAccount>
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT thiếu project_id/client_email/private_key')
  }
  // Khi dán JSON vào biến môi trường, xuống dòng trong private_key thường bị
  // giữ nguyên dạng "\n" hai ký tự. Không thay thì createSign báo lỗi khó hiểu.
  return { ...sa, private_key: sa.private_key.replace(/\\n/g, '\n') } as ServiceAccount
}

type CachedToken = { value: string; expiresAt: number }
let cached: CachedToken | null = null

let account: ServiceAccount | null = null
let accountError: string | null = null
let tokenUrl = env.FCM_TOKEN_URL

function load(raw: string): void {
  account = null
  accountError = null
  try {
    account = parseServiceAccount(raw)
  } catch (err) {
    accountError = (err as Error).message
  }
  cached = null
}
load(env.FCM_SERVICE_ACCOUNT)

export const fcmEnabled = () => account !== null

/** Vì sao chưa bật — để màn hình Cài đặt nói được điều gì đó hữu ích. */
export const fcmConfigError = () => accountError

/**
 * Chỉ dùng trong test: nạp service account khác và trỏ chỗ xin token đi nơi
 * khác. Phải là hàm chứ không phải biến môi trường, vì `env` được đọc một lần
 * lúc import — import lại module cũng không thấy giá trị mới.
 * @returns hàm khôi phục cấu hình thật
 */
export function __setServiceAccount(raw: string, url: string = env.FCM_TOKEN_URL): () => void {
  load(raw)
  tokenUrl = url
  return () => { load(env.FCM_SERVICE_ACCOUNT); tokenUrl = env.FCM_TOKEN_URL }
}

// ---------------------------------------------------------------- access token

const base64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Xin token mới sớm hơn hạn 60s để không gửi bằng token vừa hết hiệu lực. */
const EXPIRY_SKEW_MS = 60_000

function signedAssertion(sa: ServiceAccount, now: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
    }),
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key)
  return `${header}.${claims}.${base64url(signature)}`
}

/** Token OAuth2 dùng chung cho mọi lần gửi, cache tới sát hạn. */
export async function accessToken(now: number = Date.now()): Promise<string> {
  if (!account) throw new Error(accountError ?? 'FCM chưa được cấu hình')
  if (cached && cached.expiresAt > now) return cached.value

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(account, now),
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!res.ok || !body.access_token) {
    throw new Error(`Google từ chối cấp token: ${body.error_description ?? body.error ?? res.status}`)
  }
  cached = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS }
  return cached.value
}

// ---------------------------------------------------------------- gửi

export type NativePayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Kết quả gửi tới một token. `dead` = token không còn hợp lệ, phải xoá khỏi DB
 * (máy đã gỡ app / cài lại). Khác với lỗi mạng: cái đó thử lại được.
 */
export type SendOutcome = { ok: true } | { ok: false; dead: boolean; message: string }

export type NativeSender = (token: string, payload: NativePayload) => Promise<SendOutcome>

/**
 * FCM báo token chết bằng các mã này; mọi mã khác coi là lỗi tạm thời.
 *
 * Cố ý KHÔNG có `INVALID_ARGUMENT`: FCM trả mã đó cho cả payload sai định dạng
 * (vd tiêu đề quá dài) chứ không riêng token hỏng. Xếp nó vào đây thì một
 * thông báo lỗi sẽ xoá sạch thiết bị của người đó.
 */
const DEAD_STATUSES = new Set(['UNREGISTERED', 'NOT_FOUND', 'SENDER_ID_MISMATCH'])

const realSender: NativeSender = async (token, payload) => {
  const token_ = await accessToken()
  const res = await fetch(`${env.FCM_API_BASE}/${account!.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token_}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        // `notification` để OS tự hiện khi app đóng; `data` để app mở đúng màn
        // hình khi người dùng bấm vào.
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url ?? '/', tag: payload.tag ?? '' },
        android: { priority: 'HIGH', notification: { sound: 'default', tag: payload.tag || undefined } },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { sound: 'default', 'thread-id': payload.tag || undefined } },
        },
      },
    }),
  })
  if (res.ok) return { ok: true }

  const err = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> }
  }
  const status = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status ?? String(res.status)
  return { ok: false, dead: DEAD_STATUSES.has(status), message: `${status}: ${err.error?.message ?? res.statusText}` }
}

let sender: NativeSender = realSender

/** Chỉ dùng trong test. Trả về hàm khôi phục sender thật. */
export function __setNativeSender(fn: NativeSender): () => void {
  sender = fn
  return () => { sender = realSender }
}

/**
 * Gửi tới mọi thiết bị native của user. Token chết bị xoá ngay — FCM tính token
 * chết là lỗi chứ không phải "không có ai nhận", nên giữ lại sẽ làm mọi lần gửi
 * sau đều có vẻ thất bại một phần.
 * @returns số thiết bị nhận được
 */
export async function sendNativeToUser(userId: string, payload: NativePayload): Promise<number> {
  if (!fcmEnabled()) throw new Error(accountError ?? 'FCM chưa được cấu hình')
  const devices = await db.nativeDevice.findMany({ where: { userId } })
  if (devices.length === 0) throw new Error('Chưa có thiết bị nào cài app')

  const dead: string[] = []
  const errors: string[] = []
  let ok = 0

  await Promise.all(
    devices.map(async (d) => {
      try {
        const outcome = await sender(d.token, payload)
        if (outcome.ok) { ok++; return }
        if (outcome.dead) dead.push(d.id)
        errors.push(outcome.message)
      } catch (err) {
        errors.push((err as Error).message)
      }
    }),
  )

  if (dead.length > 0) await db.nativeDevice.deleteMany({ where: { id: { in: dead } } })
  if (ok === 0) throw new Error(errors[0] ?? 'Không thiết bị nào nhận được push')
  return ok
}
