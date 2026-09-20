/**
 * Việt Nam: UTC+7 cố định, không có DST.
 * Quy ước: "ngày" trong DB là chuỗi "YYYY-MM-DD" theo giờ VN.
 */
export const VN_OFFSET_MIN = 7 * 60
export const VN_TZ = 'Asia/Ho_Chi_Minh'

/** Ngày hiện tại theo giờ VN, dạng "YYYY-MM-DD". */
export function vnToday(now: Date = new Date()): string {
  return vnDateOf(now)
}

/** Quy đổi một Date (UTC) sang chuỗi ngày theo giờ VN. */
export function vnDateOf(d: Date): string {
  const shifted = new Date(d.getTime() + VN_OFFSET_MIN * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/** "HH:mm" theo giờ VN của một Date. */
export function vnTimeOf(d: Date): string {
  const shifted = new Date(d.getTime() + VN_OFFSET_MIN * 60_000)
  return shifted.toISOString().slice(11, 16)
}

/** Ghép ngày VN + giờ VN thành Date (UTC) chính xác. */
export function vnDateTimeToUtc(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? time : time.slice(0, 5)}:00+07:00`)
}

/** Cộng ngày vào chuỗi "YYYY-MM-DD" (an toàn với biên tháng/năm). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Số ngày giữa hai chuỗi ngày (b - a). */
export function diffDays(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`)
  const dbb = Date.parse(`${b}T00:00:00Z`)
  return Math.round((dbb - da) / 86_400_000)
}

/** 1 = Thứ 2 ... 7 = Chủ nhật (theo ISO), cho một chuỗi ngày. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** Ngày thứ 2 của tuần chứa `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1))
}

/** Mảng ngày liên tiếp [from..to] inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}
