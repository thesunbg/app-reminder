/**
 * Nhắc thời khoá biểu ngày mai.
 *
 * `ClassSchedule` trước giờ chỉ để XEM. Nhưng thứ con quên nhiều nhất không
 * phải là bài tập — mà là mang đúng sách vở và đồ thể dục. Tối hôm trước liệt
 * kê các tiết của ngày mai là đủ để soạn cặp.
 *
 * Chỉ bắn khi hôm sau THẬT SỰ có tiết, nên người lớn (không có thời khoá biểu)
 * bật sẵn cũng không nhận gì.
 */
import { db } from '../db.js'
import { holidaysOn } from '../lib/holidays.js'
import { addDays, diffDays, isoWeekday, vnDateTimeToUtc, vnTimeOf, vnToday } from '../lib/time.js'
import { channelSelect, plannedChannels } from './channels.js'
import { inQuietHours } from './materialize.js'

/** Sinh trước bao nhiêu ngày. */
const HORIZON_DAYS = 14

const WEEKDAY_WORD = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

export const classRef = (childId: string, date: string) => `${childId}:${date}`

type Plan = {
  userId: string
  kind: 'CLASS_TOMORROW'
  refTable: string
  refId: string
  title: string
  body: string
  fireAt: Date
  channels: string[]
}

type Lesson = { period: number; subject: string; startTime: string; endTime: string; room: string | null }

/** Nội dung: liệt kê môn theo thứ tự tiết, kèm giờ vào lớp. */
export function classDraft(date: string, lessons: Lesson[]) {
  const sorted = [...lessons].sort((a, b) => a.period - b.period)
  const weekday = WEEKDAY_WORD[isoWeekday(date) - 1] ?? ''
  const dm = `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`

  // môn trùng nhau (2 tiết Toán liền) gộp lại — đọc để soạn cặp, không phải để
  // dò từng tiết
  const subjects: string[] = []
  for (const l of sorted) {
    if (subjects.at(-1) !== l.subject) subjects.push(l.subject)
  }

  const first = sorted[0]!
  const rooms = sorted.filter((l) => l.room).map((l) => `${l.subject}: ${l.room}`)
  const body = [
    subjects.join(' · '),
    `Vào học ${first.startTime} · ${sorted.length} tiết`,
    rooms.length > 0 ? rooms.join(', ') : null,
  ]
    .filter(Boolean)
    .join('\n')

  return { title: `Mai ${weekday.toLowerCase()} (${dm}) học gì`, body }
}

export async function materializeClasses(now: Date = new Date()): Promise<number> {
  const today = vnToday(now)

  const children = await db.user.findMany({
    where: { active: true, classReminderAt: { not: null }, classSchedule: { some: {} } },
    select: {
      id: true, classReminderAt: true, quietFrom: true, quietTo: true,
      ...channelSelect,
      classSchedule: true,
    },
  })
  if (children.length === 0) return 0

  const plans: Plan[] = []

  for (const child of children) {
    const channels = plannedChannels(child)
    if (channels.length === 0) continue
    const at = child.classReminderAt!

    for (let i = 0; i <= HORIZON_DAYS; i++) {
      // nhắc TỐI HÔM TRƯỚC cho ngày học hôm sau
      const evening = addDays(today, i)
      const schoolDay = addDays(evening, 1)

      // Nghỉ lễ thì không có tiết nào. Danh mục lễ tết đã biết 2/9 và Tết rơi
      // vào ngày nào, dùng lại luôn — nhắc con soạn cặp cho ngày Quốc khánh thì
      // lần sau nó sẽ bỏ qua mọi thông báo của app.
      if (holidaysOn(schoolDay).some((h) => h.holiday.dayOff)) continue

      const weekday = isoWeekday(schoolDay)
      const lessons = child.classSchedule.filter(
        (c) =>
          c.weekday === weekday &&
          c.effectiveFrom <= schoolDay &&
          (c.effectiveTo === null || c.effectiveTo >= schoolDay),
      )
      if (lessons.length === 0) continue

      const fireAt = vnDateTimeToUtc(evening, at)
      if (fireAt.getTime() <= now.getTime()) continue
      if (diffDays(today, evening) < 0) continue
      if (inQuietHours(vnTimeOf(fireAt), child.quietFrom, child.quietTo)) continue

      const d = classDraft(schoolDay, lessons)
      plans.push({
        userId: child.id,
        kind: 'CLASS_TOMORROW',
        refTable: 'class',
        refId: classRef(child.id, schoolDay),
        title: d.title,
        body: d.body,
        fireAt,
        channels,
      })
    }
  }

  if (plans.length === 0) return 0
  const res = await db.notification.createMany({ data: plans, skipDuplicates: true })
  return res.count
}

/**
 * Xoá lịch nhắc còn treo của một con — gọi khi thời khoá biểu đổi hoặc khi tắt
 * nhắc. Dùng delete chứ không cancel: nội dung (danh sách môn) đã chốt lúc sinh
 * nên bản ghi cũ mang thông tin sai, mà bản CANCELLED vẫn chiếm khoá unique và
 * chặn bản đúng được sinh lại.
 */
export async function clearClassNotifications(childId: string): Promise<number> {
  const res = await db.notification.deleteMany({
    where: {
      refTable: 'class',
      refId: { startsWith: `${childId}:` },
      status: { in: ['PENDING', 'CANCELLED'] },
      fireAt: { gt: new Date() },
    },
  })
  return res.count
}
