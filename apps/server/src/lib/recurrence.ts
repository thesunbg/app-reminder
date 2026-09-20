import * as rruleNs from 'rrule'

// rrule@2 là bundle CJS không khai báo "exports" nên named import ESM hỏng.
// Lấy qua interop default để chạy được cả khi Node resolve sang CJS lẫn ESM.
const rrule = ((rruleNs as unknown as { default?: typeof rruleNs }).default ?? rruleNs)
const { RRule, rrulestr } = rrule
type RRule = InstanceType<typeof RRule>

/**
 * Ngày lịch được xử lý như "floating date" neo ở UTC-midnight.
 * Nhờ vậy thứ trong tuần luôn khớp với lịch VN mà không bị lệch múi giờ.
 */
function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

const cache = new Map<string, RRule>()

function parse(rule: string, dtstart: string): RRule {
  const key = `${rule}|${dtstart}`
  const hit = cache.get(key)
  if (hit) return hit
  const body = rule.startsWith('RRULE:') ? rule : `RRULE:${rule}`
  const parsed = rrulestr(body, { dtstart: utcMidnight(dtstart), forceset: false })
  const r = parsed instanceof RRule ? parsed : RRule.fromString(body)
  cache.set(key, r)
  return r
}

/** Routine có rơi vào `date` (YYYY-MM-DD) không? */
export function occursOn(rule: string, dtstart: string, date: string): boolean {
  if (date < dtstart) return false
  const r = parse(rule, dtstart)
  const day = utcMidnight(date)
  const next = new Date(day.getTime() + 86_400_000 - 1)
  return r.between(day, next, true).length > 0
}

/** Các ngày routine rơi vào trong khoảng [from, to]. */
export function occurrencesBetween(rule: string, dtstart: string, from: string, to: string): string[] {
  const r = parse(rule, dtstart)
  const lo = utcMidnight(from < dtstart ? dtstart : from)
  const hi = new Date(utcMidnight(to).getTime() + 86_400_000 - 1)
  return r.between(lo, hi, true).map((d) => d.toISOString().slice(0, 10))
}

/** Kiểm tra chuỗi RRULE hợp lệ. */
export function isValidRRule(rule: string): boolean {
  try {
    parse(rule, '2020-01-01')
    return true
  } catch {
    return false
  }
}

export const RRULE_PRESETS = {
  daily: 'FREQ=DAILY',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekend: 'FREQ=WEEKLY;BYDAY=SA,SU',
  weekly: (day: string) => `FREQ=WEEKLY;BYDAY=${day}`,
} as const
