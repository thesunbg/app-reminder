import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'

/**
 * Mọi thứ ở đây khoá bằng SESSION_SECRET — đổi secret là mất bí mật TOTP đã
 * mã hoá (người dùng phải bật lại 2 bước) và mọi ticket đang dở dang hết hạn.
 */
const KEY = createHash('sha256').update(env.SESSION_SECRET).digest()

// ---------- mã hoá tại chỗ (AES-256-GCM) ----------

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(stored: string): string {
  const [iv, tag, ct] = stored.split('.').map((s) => Buffer.from(s, 'base64url'))
  if (!iv || !tag || !ct) throw new Error('ciphertext hỏng')
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// ---------- ticket ký HMAC, không cần bảng trong DB ----------
// Dùng cho: bước 2 sau khi nhập đúng mật khẩu, challenge WebAuthn.

export function signTicket<T extends object>(kind: string, payload: T, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ k: kind, exp: Date.now() + ttlMs, ...payload })).toString('base64url')
  const sig = createHmac('sha256', KEY).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyTicket<T extends object>(kind: string, ticket: string | undefined): T | null {
  if (!ticket) return null
  const [body, sig] = ticket.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', KEY).update(body).digest('base64url')
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { k: string; exp: number } & T
    if (data.k !== kind || data.exp < Date.now()) return null
    return data
  } catch {
    return null
  }
}

// ---------- mã khôi phục ----------

/** 8 mã dạng xxxx-xxxx, chữ thường + số, bỏ ký tự dễ nhầm (0/o, 1/l). */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8)
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
    return `${chars.slice(0, 4)}-${chars.slice(4)}`
  })
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex')
}
