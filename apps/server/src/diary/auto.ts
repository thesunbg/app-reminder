import type { DiaryEntry } from '@prisma/client'
import { db } from '../db.js'
import { lunarOf } from '../lib/lunar.js'
import { minutesText } from '../lib/text.js'
import { occursOn } from '../lib/recurrence.js'
import { vnDateOf, vnToday } from '../lib/time.js'

export type AutoSummary = {
  date: string
  text: string
  totalMinutes: number
  done: number
  due: number
  /** có gì để ghi không — ngày trống thì đừng tạo entry rỗng */
  empty: boolean
}

/**
 * Dựng nhật ký tự động cho một ngày từ những gì đã xảy ra trong app:
 * việc định kỳ đã tick, ghi chú đã hoàn thành, sự kiện rơi vào ngày đó.
 */
export async function buildAutoSummary(userId: string, date: string): Promise<AutoSummary> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })

  const routines = await db.routine.findMany({ where: { ownerId: userId } })
  const dueToday = routines.filter((r) => occursOn(r.rrule, r.startDate, date))
  const logs = await db.taskLog.findMany({
    where: { date, routineId: { in: dueToday.map((r) => r.id) } },
  })
  const logByRoutine = new Map(logs.map((l) => [l.routineId, l]))

  const lines: string[] = []
  let totalMinutes = 0
  let done = 0

  const finished: string[] = []
  const missed: string[] = []
  for (const r of dueToday) {
    const log = logByRoutine.get(r.id)
    if (log && (log.status === 'DONE' || log.status === 'PARTIAL')) {
      const mins = log.actualMin ?? r.durationMin
      totalMinutes += mins
      done++
      finished.push(`${r.title} ${minutesText(mins)}${log.status === 'PARTIAL' ? ' (làm dở)' : ''}`)
    } else if (log?.status === 'SKIPPED') {
      missed.push(`${r.title} (bỏ qua)`)
    } else {
      missed.push(r.title)
    }
  }

  if (finished.length) lines.push(`Đã làm: ${finished.join(', ')}.`)
  if (missed.length) lines.push(`Chưa làm: ${missed.join(', ')}.`)

  // ghi chú hoàn thành trong ngày (doneAt lưu UTC, so theo ngày VN)
  const completedNotes = await db.note.findMany({
    where: { ownerId: userId, doneAt: { not: null } },
    select: { title: true, body: true, doneAt: true },
  })
  const notesToday = completedNotes
    .filter((n) => n.doneAt && vnDateOf(n.doneAt) === date)
    .map((n) => n.title.trim() || n.body.trim().split('\n')[0] || 'ghi chú')
  if (notesToday.length) lines.push(`Xong: ${notesToday.join(', ')}.`)

  // sự kiện của gia đình rơi vào ngày này
  const occurrences = await db.eventOccurrence.findMany({
    where: { solarDate: date, event: { familyId: user.familyId } },
    include: { event: true },
  })
  for (const o of occurrences) {
    const lunar = o.event.calendar === 'LUNAR' ? lunarOf(date) : null
    lines.push(
      `${o.event.title}${lunar ? ` (${lunar.day}/${lunar.month} âm lịch)` : ''}.`,
    )
  }

  return {
    date,
    text: lines.join('\n'),
    totalMinutes,
    done,
    due: dueToday.length,
    empty: lines.length === 0,
  }
}

/**
 * Lấy bản nhật ký tự động của một ngày, tạo nếu chưa có.
 *
 * Ngày đã qua thì giữ nguyên bản đã lưu — nếu tính lại, việc xoá một routine
 * hôm nay sẽ làm biến mất lịch sử của tháng trước. Riêng ngày hôm nay luôn
 * tính lại vì nó còn đang diễn ra.
 */
export async function getAutoEntry(userId: string, date: string): Promise<DiaryEntry | null> {
  const existing = await db.diaryEntry.findUnique({
    where: { userId_date_source: { userId, date, source: 'AUTO_TASK' } },
  })
  if (existing && date < vnToday()) return existing

  const summary = await buildAutoSummary(userId, date)
  if (summary.empty) {
    if (existing) await db.diaryEntry.delete({ where: { id: existing.id } })
    return null
  }

  return db.diaryEntry.upsert({
    where: { userId_date_source: { userId, date, source: 'AUTO_TASK' } },
    create: { userId, date, source: 'AUTO_TASK', content: summary.text },
    update: { content: summary.text },
  })
}
