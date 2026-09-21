import type { Notification } from '@prisma/client'
import { db } from '../db.js'
import { sendMessage, telegramEnabled } from '../lib/telegram.js'
import { sendPushToUser, webPushEnabled } from '../lib/webpush.js'
import { fcmEnabled, sendNativeToUser } from '../lib/fcm.js'
import { buildDigest } from '../diary/digest.js'
import { notificationUrl, toTelegramHtml } from './messages.js'

const BATCH = 50
const MAX_ATTEMPTS = 3
const BACKOFF_MIN = [1, 5, 15]
/** SENDING quá lâu nghĩa là tiến trình chết giữa chừng → trả về PENDING.
 *  Mốc so sánh là claimedAt (lúc nhận việc), KHÔNG phải createdAt — bản ghi
 *  sinh trước 14 ngày vẫn có thể vừa được nhận cách đây 3 giây. */
const STUCK_AFTER_MIN = 5

/**
 * Nhận việc theo kiểu atomic: UPDATE ... FOR UPDATE SKIP LOCKED.
 * Nhờ vậy chạy nhiều tiến trình cũng không gửi trùng.
 */
async function claim(now: Date): Promise<Notification[]> {
  return db.$queryRaw<Notification[]>`
    UPDATE "Notification" SET status = 'SENDING', attempts = attempts + 1, "claimedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "Notification"
      WHERE status = 'PENDING' AND "fireAt" <= ${now}
      ORDER BY "fireAt" ASC
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `
}

/** Thông báo này còn cần gửi không? (vd người dùng đã tick xong việc rồi) */
async function stillRelevant(n: Notification): Promise<boolean> {
  if (n.refTable === 'event') {
    // Notification không có khoá ngoại sang Event, nên sự kiện bị xoá sẽ để lại
    // thông báo mồ côi. Kiểm tra ở đây thay vì gửi nhắc về một đám giỗ không còn.
    const [eventId] = n.refId.split(':')
    if (!eventId) return false
    return (await db.event.count({ where: { id: eventId } })) > 0
  }
  if (n.refTable === 'note') {
    const [noteId] = n.refId.split(':')
    if (!noteId) return false
    const note = await db.note.findUnique({ where: { id: noteId } })
    return Boolean(note && !note.archived && !note.doneAt)
  }
  if (n.refTable === 'digest') return true
  if (n.refTable !== 'routine') return true
  const [routineId, date] = n.refId.split(':')
  if (!routineId || !date) return false

  const routine = await db.routine.findUnique({ where: { id: routineId } })
  if (!routine || !routine.active) return false

  // nhắc trước thì vẫn gửi kể cả đã tick sớm? không — đã xong là thôi.
  const log = await db.taskLog.findUnique({
    where: { routineId_date: { routineId, date } },
  })
  return log === null
}

async function deliver(n: Notification): Promise<string[]> {
  const user = await db.user.findUnique({ where: { id: n.userId } })
  if (!user || !user.active) throw new Error('Người dùng không còn hoạt động')

  // Tổng kết ngày phải phản ánh trạng thái lúc gửi, không phải lúc sinh lịch.
  // Đây là loại thông báo duy nhất có nội dung động.
  let { title, body } = n
  if (n.kind === 'DAILY_DIGEST') {
    const date = n.refId.split(':')[1]
    if (date) {
      const fresh = await buildDigest(user.id, date)
      title = fresh.title
      body = fresh.body
      await db.notification.update({ where: { id: n.id }, data: { title, body } })
    }
  }

  const url = notificationUrl(n)

  // Kênh được tính LẠI ở đây chứ không dùng n.channels đã chốt lúc materialize:
  // thông báo được sinh trước 14 ngày, nên người dùng hoàn toàn có thể liên kết
  // Telegram sau đó. Tin vào giá trị cũ thì họ sẽ không nhận được gì suốt 2 tuần.
  const wanted: string[] = []
  if (user.notifyTelegram && telegramEnabled() && user.telegramChatId) wanted.push('telegram')
  if (user.notifyWebPush && webPushEnabled()) wanted.push('webpush')
  if (user.notifyNative && fcmEnabled()) wanted.push('native')
  if (wanted.length === 0) throw new Error('người dùng chưa bật kênh nhắc nào')

  const sent: string[] = []
  const errors: string[] = []

  for (const channel of wanted) {
    try {
      if (channel === 'telegram') {
        await sendMessage(user.telegramChatId!, toTelegramHtml({ title, body }))
        sent.push('telegram')
      } else if (channel === 'webpush') {
        await sendPushToUser(user.id, { title, body, url, tag: n.refId })
        sent.push('webpush')
      } else if (channel === 'native') {
        await sendNativeToUser(user.id, { title, body, url, tag: n.refId })
        sent.push('native')
      }
    } catch (err) {
      errors.push(`${channel}: ${(err as Error).message}`)
    }
  }

  // chỉ coi là hỏng khi KHÔNG kênh nào tới được — Telegram sống là đủ
  if (sent.length === 0) throw new Error(errors.join('; ') || 'không có kênh nào khả dụng')
  return sent
}

export type DispatchResult = { claimed: number; sent: number; cancelled: number; failed: number; retry: number }

export async function dispatchDue(now: Date = new Date()): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, cancelled: 0, failed: 0, retry: 0 }
  const batch = await claim(now)
  result.claimed = batch.length

  for (const n of batch) {
    try {
      if (!(await stillRelevant(n))) {
        await db.notification.update({ where: { id: n.id }, data: { status: 'CANCELLED' } })
        result.cancelled++
        continue
      }
      const channels = await deliver(n)
      await db.notification.update({
        where: { id: n.id },
        data: { status: 'SENT', sentAt: new Date(), channels, error: null },
      })
      result.sent++
    } catch (err) {
      const message = (err as Error).message.slice(0, 500)
      if (n.attempts >= MAX_ATTEMPTS) {
        await db.notification.update({ where: { id: n.id }, data: { status: 'FAILED', error: message } })
        result.failed++
      } else {
        const wait = BACKOFF_MIN[n.attempts - 1] ?? 15
        await db.notification.update({
          where: { id: n.id },
          data: { status: 'PENDING', error: message, fireAt: new Date(Date.now() + wait * 60_000) },
        })
        result.retry++
      }
    }
  }

  return result
}

/** Trả các bản ghi kẹt ở SENDING (tiến trình chết giữa chừng) về PENDING. */
export async function releaseStuck(): Promise<number> {
  const res = await db.notification.updateMany({
    where: { status: 'SENDING', claimedAt: { lt: new Date(Date.now() - STUCK_AFTER_MIN * 60_000) } },
    data: { status: 'PENDING' },
  })
  return res.count
}
