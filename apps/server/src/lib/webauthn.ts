import { env } from '../env.js'

/**
 * Passkey gắn với domain (rpID). Lấy từ WEB_ORIGIN để dev (localhost) và prod
 * (reminder.nguyenvando.com) không phải cấu hình thêm. Đổi domain là passkey
 * cũ mất tác dụng — đó là thiết kế của WebAuthn, không phải lỗi.
 */
const origins = env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)

export const RP_NAME = 'Family Hub'
export const RP_ID = new URL(origins[0] ?? 'http://localhost').hostname
export const EXPECTED_ORIGINS = origins

export const CHALLENGE_TTL_MS = 5 * 60_000
