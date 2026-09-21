import { db } from '../db.js'
import { addDays, diffDays, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { inQuietHours } from './materialize.js'
import { plannedChannels } from './channels.js'

/**
 * Nhắc bài tập cho CON: 19:00 tối hôm trước và 07:00 sáng ngày nộp.
 * Chỉ nhắc con — phụ huynh nhìn dashboard, không cần bị réo cùng lúc.
 */
const HORIZON_DAYS = 14
const SLOTS: { daysBefore: number; time: string }[] = [
  { daysBefore: 1, time: '19:00' },
  { daysBefore: 0, time: '07:00' },
]

export const homeworkRef = (id: string, date: string, slot: number) => `${id}:${date}:${slot}`

export async function materializeHomework(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)
  const records = await db.studyRecord.findMany({
    where: { kind: 'HOMEWORK', doneAt: null, date: { gte: today, lte: addDays(today, HORIZON_DAYS) } },
    include: { child: true },
  })
  if (records.length === 0) return 0

  const plans = []
  for (const r of records) {
    const u = r.child
    if (!u.active) continue
    const channels = plannedChannels(u)
    if (channels.length === 0) continue

    const d = `${Number(r.date.slice(8, 10))}/${Number(r.date.slice(5, 7))}`
    for (const [i, slot] of SLOTS.entries()) {
      const fireDate = addDays(r.date, -slot.daysBefore)
      if (diffDays(today, fireDate) < 0) continue
      const fireAt = vnDateTimeToUtc(fireDate, slot.time)
      if (fireAt.getTime() <= now.getTime()) continue
      if (inQuietHours(vnTimeOf(fireAt), u.quietFrom, u.quietTo)) continue
      plans.push({
        userId: u.id,
        kind: 'HOMEWORK_DUE' as const,
        refTable: 'homework',
        refId: homeworkRef(r.id, r.date, i),
        title: slot.daysBefore === 0 ? `Nộp hôm nay: ${r.title}` : `Bài tập mai nộp: ${r.title}`,
        body: `${r.subject} · hạn ${d}${r.note ? `\n${r.note}` : ''}`,
        fireAt,
        channels,
      })
    }
  }
  if (plans.length === 0) return 0
  const res = await db.notification.createMany({ data: plans, skipDuplicates: true })
  return res.count
}

/** Xoá lịch nhắc tương lai của một bài tập (khi xong, sửa hạn, hoặc xoá). */
export async function clearHomeworkNotifications(id: string): Promise<void> {
  await db.notification.deleteMany({
    where: {
      refTable: 'homework',
      refId: { startsWith: `${id}:` },
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
}
