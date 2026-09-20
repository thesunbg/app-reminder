import { db } from '../db.js'
import { occurrencesBetween } from '../lib/recurrence.js'
import { addDays, dateRange, diffDays, isoWeekday, startOfWeek, vnToday } from '../lib/time.js'

/**
 * Nạp lịch dự kiến + log thực tế trong khoảng, rồi tính mọi chỉ số từ đó.
 * Chỉ 2 truy vấn DB cho toàn bộ trang thống kê.
 */
async function loadWindow(familyId: string, ownerId: string | undefined, from: string, to: string) {
  const routines = await db.routine.findMany({
    where: { familyId, ...(ownerId ? { ownerId } : {}) },
    include: { owner: { select: { id: true, name: true, avatarColor: true } } },
  })
  const logs = await db.taskLog.findMany({
    where: { date: { gte: from, lte: to }, routineId: { in: routines.map((r) => r.id) } },
  })
  const due = new Map<string, Set<string>>() // routineId -> ngày phải làm
  for (const r of routines) {
    due.set(r.id, new Set(occurrencesBetween(r.rrule, r.startDate, from, to)))
  }
  return { routines, logs, due }
}

/** Tổng quan: tỉ lệ hoàn thành, phút theo nhóm/tuần, chuỗi ngày, theo thứ. Dùng cho trang Thống kê và dashboard con. */
export async function buildSummary(familyId: string, ownerId: string | undefined, from: string, to: string) {
  const { routines, logs, due } = await loadWindow(familyId, ownerId, from, to)

  const logMap = new Map(logs.map((l) => [`${l.routineId}|${l.date}`, l]))
  const byRoutine = new Map(routines.map((r) => [r.id, r]))

  let totalDue = 0
  let totalDone = 0
  let totalMinutes = 0
  const perDay = new Map<string, { due: number; done: number; minutes: number }>()
  const perCategory = new Map<string, { minutes: number; done: number }>()
  const perRoutine = new Map<string, { due: number; done: number; minutes: number }>()
  // tuần (thứ 2 đầu tuần) → phút theo nhóm, để vẽ cột xếp chồng
  const perWeek = new Map<string, Record<string, number>>()

  for (const [routineId, days] of due) {
    const routine = byRoutine.get(routineId)!
    for (const date of days) {
      if (date > vnToday()) continue // chưa tới thì không tính là trượt
      totalDue++
      const slot = perDay.get(date) ?? { due: 0, done: 0, minutes: 0 }
      slot.due++
      const pr = perRoutine.get(routineId) ?? { due: 0, done: 0, minutes: 0 }
      pr.due++

      const log = logMap.get(`${routineId}|${date}`)
      if (log && (log.status === 'DONE' || log.status === 'PARTIAL')) {
        const minutes = log.actualMin ?? routine.durationMin
        const weight = log.status === 'DONE' ? 1 : 0.5
        totalDone += weight
        totalMinutes += minutes
        slot.done += weight
        slot.minutes += minutes
        pr.done += weight
        pr.minutes += minutes
        const cat = perCategory.get(routine.category) ?? { minutes: 0, done: 0 }
        cat.minutes += minutes
        cat.done += weight
        perCategory.set(routine.category, cat)
        const wk = perWeek.get(startOfWeek(date)) ?? {}
        wk[routine.category] = (wk[routine.category] ?? 0) + minutes
        perWeek.set(startOfWeek(date), wk)
      }
      perDay.set(date, slot)
      perRoutine.set(routineId, pr)
    }
  }

  // chuỗi ngày liên tiếp hoàn thành hết việc (tính ngược từ hôm nay, bỏ qua ngày không có việc)
  let streak = 0
  let cursor = vnToday()
  for (let i = 0; i < 400; i++) {
    const slot = perDay.get(cursor)
    if (!slot) {
      if (diffDays(from, cursor) < 0) break
      cursor = addDays(cursor, -1)
      continue
    }
    if (slot.done >= slot.due && slot.due > 0) {
      streak++
      cursor = addDays(cursor, -1)
    } else if (cursor === vnToday() && slot.done < slot.due) {
      // hôm nay chưa xong thì chưa phá chuỗi
      cursor = addDays(cursor, -1)
    } else break
  }

  // thứ nào trong tuần hay bỏ việc — gộp mọi ngày cùng thứ trong khoảng
  const weekdayAgg = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }))
  for (const [date, slot] of perDay) {
    const w = weekdayAgg[isoWeekday(date) - 1]!
    w.due += slot.due
    w.done += slot.done
  }

  const weekStarts: string[] = []
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) weekStarts.push(w)

  return {
    from,
    to,
    totalDue,
    totalDone: Math.round(totalDone * 10) / 10,
    completionRate: totalDue === 0 ? 0 : Math.round((totalDone / totalDue) * 1000) / 10,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    streak,
    daily: dateRange(from, to).map((date) => ({
      date,
      ...(perDay.get(date) ?? { due: 0, done: 0, minutes: 0 }),
    })),
    weekly: weekStarts.map((week) => ({ week, ...(perWeek.get(week) ?? {}) })),
    byWeekday: weekdayAgg.map((w, i) => ({
      weekday: i + 1,
      due: w.due,
      rate: w.due === 0 ? null : Math.round((w.done / w.due) * 100),
    })),
    byCategory: [...perCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.minutes - a.minutes),
    byRoutine: [...perRoutine.entries()]
      .map(([id, v]) => ({
        id,
        title: byRoutine.get(id)?.title ?? '',
        color: byRoutine.get(id)?.color ?? '#6366f1',
        owner: byRoutine.get(id)?.owner ?? null,
        ...v,
        rate: v.due === 0 ? 0 : Math.round((v.done / v.due) * 1000) / 10,
      }))
      .sort((a, b) => b.minutes - a.minutes),
  }
}
