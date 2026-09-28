/**
 * Nhắc hẹn trong sổ sức khoẻ: mũi tiêm kế tiếp, ngày tái khám, ngày hết thuốc.
 *
 * Người nhận: chính chủ hồ sơ NẾU là phụ huynh, còn hồ sơ của con thì nhắc bố
 * mẹ — lịch tiêm chủng là việc người lớn phải xếp lịch đi làm để đưa con đi,
 * nhắc đứa bé lớp 5 thì không ai hành động cả.
 */
import { db } from '../db.js'
import { addDays, diffDays, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { channelSelect, plannedChannels } from './channels.js'
import { inQuietHours } from './materialize.js'

const HORIZON_DAYS = 60
/** Nhắc trước một tuần để xin nghỉ làm, trước một hôm, và đúng sáng hôm đó. */
const REMIND_BEFORE_DAYS = [7, 1, 0]
const REMIND_AT = '08:00'

export const healthRef = (recordId: string, date: string) => `${recordId}:${date}`

const KIND_WORD: Record<string, string> = {
  GROWTH: 'Đo lại',
  VACCINE: 'Mũi tiêm',
  CHECKUP: 'Lịch khám',
  MEDICINE: 'Thuốc',
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

export function healthDraft(
  record: { kind: string; title: string; note: string | null },
  personName: string,
  date: string,
  daysAhead: number,
) {
  const what = KIND_WORD[record.kind] ?? 'Hẹn'
  const dm = `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`
  const label = record.title.trim() || what
  const body = [`${dm} · ${personName}`, record.note].filter(Boolean).join('\n')

  if (daysAhead === 0) return { title: `Hôm nay: ${label}`, body }
  if (daysAhead === 1) return { title: `Ngày mai: ${label}`, body }
  return { title: `Còn ${daysAhead} ngày: ${label} (${what.toLowerCase()})`, body }
}

export async function materializeHealth(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)
  const until = addDays(today, HORIZON_DAYS)

  const records = await db.healthRecord.findMany({
    where: { nextDate: { gte: today, lte: until } },
    include: {
      user: {
        select: {
          id: true, name: true, role: true, familyId: true, active: true,
          quietFrom: true, quietTo: true, ...channelSelect,
        },
      },
    },
  })
  if (records.length === 0) return 0

  // hồ sơ của con -> nhắc phụ huynh; gom một lần cho mọi gia đình liên quan
  const familyIds = [...new Set(records.map((r) => r.user.familyId))]
  const parents = await db.user.findMany({
    where: { familyId: { in: familyIds }, role: 'PARENT', active: true },
    select: {
      id: true, name: true, familyId: true, quietFrom: true, quietTo: true, ...channelSelect,
    },
  })

  const plans: Plan[] = []

  for (const r of records) {
    const date = r.nextDate!
    const recipients =
      r.user.role === 'PARENT' && r.user.active
        ? [r.user]
        : parents.filter((p) => p.familyId === r.user.familyId)

    for (const u of recipients) {
      const channels = plannedChannels(u)
      if (channels.length === 0) continue

      for (const daysAhead of REMIND_BEFORE_DAYS) {
        const fireDate = addDays(date, -daysAhead)
        if (diffDays(today, fireDate) < 0) continue
        const fireAt = vnDateTimeToUtc(fireDate, REMIND_AT)
        if (fireAt.getTime() <= now.getTime()) continue
        if (inQuietHours(vnTimeOf(fireAt), u.quietFrom, u.quietTo)) continue

        const d = healthDraft(r, r.user.name, date, daysAhead)
        plans.push({
          userId: u.id,
          kind: daysAhead === 0 ? 'EVENT_TODAY' : 'EVENT_AHEAD',
          refTable: 'health',
          refId: healthRef(r.id, date),
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
 * Xoá lịch nhắc còn treo của một bản ghi (khi sửa ngày hẹn hoặc xoá).
 * Delete chứ không cancel: bản CANCELLED vẫn chiếm khoá unique và sẽ chặn bản
 * đúng được sinh lại nếu ngày hẹn quay về chỗ cũ.
 */
export async function clearHealthNotifications(recordId: string): Promise<number> {
  const res = await db.notification.deleteMany({
    where: {
      refTable: 'health',
      refId: { startsWith: `${recordId}:` },
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
  return res.count
}
