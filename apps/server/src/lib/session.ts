import { createHash, randomBytes } from 'node:crypto'
import { db } from '../db.js'

export const SESSION_COOKIE = 'fh_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60 // 60 ngày
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2

/** Cookie giữ token thô; DB chỉ giữ SHA-256 của nó. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url')
  await db.session.create({
    data: {
      id: hashToken(token),
      userId,
      userAgent: userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })
  return { token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) }
}

export async function validateSession(token: string | undefined) {
  if (!token) return null
  const id = hashToken(token)
  const session = await db.session.findUnique({
    where: { id },
    include: { user: { include: { family: true } } },
  })
  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id } }).catch(() => {})
    return null
  }
  if (!session.user.active) return null

  // gia hạn trượt khi đã đi quá nửa vòng đời
  if (session.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    await db.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    })
  }
  return session
}

export async function invalidateSession(token: string | undefined) {
  if (!token) return
  await db.session.delete({ where: { id: hashToken(token) } }).catch(() => {})
}

export async function invalidateAllSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } })
}
