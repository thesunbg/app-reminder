/**
 * Nút bấm trong tin nhắn nhắc nhở Telegram.
 *
 * Vì sao cần: trước đây thông báo là một chiều — đọc xong vẫn phải mở app mới
 * tick được. Con đang học mà phải mở app mới tick thì sẽ không tick, và số
 * liệu trong app thành vô nghĩa. Giờ bấm thẳng trong tin nhắn.
 *
 * `callback_data` của Bot API tối đa **64 byte**, nên mã hoá phải chặt:
 *   r:<routineId>:<YYYY-MM-DD>:<D|P>   tick việc định kỳ (Xong / Làm dở)
 *   z:<routineId>:<YYYY-MM-DD>         hoãn 15 phút
 *   h:<studyRecordId>                  đánh dấu bài tập đã làm xong
 *   n:<noteId>                         đánh dấu ghi chú đã xong
 * cuid dài 25 ký tự nên ca dài nhất (`r:`) là 40 byte — còn dư.
 */
import { TRPCError } from '@trpc/server'
import { db } from '../db.js'
import type { InlineButton } from '../lib/telegram.js'
import { markTask } from '../routines/mark.js'
import { clearHomeworkNotifications } from './homework.js'
import { completeNote } from './notes.js'

/** Hoãn bao lâu khi bấm "💤". */
export const SNOOZE_MIN = 15

const MAX_CALLBACK_BYTES = 64

/** Nút cho một thông báo sắp gửi. Mảng rỗng = tin nhắn không có nút. */
export function buttonsFor(n: { refTable: string; refId: string }): InlineButton[][] {
  if (n.refTable === 'routine') {
    const [routineId, date] = n.refId.split(':')
    if (!routineId || !date) return []
    const rows = [
      [
        { text: '✓ Xong', data: `r:${routineId}:${date}:D` },
        { text: '½ Làm dở', data: `r:${routineId}:${date}:P` },
      ],
      [{ text: `💤 Nhắc lại sau ${SNOOZE_MIN} phút`, data: `z:${routineId}:${date}` }],
    ]
    return rows.every((row) => row.every((b) => Buffer.byteLength(b.data) <= MAX_CALLBACK_BYTES)) ? rows : []
  }
  if (n.refTable === 'homework') {
    const [recordId] = n.refId.split(':')
    if (!recordId) return []
    return [[{ text: '✓ Đã làm xong', data: `h:${recordId}` }]]
  }
  if (n.refTable === 'note') {
    const [noteId] = n.refId.split(':')
    if (!noteId) return []
    return [[{ text: '✓ Xong', data: `n:${noteId}` }]]
  }
  // sự kiện, lễ tết, tổng kết ngày: không có gì để tick
  return []
}

export type ActionResult = {
  /** câu ngắn hiện lên như toast trên máy người bấm */
  toast: string
  /** dòng thêm vào cuối tin nhắn gốc, rỗng = giữ nguyên nội dung */
  note: string
  /** còn giữ nút lại không (hoãn thì giữ, tick xong thì gỡ) */
  keepButtons: boolean
}

const STATUS_WORD: Record<string, string> = { DONE: 'Xong', PARTIAL: 'Làm dở' }

/**
 * Thực hiện một lần bấm nút.
 *
 * `chatId` quyết định DANH TÍNH: chỉ tài khoản đã liên kết với chat đó mới
 * hành động được, và vẫn phải qua đúng luật quyền như trên web (`markTask`).
 * Không có bước này thì ai biết được callback_data là tick được việc nhà người
 * khác.
 */
export async function runAction(chatId: string, data: string): Promise<ActionResult> {
  const user = await db.user.findFirst({ where: { telegramChatId: chatId, active: true } })
  if (!user) return { toast: 'Máy này chưa liên kết tài khoản nào', note: '', keepButtons: true }

  const [kind, ...rest] = data.split(':')

  try {
    if (kind === 'r') {
      const [routineId, date, code] = rest
      if (!routineId || !date || !code) return bad()
      const status = code === 'D' ? 'DONE' : 'PARTIAL'
      const { log, routine } = await markTask(user, { routineId, date, status })
      if (!log) {
        // bấm lại đúng trạng thái cũ = bỏ tick; nói rõ để không ai tưởng hỏng
        return { toast: 'Đã bỏ tick', note: `↩️ <i>Đã bỏ tick — việc còn nợ</i>`, keepButtons: true }
      }
      return {
        toast: `Đã ghi: ${STATUS_WORD[status]}`,
        note: `✅ <i>${STATUS_WORD[status]} — ${escapeName(routine.title)}</i>`,
        keepButtons: false,
      }
    }

    if (kind === 'z') {
      const [routineId, date] = rest
      if (!routineId || !date) return bad()
      const n = await snooze(user.id, routineId, date)
      if (!n) return { toast: 'Không hoãn được — việc này không còn nhắc nữa', note: '', keepButtons: true }
      return {
        toast: `Sẽ nhắc lại sau ${SNOOZE_MIN} phút`,
        note: `💤 <i>Hoãn ${SNOOZE_MIN} phút</i>`,
        keepButtons: false,
      }
    }

    if (kind === 'h') {
      const [recordId] = rest
      if (!recordId) return bad()
      const rec = await db.studyRecord.findUnique({ where: { id: recordId }, include: { child: true } })
      if (!rec || rec.kind !== 'HOMEWORK') return bad()
      // bài tập là của con: chính con hoặc phụ huynh cùng nhà mới tick được
      const allowed = rec.childId === user.id || (user.role === 'PARENT' && rec.child.familyId === user.familyId)
      if (!allowed) return { toast: 'Đây không phải bài tập của bạn', note: '', keepButtons: true }
      await db.studyRecord.update({ where: { id: recordId }, data: { doneAt: new Date() } })
      await clearHomeworkNotifications(recordId)
      return { toast: 'Đã đánh dấu làm xong', note: '✅ <i>Đã làm xong</i>', keepButtons: false }
    }

    if (kind === 'n') {
      const [noteId] = rest
      if (!noteId) return bad()
      const note = await db.note.findUnique({ where: { id: noteId } })
      if (!note || note.familyId !== user.familyId) return bad()
      // ghi chú riêng tư thì chỉ chủ của nó mới tick
      if (!note.shared && note.ownerId !== user.id) {
        return { toast: 'Đây là ghi chú riêng của người khác', note: '', keepButtons: true }
      }
      // completeNote lo luôn ca lặp lại (thay dầu xe mỗi 180 ngày → đẻ ghi chú mới)
      const { next } = await completeNote(noteId)
      const again = next?.remindDate ? ` — lần tới ${dayMonth(next.remindDate)}` : ''
      return { toast: `Đã đánh dấu xong${again}`, note: `✅ <i>Đã xong${again}</i>`, keepButtons: false }
    }
  } catch (err) {
    // lỗi quyền là câu trả lời hợp lệ cho người bấm, không phải sự cố
    if (err instanceof TRPCError) return { toast: err.message.slice(0, 190), note: '', keepButtons: true }
    throw err
  }

  return bad()
}

function bad(): ActionResult {
  return { toast: 'Nút này không còn dùng được', note: '', keepButtons: true }
}

const dayMonth = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`

function escapeName(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Hoãn: sinh một nhắc mới sau N phút thay vì dời cái cũ — cái cũ đã SENT, mà
 * lịch sử gửi thì không nên sửa lại cho khác sự thật.
 */
async function snooze(userId: string, routineId: string, date: string) {
  const routine = await db.routine.findUnique({ where: { id: routineId } })
  if (!routine || !routine.active) return null
  const fireAt = new Date(Date.now() + SNOOZE_MIN * 60_000)
  return db.notification.create({
    data: {
      userId,
      kind: 'ROUTINE_NAG',
      refTable: 'routine',
      refId: `${routineId}:${date}`,
      title: `Nhắc lại: ${routine.title}`,
      body: `Bạn đã hoãn ${SNOOZE_MIN} phút trước.`,
      fireAt,
      channels: ['telegram'],
    },
  })
}
