import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * TOTP theo RFC 6238 (HMAC-SHA1, 6 số, bước 30 giây) — tương thích Google
 * Authenticator, Authy, 1Password, iOS Passwords. Tự viết vì chỉ cần ~40 dòng,
 * không đáng thêm dependency.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SEC = 30
export const TOTP_DIGITS = 6

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0, value = 0
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** 20 byte ngẫu nhiên = 32 ký tự base32, độ dài Google Authenticator hay dùng. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpCode(secret: string, atMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SEC) + stepOffset
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/** Chấp nhận lệch ±1 bước (30s) để bù đồng hồ điện thoại chạy sai chút ít. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const input = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(input)) return false
  for (const offset of [0, -1, 1]) {
    const expected = totpCode(secret, atMs, offset)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(input))) return true
  }
  return false
}

export function otpauthUri(secret: string, account: string, issuer = 'Family Hub'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SEC) })
  return `otpauth://totp/${label}?${params.toString()}`
}
