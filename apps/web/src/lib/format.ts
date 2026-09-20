export const VN_TZ = 'Asia/Ho_Chi_Minh'

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
const WEEKDAYS_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

/** Hôm nay theo giờ VN, dạng YYYY-MM-DD. Không phụ thuộc múi giờ của máy. */
export function today(): string {
  return new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function parts(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() }
}

export function weekdayLabel(date: string): string {
  return WEEKDAYS[parts(date).w] ?? ''
}

export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[parts(date).w] ?? ''
}

export function dayMonth(date: string): string {
  const p = parts(date)
  return `${p.d}/${p.m}`
}

export function fullDate(date: string): string {
  const p = parts(date)
  return `${WEEKDAYS[p.w]}, ${p.d}/${p.m}/${p.y}`
}

export function relativeDay(date: string): string | null {
  const t = today()
  if (date === t) return 'Hôm nay'
  if (date === addDays(t, -1)) return 'Hôm qua'
  if (date === addDays(t, 1)) return 'Ngày mai'
  return null
}

export function minutesLabel(min: number): string {
  if (min < 60) return `${min} phút`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} giờ` : `${h}h${String(m).padStart(2, '0')}`
}

/** Hiện tại là trước/sau mốc HH:mm của hôm nay (giờ VN)? */
export function nowVnTime(): string {
  return new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(11, 16)
}
