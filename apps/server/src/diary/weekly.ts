/**
 * Tổng kết TUẦN, gửi tối chủ nhật.
 *
 * Tổng kết ngày trả lời "hôm nay tôi làm được gì". Tổng kết tuần trả lời câu
 * mà phụ huynh thật sự hỏi: "tuần này cả nhà thế nào" — ai đang đuối, bài tập
 * nào còn nợ, tuần tới có gì phải chuẩn bị. Đọc một tin là đủ, không phải mở
 * bốn màn hình.
 *
 * Giống tổng kết ngày, nội dung tính LÚC GỬI: tuần chưa hết thì chưa biết.
 */
import { db } from '../db.js'
import { holidaysBetween } from '../lib/holidays.js'
import { minutesText } from '../lib/text.js'
import { addDays, diffDays, isoWeekday, startOfWeek, vnDateTimeToUtc, vnToday } from '../lib/time.js'
import { plannedChannels } from '../notifications/channels.js'
import { buildSummary } from '../stats/summary.js'

export const weeklyRef = (weekStart: string) => `weekly:${weekStart}`

/** Nhìn trước bao nhiêu ngày cho các sự kiện của tuần tới. */
const LOOKAHEAD_DAYS = 7

/**
 * Sinh thông báo tổng kết tuần cho CHỦ NHẬT gần nhất chưa qua.
 *
 * Chỉ sinh trong vòng một tuần chứ không sinh trước nhiều tuần: nội dung phụ
 * thuộc cả tuần, mà bản ghi sinh sớm chỉ là chỗ giữ chỗ.
 */
export async function materializeWeekly(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)
  // chủ nhật của tuần đang chạy (thứ 2 → chủ nhật)
  const sunday = addDays(startOfWeek(today), 6)

  const users = await db.user.findMany({ where: { active: true, weeklyDigestAt: { not: null } } })
  if (users.length === 0) return 0

  const plans = users
    .map((u) => {
      const channels = plannedChannels(u)
      if (channels.length === 0) return null
      const fireAt = vnDateTimeToUtc(sunday, u.weeklyDigestAt!)
      if (fireAt.getTime() <= now.getTime()) return null
      return {
        userId: u.id,
        kind: 'WEEKLY_DIGEST' as const,
        refTable: 'weekly',
        refId: weeklyRef(startOfWeek(today)),
        title: 'Tổng kết tuần',
        body: '…', // nội dung thật tính lúc gửi
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
 * Nội dung tổng kết tuần.
 *
 * Phụ huynh thấy cả nhà, con chỉ thấy phần của mình — đúng quyền xem trong app,
 * vì thông báo cũng là một cách dữ liệu đi ra ngoài.
 */
export async function buildWeekly(
  userId: string,
  weekStart: string,
): Promise<{ title: string; body: string }> {
  const me = await db.user.findUnique({ where: { id: userId } })
  if (!me) return { title: 'Tổng kết tuần', body: '' }

  const weekEnd = addDays(weekStart, 6)
  const isParent = me.role === 'PARENT'
  const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`
  const parts: string[] = []

  // ---- việc định kỳ, theo từng người nếu là phụ huynh ----
  const members = isParent
    ? await db.user.findMany({
        where: { familyId: me.familyId, active: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      })
    : [me]

  for (const m of members) {
    const s = await buildSummary(me.familyId, m.id, weekStart, weekEnd)
    if (s.totalDue === 0) continue
    const rate = Math.round(s.completionRate)
    const mark = rate >= 80 ? '✅' : rate >= 50 ? '🟡' : '🔴'
    parts.push(
      `${mark} ${m.name}: ${s.totalDone}/${s.totalDue} việc (${rate}%)` +
        (s.totalMinutes > 0 ? `, ${minutesText(s.totalMinutes)}` : ''),
    )
  }
  if (parts.length === 0) parts.push('Tuần này không có việc nào trong lịch.')

  // ---- bài tập còn nợ (chỉ con của mình) ----
  const childIds = members.filter((m) => m.role === 'CHILD').map((m) => m.id)
  if (childIds.length > 0) {
    const late = await db.studyRecord.findMany({
      where: { childId: { in: childIds }, kind: 'HOMEWORK', doneAt: null, date: { not: null, lte: weekEnd } },
      include: { child: { select: { name: true } } },
      orderBy: { date: 'asc' },
      take: 5,
    })
    if (late.length > 0) {
      parts.push('')
      parts.push(`📚 Còn ${late.length} bài chưa xong:`)
      for (const r of late) {
        const short = r.title.length > 40 ? `${r.title.slice(0, 37).trimEnd()}…` : r.title
        parts.push(`· ${r.child.name}: ${short}${r.date ? ` (hạn ${dm(r.date)})` : ''}`)
      }
    }
  }

  // ---- tuần tới có gì ----
  const from = addDays(weekEnd, 1)
  const to = addDays(weekEnd, LOOKAHEAD_DAYS)
  const upcoming = await db.eventOccurrence.findMany({
    where: { event: { familyId: me.familyId }, solarDate: { gte: from, lte: to } },
    include: { event: { select: { title: true } } },
    orderBy: { solarDate: 'asc' },
    take: 5,
  })
  const holidays = holidaysBetween(from, to).filter((h) => h.holiday.dayOff || h.holiday.remind)

  if (upcoming.length > 0 || holidays.length > 0) {
    parts.push('')
    parts.push('📅 Tuần tới:')
    for (const o of upcoming) parts.push(`· ${dm(o.solarDate)} ${o.event.title}`)
    for (const h of holidays) {
      parts.push(`· ${dm(h.startDate)} ${h.holiday.title}${h.holiday.dayOff ? ' (nghỉ)' : ''}`)
    }
  }

  return { title: `Tổng kết tuần ${dm(weekStart)}–${dm(weekEnd)}`, body: parts.join('\n') }
}

/** Tuần mà một thông báo đang nói tới, suy từ refId. */
export function weekFromRef(refId: string): string | null {
  const week = refId.split(':')[1]
  return week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null
}

/** Hôm nay có phải chủ nhật không — dùng cho test và cho log. */
export const isSunday = (date: string) => isoWeekday(date) === 7

/** Số ngày còn lại tới chủ nhật của tuần chứa `date`. */
export const daysToSunday = (date: string) => diffDays(date, addDays(startOfWeek(date), 6))
