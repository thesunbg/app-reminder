/**
 * Đếm lần thử sai trong bộ nhớ — chặn dò mã TOTP/mã khôi phục (6 số chỉ có
 * 1 triệu khả năng). Một tiến trình server nên Map là đủ; restart thì reset,
 * chấp nhận được vì ticket bước 2 cũng chỉ sống 5 phút.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

export function registerFailure(key: string, max: number, windowMs: number): { blocked: boolean; left: number } {
  const now = Date.now()
  const b = buckets.get(key)
  const cur = b && b.resetAt > now ? b : { count: 0, resetAt: now + windowMs }
  cur.count += 1
  buckets.set(key, cur)
  return { blocked: cur.count >= max, left: Math.max(0, max - cur.count) }
}

export function isBlocked(key: string, max: number): boolean {
  const b = buckets.get(key)
  if (!b) return false
  if (b.resetAt <= Date.now()) {
    buckets.delete(key)
    return false
  }
  return b.count >= max
}

export function clearFailures(key: string): void {
  buckets.delete(key)
}
