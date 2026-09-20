import { db } from '../db.js'
import { minutesText } from '../lib/text.js'
import { vnDateTimeToUtc, vnToday } from '../lib/time.js'
import { buildAutoSummary, getAutoEntry } from './auto.js'

export const digestRef = (date: string) => `digest:${date}`

/**
 * Sinh thông báo tổng kết cuối ngày cho hôm nay.
 *
 * Chỉ sinh cho HÔM NAY, không sinh trước nhiều ngày như các loại khác: nội dung
 * phụ thuộc vào việc bạn làm được gì trong ngày, nên sinh sớm cũng vô nghĩa.
 */
export async function materializeDigests(now: Date = new Date()): Promise<number> {
  const date = vnToday(now)
  const users = await db.user.findMany({
    where: { active: true, dailyDigestAt: { not: null } },
  })
  if (users.length === 0) return 0

  const plans = users
    .map((u) => {
      const channels: string[] = []
      if (u.notifyTelegram && u.telegramChatId) channels.push('telegram')
      if (u.notifyWebPush) channels.push('webpush')
      if (channels.length === 0) return null

      const fireAt = vnDateTimeToUtc(date, u.dailyDigestAt!)
      if (fireAt.getTime() <= now.getTime()) return null

      return {
        userId: u.id,
        kind: 'DAILY_DIGEST' as const,
        refTable: 'digest',
        refId: digestRef(date),
        // nội dung thật được tính lại lúc gửi, xem refreshDigestBody
        title: 'Tổng kết hôm nay',
        body: '…',
        fireAt,
        channels,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  if (plans.length === 0) return 0
  const res = await db.notification.createMany({ data: plans, skipDuplicates: true })
  return res.count
}

/**
 * Tính nội dung tổng kết ngay trước khi gửi, đồng thời chốt bản nhật ký
 * tự động của ngày hôm đó.
 */
export async function buildDigest(
  userId: string,
  date: string,
): Promise<{ title: string; body: string }> {
  const summary = await buildAutoSummary(userId, date)
  await getAutoEntry(userId, date)

  const wrote = await db.diaryEntry.findUnique({
    where: { userId_date_source: { userId, date, source: 'MANUAL' } },
  })

  const head =
    summary.due === 0
      ? 'Hôm nay không có việc nào trong lịch.'
      : `Hôm nay xong ${summary.done}/${summary.due} việc` +
        (summary.totalMinutes > 0 ? `, tổng ${minutesText(summary.totalMinutes)}.` : '.')

  const parts = [head]
  if (summary.text) parts.push(summary.text)
  parts.push(wrote ? '✍️ Nhật ký hôm nay đã viết.' : '✍️ Chưa viết nhật ký — mở app ghi vài dòng?')

  return { title: 'Tổng kết hôm nay', body: parts.join('\n') }
}
