import type { Event } from '@prisma/client'
import { db } from '../db.js'
import { lunarMonthLength, lunarOf, lunarToSolar, toSolarString } from '../lib/lunar.js'
import { addDays, diffDays, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { inQuietHours } from './materialize.js'
import { plannedChannels } from './channels.js'

/** Sinh trước lịch nhắc sự kiện cho bao nhiêu ngày tới. */
const HORIZON_DAYS = 60
/** Sinh sẵn occurrence cho mấy năm quanh năm hiện tại. */
const YEAR_SPAN = [-1, 0, 1, 2] as const

export const eventRef = (eventId: string, solarDate: string) => `${eventId}:${solarDate}`

/**
 * Quy đổi một ngày giỗ âm lịch sang dương lịch cho một năm âm cụ thể.
 *
 * Hai quy ước dân gian được áp dụng ở đây:
 *  - Ngày 30 ở tháng thiếu (chỉ 29 ngày) thì cúng ngày 29, không bỏ.
 *  - Ghi là tháng nhuận nhưng năm đó không nhuận thì cúng ở tháng thường
 *    cùng số — không bỏ giỗ.
 */
export function resolveLunarAnniversary(
  lunarDay: number,
  lunarMonth: number,
  wantLeap: boolean,
  lunarYear: number,
): string | null {
  const leap = wantLeap && lunarToSolar(1, lunarMonth, lunarYear, true) !== null
  const len = lunarMonthLength(lunarMonth, lunarYear, leap)
  if (len === 0) return null
  const day = Math.min(lunarDay, len)
  const solar = lunarToSolar(day, lunarMonth, lunarYear, leap)
  return solar ? toSolarString(solar) : null
}

/** Ngày dương của một sự kiện trong một "năm" (năm âm với LUNAR, năm dương với SOLAR). */
export function resolveOccurrence(event: Event, year: number): string | null {
  if (event.calendar === 'LUNAR') {
    if (!event.lunarDay || !event.lunarMonth) return null
    return resolveLunarAnniversary(event.lunarDay, event.lunarMonth, event.lunarLeap, year)
  }

  if (!event.solarDate) return null
  if (!event.yearly) return event.solarDate // sự kiện một lần

  // lặp hàng năm: solarDate lưu dạng "MM-DD" hoặc "YYYY-MM-DD"
  const md = event.solarDate.length === 5 ? event.solarDate : event.solarDate.slice(5)
  const [mmRaw, ddRaw] = md.split('-')
  const mm = Number(mmRaw)
  const dd = Number(ddRaw)
  if (!mm || !dd) return null

  // 29/2 ở năm không nhuận -> lùi về 28/2
  const daysInMonth = new Date(Date.UTC(year, mm, 0)).getUTCDate()
  return `${year}-${String(mm).padStart(2, '0')}-${String(Math.min(dd, daysInMonth)).padStart(2, '0')}`
}

/** Sinh/cập nhật bảng cache EventOccurrence cho các năm quanh hiện tại. */
export async function materializeEventOccurrences(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)
  const solarYear = Number(today.slice(0, 4))
  const lunarYear = lunarOf(today).year

  const events = await db.event.findMany()
  let written = 0

  for (const event of events) {
    const base = event.calendar === 'LUNAR' ? lunarYear : solarYear
    const years = event.calendar === 'SOLAR' && !event.yearly ? [base] : YEAR_SPAN.map((d) => base + d)

    for (const year of years) {
      const solarDate = resolveOccurrence(event, year)
      if (!solarDate) continue
      const existing = await db.eventOccurrence.findUnique({
        where: { eventId_year: { eventId: event.id, year } },
      })
      if (existing?.solarDate === solarDate) continue
      await db.eventOccurrence.upsert({
        where: { eventId_year: { eventId: event.id, year } },
        create: { eventId: event.id, year, solarDate },
        update: { solarDate },
      })
      written++
    }
  }
  return written
}

type Plan = {
  userId: string
  kind: 'EVENT_AHEAD' | 'EVENT_TODAY'
  refTable: string
  refId: string
  title: string
  body: string
  fireAt: Date
  channels: string[]
}

const TYPE_WORD: Record<string, string> = {
  DEATH_ANNIVERSARY: 'Ngày giỗ',
  BIRTHDAY: 'Sinh nhật',
  OTHER: 'Sự kiện',
}

function draft(event: Event, solarDate: string, daysAhead: number) {
  const what = TYPE_WORD[event.type] ?? 'Sự kiện'
  const lunar = event.calendar === 'LUNAR' ? lunarOf(solarDate) : null
  const dayMonth = `${Number(solarDate.slice(8, 10))}/${Number(solarDate.slice(5, 7))}`
  const lunarText = lunar ? ` (${lunar.day}/${lunar.month}${lunar.leap ? ' nhuận' : ''} âm lịch)` : ''

  if (daysAhead === 0) {
    return {
      title: `${what} hôm nay: ${event.title}`,
      body: `${dayMonth}${lunarText}${event.note ? `\n${event.note}` : ''}`,
    }
  }
  return {
    title: `Còn ${daysAhead} ngày: ${what.toLowerCase()} ${event.title}`,
    body: `Ngày ${dayMonth}${lunarText}${event.note ? `\n${event.note}` : ''}`,
  }
}

/**
 * Sinh thông báo cho các sự kiện sắp tới.
 *
 * Người nhận là các thành viên PHỤ HUYNH đang hoạt động: giỗ chạp và sinh nhật
 * là việc người lớn phải chuẩn bị, không cần dựng con dậy lúc 8h sáng.
 */
export async function materializeEvents(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)
  const until = addDays(today, HORIZON_DAYS)

  const occurrences = await db.eventOccurrence.findMany({
    where: { solarDate: { gte: today, lte: until } },
    include: { event: { include: { family: { include: { users: true } } } } },
  })
  if (occurrences.length === 0) return 0

  const plans: Plan[] = []

  for (const occ of occurrences) {
    const event = occ.event
    const recipients = event.family.users.filter((u) => u.active && u.role === 'PARENT')

    // bỏ trùng và sắp xếp để 0 (đúng ngày) luôn được xét
    const offsets = [...new Set(event.remindBeforeDays)].filter((d) => d >= 0).sort((a, b) => b - a)

    for (const u of recipients) {
      const channels = plannedChannels(u)
      if (channels.length === 0) continue

      for (const daysAhead of offsets) {
        const fireDate = addDays(occ.solarDate, -daysAhead)
        if (diffDays(today, fireDate) < 0) continue
        const fireAt = vnDateTimeToUtc(fireDate, event.remindAtTime)
        if (fireAt.getTime() <= now.getTime()) continue
        if (inQuietHours(vnTimeOf(fireAt), u.quietFrom, u.quietTo)) continue

        const d = draft(event, occ.solarDate, daysAhead)
        plans.push({
          userId: u.id,
          kind: daysAhead === 0 ? 'EVENT_TODAY' : 'EVENT_AHEAD',
          refTable: 'event',
          refId: eventRef(event.id, occ.solarDate),
          title: d.title,
          body: d.body,
          fireAt,
          channels,
        })
      }
    }
  }

  if (plans.length === 0) return 0
  const res = await db.notification.createMany({ data: plans, skipDuplicates: true })
  return res.count
}

/** Xoá lịch nhắc tương lai của một sự kiện (khi sửa hoặc xoá nó). */
export async function clearEventNotifications(eventId: string): Promise<void> {
  await db.notification.deleteMany({
    where: {
      refTable: 'event',
      refId: { startsWith: `${eventId}:` },
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
}
