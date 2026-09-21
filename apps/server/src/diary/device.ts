/**
 * Nhật ký tự động từ máy tính (Phase 8, `DiarySource.AUTO_DEVICE`).
 *
 * Bản `AUTO_TASK` kể bạn đã tick những việc gì; bản này kể bạn thực sự ngồi
 * làm gì trên máy. Hai bản sống song song và không bản nào đè lên bản viết
 * tay — cùng nguyên tắc đã dùng cho nhật ký tự động ở phase 3.
 */
import type { DiaryEntry } from '@prisma/client'
import { db } from '../db.js'
import { categoryLabel, type Category } from '../lib/appCategory.js'
import { minutesText } from '../lib/text.js'
import { vnToday } from '../lib/time.js'

/** Dưới ngưỡng này thì không đáng nhắc tới — chỉ là lúc bật lên rồi tắt ngay. */
const MIN_MINUTES = 5
/** Kể tên nhiều nhất bấy nhiêu app, phần còn lại gộp lại. */
const NAME_TOP = 3

export type DeviceSummary = { date: string; text: string; totalMinutes: number; empty: boolean }

export async function buildDeviceSummary(userId: string, date: string): Promise<DeviceSummary> {
  const rows = await db.screenReport.findMany({
    where: { userId, date },
    select: { app: true, category: true, minutes: true },
  })

  // Gộp theo app TRƯỚC: mỗi máy là một dòng riêng trong DB, nên người dùng hai
  // máy sẽ thấy "Chrome, Chrome" trong cùng một câu. Ngưỡng MIN_MINUTES cũng
  // phải xét trên tổng — 4 phút ở laptop cộng 4 phút ở máy bàn là 8 phút thật.
  const byApp = new Map<string, { category: Category; minutes: number }>()
  for (const r of rows) {
    const prev = byApp.get(r.app)
    byApp.set(r.app, {
      category: (r.category as Category) ?? 'other',
      minutes: (prev?.minutes ?? 0) + r.minutes,
    })
  }

  const byCategory = new Map<Category, { minutes: number; apps: Array<{ app: string; minutes: number }> }>()
  let totalMinutes = 0

  for (const [app, v] of byApp) {
    if (v.minutes < MIN_MINUTES) continue
    totalMinutes += v.minutes
    const bucket = byCategory.get(v.category) ?? { minutes: 0, apps: [] }
    bucket.minutes += v.minutes
    bucket.apps.push({ app, minutes: v.minutes })
    byCategory.set(v.category, bucket)
  }

  if (totalMinutes === 0) return { date, text: '', totalMinutes: 0, empty: true }

  const parts = [...byCategory.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([category, bucket]) => {
      const named = bucket.apps.sort((a, b) => b.minutes - a.minutes).slice(0, NAME_TOP)
      const rest = bucket.apps.length - named.length
      const list = named.map((a) => a.app).join(', ') + (rest > 0 ? `, +${rest} app` : '')
      return `${categoryLabel(category)} ${minutesText(bucket.minutes)} (${list})`
    })

  return {
    date,
    text: `Trên máy tính: ${minutesText(totalMinutes)} — ${parts.join('; ')}.`,
    totalMinutes,
    empty: false,
  }
}

/**
 * Lấy bản nhật ký từ máy của một ngày, tạo nếu chưa có.
 *
 * Ngày đã qua giữ nguyên bản đã lưu; chỉ hôm nay mới tính lại. Cùng lý do với
 * `getAutoEntry`: tính lại mọi lúc thì gỡ agent hôm nay sẽ xoá sạch lịch sử.
 */
export async function getDeviceEntry(userId: string, date: string): Promise<DiaryEntry | null> {
  const existing = await db.diaryEntry.findUnique({
    where: { userId_date_source: { userId, date, source: 'AUTO_DEVICE' } },
  })
  if (existing && date < vnToday()) return existing

  const summary = await buildDeviceSummary(userId, date)
  if (summary.empty) {
    if (existing) await db.diaryEntry.delete({ where: { id: existing.id } })
    return null
  }

  return db.diaryEntry.upsert({
    where: { userId_date_source: { userId, date, source: 'AUTO_DEVICE' } },
    create: { userId, date, source: 'AUTO_DEVICE', content: summary.text },
    update: { content: summary.text },
  })
}
