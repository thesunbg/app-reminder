import { db } from '../db.js'
import { occurrencesBetween } from '../lib/recurrence.js'
import { addDays, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { routineDraft } from './messages.js'

/** Sinh trước thông báo cho bao nhiêu ngày tới. */
const HORIZON_DAYS = 14

/** refId gói cả ngày để mỗi lần xuất hiện là một khoá riêng, và huỷ được theo ngày. */
export const routineRef = (routineId: string, date: string) => `${routineId}:${date}`

/** Thời điểm (VN) có nằm trong khoảng yên lặng không? Hỗ trợ khoảng vắt qua nửa đêm. */
export function inQuietHours(time: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  if (from === to) return false
  return from < to ? time >= from && time < to : time >= from || time < to
}

type Plan = {
  userId: string
  kind: 'ROUTINE_UPCOMING' | 'ROUTINE_DUE' | 'ROUTINE_NAG'
  refTable: string
  refId: string
  title: string
  body: string
  fireAt: Date
  channels: string[]
}

/**
 * Sinh các bản ghi Notification còn thiếu cho routine trong HORIZON_DAYS ngày tới.
 * Chạy lại được nhiều lần: unique index (userId, kind, refTable, refId, fireAt)
 * cộng skipDuplicates đảm bảo không đẻ trùng.
 */
export async function materializeRoutines(now: Date = new Date()): Promise<number> {
  const from = vnToday(now)
  const to = addDays(from, HORIZON_DAYS)

  const routines = await db.routine.findMany({
    where: { active: true },
    include: {
      owner: {
        select: {
          id: true, active: true, notifyTelegram: true, notifyWebPush: true,
          telegramChatId: true, quietFrom: true, quietTo: true,
        },
      },
    },
  })

  const plans: Plan[] = []

  for (const r of routines) {
    const u = r.owner
    if (!u.active) continue

    const channels: string[] = []
    if (u.notifyTelegram && u.telegramChatId) channels.push('telegram')
    if (u.notifyWebPush) channels.push('webpush')
    if (channels.length === 0) continue

    for (const date of occurrencesBetween(r.rrule, r.startDate, from, to)) {
      const dueAt = vnDateTimeToUtc(date, r.timeOfDay)
      const refId = routineRef(r.id, date)

      const slots: Array<[Plan['kind'], Date, number]> = []
      if (r.remindBeforeMin > 0) {
        slots.push(['ROUTINE_UPCOMING', new Date(dueAt.getTime() - r.remindBeforeMin * 60_000), r.remindBeforeMin])
      }
      slots.push(['ROUTINE_DUE', dueAt, 0])
      if (r.nagAfterMin) {
        slots.push(['ROUTINE_NAG', new Date(dueAt.getTime() + r.nagAfterMin * 60_000), r.nagAfterMin])
      }

      for (const [kind, fireAt, minutes] of slots) {
        if (fireAt.getTime() <= now.getTime()) continue // đã qua thì không sinh nữa
        if (inQuietHours(vnTimeOf(fireAt), u.quietFrom, u.quietTo)) continue
        const draft = routineDraft(kind, r, minutes)
        plans.push({
          userId: u.id, kind, refTable: 'routine', refId,
          title: draft.title, body: draft.body, fireAt, channels,
        })
      }
    }
  }

  if (plans.length === 0) return 0
  const res = await db.notification.createMany({ data: plans, skipDuplicates: true })
  return res.count
}

/**
 * Huỷ các thông báo chưa gửi của một routine trong một ngày.
 * Gọi khi người dùng đã tick xong — nhắc tiếp là phiền và làm mất lòng tin vào app.
 */
export async function cancelRoutineNotifications(
  routineId: string,
  date: string,
  kinds: Array<'ROUTINE_UPCOMING' | 'ROUTINE_DUE' | 'ROUTINE_NAG'> = ['ROUTINE_UPCOMING', 'ROUTINE_DUE', 'ROUTINE_NAG'],
): Promise<number> {
  const res = await db.notification.updateMany({
    where: {
      refTable: 'routine',
      refId: routineRef(routineId, date),
      kind: { in: kinds },
      status: 'PENDING',
    },
    data: { status: 'CANCELLED' },
  })
  return res.count
}

/**
 * Khôi phục thông báo đã huỷ khi người dùng bỏ tick.
 *
 * Phải là restore chứ không phải tạo mới: unique index gồm
 * (userId, kind, refTable, refId, fireAt) nhưng KHÔNG gồm status, nên bản ghi
 * CANCELLED vẫn chiếm khoá đó và materialize sẽ lặng lẽ bỏ qua.
 */
export async function restoreRoutineNotifications(routineId: string, date: string): Promise<number> {
  const res = await db.notification.updateMany({
    where: {
      refTable: 'routine',
      refId: routineRef(routineId, date),
      status: 'CANCELLED',
      fireAt: { gt: new Date() },
    },
    data: { status: 'PENDING', error: null, attempts: 0 },
  })
  return res.count
}

/**
 * Sinh lại thông báo cho một routine sau khi nó được sửa hoặc lưu trữ.
 *
 * Dùng delete chứ không phải cancel: nếu giờ không đổi, bản ghi CANCELLED sẽ
 * chiếm đúng khoá unique và materialize không tạo lại được → mất nhắc nhở.
 * Thông báo tương lai chưa gửi không mang giá trị lịch sử nên xoá là an toàn.
 */
export async function rescheduleRoutine(routineId: string, alsoMaterialize = true): Promise<void> {
  await db.notification.deleteMany({
    where: {
      refTable: 'routine',
      refId: { startsWith: `${routineId}:` },
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
  if (alsoMaterialize) await materializeRoutines()
}
