/**
 * Nhắc lễ tết Việt Nam.
 *
 * Khác nhắc sự kiện ở hai điểm:
 *  - nguồn là danh mục dựng sẵn (`lib/holidays.ts`), không có hàng nào trong DB
 *    nên cũng không cần cache occurrence — quy đổi tại chỗ, rẻ hơn một truy vấn;
 *  - gửi cho CẢ NHÀ chứ không riêng phụ huynh: Trung Thu và ngày nghỉ lễ là
 *    chuyện bọn trẻ mong nhất.
 *
 * Dùng lại `kind` EVENT_AHEAD / EVENT_TODAY: với người nhận thì đây vẫn là
 * "sắp tới có ngày này", và `refTable = 'holiday'` đã đủ để phân biệt nguồn.
 */
import { db } from '../db.js'
import { HOLIDAYS, holidayRef, remindOffsets, holidaysBetween } from '../lib/holidays.js'
import type { HolidayOccurrence } from '../lib/holidays.js'
import { addDays, diffDays, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { channelSelect, plannedChannels } from './channels.js'
import { inQuietHours } from './materialize.js'

/** Sinh trước lịch nhắc lễ cho bao nhiêu ngày tới. */
const HORIZON_DAYS = 60

/** Giờ VN bắn nhắc lễ. Cố định: ngày lễ không có "giờ đến hạn" như việc nhà. */
export const HOLIDAY_REMIND_AT = '08:00'

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

const dayMonthOf = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`

/** Câu mô tả ngày lễ: ngày dương, ngày âm, được nghỉ hay không, chú thích. */
export function holidayBody(occ: HolidayOccurrence): string {
  const span = occ.endDate ? `${dayMonthOf(occ.startDate)} → ${dayMonthOf(occ.endDate)}` : dayMonthOf(occ.startDate)
  const parts = [span]
  if (occ.holiday.calendar === 'LUNAR') {
    parts.push(`${occ.lunar.day}/${occ.lunar.month}${occ.lunar.leap ? ' nhuận' : ''} âm lịch`)
  }
  if (occ.dayCount > 1) parts.push(`${occ.dayCount} ngày`)
  if (occ.holiday.dayOff) parts.push('được nghỉ')
  const head = parts.join(' · ')
  return occ.holiday.note ? `${head}\n${occ.holiday.note}` : head
}

export function holidayDraft(occ: HolidayOccurrence, daysAhead: number) {
  const body = holidayBody(occ)
  if (daysAhead === 0) return { title: `Hôm nay là ${occ.holiday.title}`, body }
  if (daysAhead === 1) return { title: `Ngày mai: ${occ.holiday.title}`, body }
  return { title: `Còn ${daysAhead} ngày: ${occ.holiday.title}`, body }
}

/** Có ngày lễ nào bật nhắc không — khỏi truy vấn user nếu danh mục tắt hết. */
const ANY_REMINDABLE = HOLIDAYS.some((h) => h.remind)

/**
 * Sinh thông báo cho các ngày lễ trong HORIZON_DAYS ngày tới.
 * Chạy lại được nhiều lần: unique index (userId, kind, refTable, refId, fireAt)
 * cộng skipDuplicates đảm bảo không đẻ trùng.
 */
export async function materializeHolidays(now: Date = new Date()): Promise<number> {
  if (!ANY_REMINDABLE) return 0
  const today = vnToday(now)
  const until = addDays(today, HORIZON_DAYS)

  const occurrences = holidaysBetween(today, until).filter((o) => o.holiday.remind)
  if (occurrences.length === 0) return 0

  const users = await db.user.findMany({
    where: { active: true, notifyHolidays: true },
    select: { id: true, quietFrom: true, quietTo: true, ...channelSelect },
  })
  if (users.length === 0) return 0

  const plans: Plan[] = []

  for (const u of users) {
    const channels = plannedChannels(u)
    if (channels.length === 0) continue

    for (const occ of occurrences) {
      for (const daysAhead of remindOffsets(occ.holiday)) {
        const fireDate = addDays(occ.startDate, -daysAhead)
        if (diffDays(today, fireDate) < 0) continue
        const fireAt = vnDateTimeToUtc(fireDate, HOLIDAY_REMIND_AT)
        if (fireAt.getTime() <= now.getTime()) continue
        if (inQuietHours(vnTimeOf(fireAt), u.quietFrom, u.quietTo)) continue

        const d = holidayDraft(occ, daysAhead)
        plans.push({
          userId: u.id,
          kind: daysAhead === 0 ? 'EVENT_TODAY' : 'EVENT_AHEAD',
          refTable: 'holiday',
          refId: holidayRef(occ.holiday.id, occ.startDate),
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

/**
 * Xoá lịch nhắc lễ còn treo của một người — gọi khi họ tắt "nhắc ngày lễ".
 * Không xoá thì 60 ngày tới vẫn nổ đều dù đã tắt.
 */
export async function clearHolidayNotifications(userId: string): Promise<number> {
  const res = await db.notification.deleteMany({
    where: {
      userId,
      refTable: 'holiday',
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
  return res.count
}
