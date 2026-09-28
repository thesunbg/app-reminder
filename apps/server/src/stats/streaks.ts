/**
 * Chuỗi liên tiếp của từng việc định kỳ.
 *
 * Khác `summary.streak` (chuỗi ngày làm HẾT mọi việc, tính trong cửa sổ đang
 * xem): ở đây mỗi việc có chuỗi riêng và tính trên toàn bộ lịch sử. Với trẻ
 * tiểu học, "12 ngày liên tiếp tập thể dục" là động lực mạnh hơn mọi biểu đồ —
 * và nó chỉ có nghĩa khi con số không bị reset lúc đổi khoảng thời gian xem.
 */
import { db } from '../db.js'
import { occurrencesBetween } from '../lib/recurrence.js'
import { addDays, vnToday } from '../lib/time.js'

/** Mốc để trao huy hiệu. */
export const MILESTONES = [7, 30, 100, 365] as const

/**
 * Nhìn lại tối đa bao nhiêu ngày. Hơn một năm thì rrule phải sinh vài trăm mốc
 * cho mỗi việc mỗi lần mở app, mà chuỗi dài hơn thế cũng đã có huy hiệu cao nhất.
 */
const LOOKBACK_DAYS = 400

/** Việc này có phải làm gần như mỗi ngày không — để gọi "ngày" hay "lần". */
function isDailyish(rrule: string): boolean {
  const r = rrule.toUpperCase()
  if (r.includes('FREQ=DAILY')) return true
  const byday = r.match(/BYDAY=([^;]+)/)?.[1]
  return byday ? byday.split(',').length >= 6 : false
}

export type RoutineStreak = {
  routineId: string
  title: string
  color: string
  category: string
  owner: { id: string; name: string; avatarColor: string }
  /** đang liên tiếp bao nhiêu lần */
  current: number
  /** dài nhất từ trước tới nay (trong tầm nhìn lại) */
  best: number
  /** true = đếm theo ngày, false = đếm theo lần (việc hàng tuần) */
  daily: boolean
  /** các mốc đã đạt, lấy theo `best` */
  badges: number[]
  /** mốc kế tiếp và còn mấy lần nữa; null khi đã qua mốc cao nhất */
  nextMilestone: number | null
  toNext: number | null
}

/**
 * `SKIPPED` phá chuỗi, `DONE` và `PARTIAL` thì không — làm dở vẫn là có làm,
 * mà một chuỗi đứt vì hôm ốm chỉ tập được nửa buổi thì chẳng ai muốn giữ nữa.
 */
const KEEPS_CHAIN = new Set(['DONE', 'PARTIAL'])

export async function buildStreaks(
  familyId: string,
  ownerId: string | undefined,
  now: Date = new Date(),
): Promise<RoutineStreak[]> {
  const today = vnToday(now)
  const from = addDays(today, -LOOKBACK_DAYS)

  const routines = await db.routine.findMany({
    where: { familyId, active: true, ...(ownerId ? { ownerId } : {}) },
    include: { owner: { select: { id: true, name: true, avatarColor: true } } },
  })
  if (routines.length === 0) return []

  const logs = await db.taskLog.findMany({
    where: { date: { gte: from, lte: today }, routineId: { in: routines.map((r) => r.id) } },
    select: { routineId: true, date: true, status: true },
  })
  const byKey = new Map(logs.map((l) => [`${l.routineId}|${l.date}`, l.status as string]))

  const out: RoutineStreak[] = []

  for (const r of routines) {
    const days = occurrencesBetween(r.rrule, r.startDate, from, today)

    let best = 0
    let run = 0
    for (const date of days) {
      // hôm nay chưa tick thì chưa tính là trượt — ngày chưa hết
      if (date === today && !byKey.has(`${r.id}|${date}`)) continue
      if (KEEPS_CHAIN.has(byKey.get(`${r.id}|${date}`) ?? '')) {
        run++
        if (run > best) best = run
      } else {
        run = 0
      }
    }

    // chuỗi hiện tại: đi ngược từ mốc gần nhất
    let current = 0
    for (let i = days.length - 1; i >= 0; i--) {
      const date = days[i]!
      const status = byKey.get(`${r.id}|${date}`)
      if (KEEPS_CHAIN.has(status ?? '')) {
        current++
        continue
      }
      if (date === today && !status) continue // hôm nay chưa tới lúc kết luận
      break
    }

    const badges = MILESTONES.filter((m) => best >= m)
    const nextMilestone = MILESTONES.find((m) => m > current) ?? null

    out.push({
      routineId: r.id,
      title: r.title,
      color: r.color,
      category: r.category,
      owner: r.owner,
      current,
      best,
      daily: isDailyish(r.rrule),
      badges: [...badges],
      nextMilestone,
      toNext: nextMilestone === null ? null : nextMilestone - current,
    })
  }

  // đang cháy mạnh nhất lên đầu; hoà thì so kỷ lục
  return out.sort((a, b) => b.current - a.current || b.best - a.best || a.title.localeCompare(b.title))
}
