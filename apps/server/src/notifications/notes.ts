import type { Note } from '@prisma/client'
import { db } from '../db.js'
import { addDays, diffDays, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { inQuietHours } from './materialize.js'
import { plannedChannels } from '../notifications/channels.js'

/** Sinh trước lịch nhắc ghi chú cho bao nhiêu ngày tới. */
const HORIZON_DAYS = 60

export const noteRef = (noteId: string, remindDate: string) => `${noteId}:${remindDate}`

type Plan = {
  userId: string
  kind: 'NOTE_AHEAD' | 'NOTE_DUE'
  refTable: string
  refId: string
  title: string
  body: string
  fireAt: Date
  channels: string[]
}

function preview(note: Note): string {
  const text = note.body.trim()
  if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text
  return ''
}

function draft(note: Note, daysAhead: number) {
  const label = note.title.trim() || preview(note) || 'Ghi chú'
  const d = `${Number(note.remindDate!.slice(8, 10))}/${Number(note.remindDate!.slice(5, 7))}`
  const detail = note.title.trim() && preview(note) ? `\n${preview(note)}` : ''
  return daysAhead === 0
    ? { title: `Đến hạn: ${label}`, body: `Hôm nay ${d}${detail}` }
    : { title: `Còn ${daysAhead} ngày: ${label}`, body: `Hạn ${d}${detail}` }
}

/**
 * Sinh thông báo cho các ghi chú có gắn hạn.
 *
 * Ghi chú riêng tư chỉ nhắc chủ nhân; ghi chú đã chia sẻ thì nhắc cả nhà —
 * "đổ rác thứ 3" mà chỉ mình mình biết thì chia sẻ làm gì.
 */
export async function materializeNotes(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)
  const until = addDays(today, HORIZON_DAYS)

  const notes = await db.note.findMany({
    where: {
      archived: false,
      doneAt: null,
      remindDate: { not: null, gte: today, lte: until },
    },
    include: { family: { include: { users: true } }, owner: true },
  })
  if (notes.length === 0) return 0

  const plans: Plan[] = []

  for (const note of notes) {
    const recipients = note.shared
      ? note.family.users.filter((u) => u.active)
      : [note.owner].filter((u) => u.active)

    const offsets = [...new Set(note.remindBeforeDays)].filter((d) => d >= 0).sort((a, b) => b - a)

    for (const u of recipients) {
      const channels = plannedChannels(u)
      if (channels.length === 0) continue

      for (const daysAhead of offsets) {
        const fireDate = addDays(note.remindDate!, -daysAhead)
        if (diffDays(today, fireDate) < 0) continue
        const fireAt = vnDateTimeToUtc(fireDate, note.remindAtTime)
        if (fireAt.getTime() <= now.getTime()) continue
        if (inQuietHours(vnTimeOf(fireAt), u.quietFrom, u.quietTo)) continue

        const d = draft(note, daysAhead)
        plans.push({
          userId: u.id,
          kind: daysAhead === 0 ? 'NOTE_DUE' : 'NOTE_AHEAD',
          refTable: 'note',
          refId: noteRef(note.id, note.remindDate!),
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

/** Xoá lịch nhắc tương lai của một ghi chú (khi sửa hạn, lưu trữ, hoặc xoá). */
export async function clearNoteNotifications(noteId: string): Promise<void> {
  await db.notification.deleteMany({
    where: {
      refTable: 'note',
      refId: { startsWith: `${noteId}:` },
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
}

/**
 * Đánh dấu ghi chú đã xong.
 * Nếu có chu kỳ lặp (vd thay dầu mỗi 180 ngày) thì tự đẻ ghi chú mới cho lần
 * tới — đó là cả điểm của việc ghi "thay dầu xe": lần sau vẫn phải nhớ.
 */
export async function completeNote(noteId: string): Promise<{ next: Note | null }> {
  const note = await db.note.findUnique({ where: { id: noteId }, include: { items: true } })
  if (!note) return { next: null }

  await db.note.update({ where: { id: noteId }, data: { doneAt: new Date(), archived: true } })
  await clearNoteNotifications(noteId)

  if (!note.recurIntervalDays || !note.remindDate) return { next: null }

  // mốc kế tiếp tính từ hạn cũ, nhưng không được rơi vào quá khứ
  let nextDate = addDays(note.remindDate, note.recurIntervalDays)
  const today = vnToday()
  while (diffDays(today, nextDate) < 0) {
    nextDate = addDays(nextDate, note.recurIntervalDays)
  }

  const next = await db.note.create({
    data: {
      familyId: note.familyId,
      ownerId: note.ownerId,
      title: note.title,
      body: note.body,
      kind: note.kind,
      color: note.color,
      labels: note.labels,
      shared: note.shared,
      remindDate: nextDate,
      remindAtTime: note.remindAtTime,
      remindBeforeDays: note.remindBeforeDays,
      recurIntervalDays: note.recurIntervalDays,
      items: {
        // checklist lặp lại thì bắt đầu từ trạng thái chưa tick
        create: note.items.map((i) => ({ text: i.text, checked: false, sortOrder: i.sortOrder })),
      },
    },
  })
  await materializeNotes()
  return { next }
}
