/**
 * Nhận báo cáo thời lượng dùng app từ agent máy tính và tổng hợp lại (Phase 8).
 *
 * Nguyên tắc của cả phase này: agent chỉ **đọc và báo cáo**, không chặn, không
 * giới hạn. Việc cưỡng chế giao cho Screen Time / Family Link ở tầng hệ điều
 * hành — lý do ở docs/PLAN.md mục 1.
 */
import { createHash, randomBytes } from 'node:crypto'
import { db } from '../db.js'
import { categoryOf, type Category } from '../lib/appCategory.js'
import { dateRange } from '../lib/time.js'

/** Token thô chỉ tồn tại ở máy agent; DB giữ hash — giống cách làm của Session. */
export const hashAgentToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export function newAgentToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Tra agent theo token và đánh dấu nó còn sống.
 * @returns null nếu token sai — người gọi trả 401, không nói rõ sai chỗ nào.
 */
export async function authenticateAgent(token: string | undefined) {
  if (!token) return null
  const device = await db.agentDevice.findUnique({
    where: { tokenHash: hashAgentToken(token) },
    include: { user: { select: { id: true, active: true, familyId: true } } },
  })
  if (!device || !device.user.active) return null
  return device
}

export type Sample = { app: string; minutes: number }

/** Tên app dài bất thường thường là tiêu đề cửa sổ lọt vào — cắt bớt, đừng để phình DB. */
const MAX_APP_LEN = 120
/** Một ngày có 1440 phút; nhiều hơn là agent tính sai hoặc ai đó nghịch API. */
const MAX_MINUTES = 1440

/**
 * Ghi báo cáo của một ngày.
 *
 * Agent gửi **tổng cộng dồn của cả ngày**, không gửi phần chênh lệch. Nhờ vậy
 * gửi lại bao nhiêu lần cũng ra cùng kết quả: mất mạng rồi gửi bù, hay agent
 * khởi động lại giữa chừng, đều không làm số bị cộng đôi.
 *
 * @returns số dòng đã ghi
 */
export async function ingestReport(
  deviceId: string,
  userId: string,
  date: string,
  samples: Sample[],
): Promise<number> {
  // Cùng một app có thể tới dưới hai tên hơi khác nhau (vd khác hoa thường);
  // gộp trước khi ghi, nếu không unique key sẽ chặn dòng thứ hai.
  const merged = new Map<string, number>()
  for (const s of samples) {
    const app = s.app.trim().slice(0, MAX_APP_LEN)
    if (!app) continue
    const minutes = Math.min(Math.max(Math.round(s.minutes), 0), MAX_MINUTES)
    if (minutes <= 0) continue
    merged.set(app, Math.min((merged.get(app) ?? 0) + minutes, MAX_MINUTES))
  }

  const rows = [...merged.entries()]
  await db.$transaction([
    // Một app đã biến mất khỏi báo cáo nghĩa là agent tính lại và không còn nó
    // nữa (vd nó vốn là nhiễu). Xoá đi để báo cáo phản ánh đúng lần gửi cuối.
    db.screenReport.deleteMany({
      where: { deviceId, date, app: { notIn: rows.map(([app]) => app) } },
    }),
    ...rows.map(([app, minutes]) =>
      db.screenReport.upsert({
        where: { deviceId_date_app: { deviceId, date, app } },
        create: { deviceId, userId, date, app, minutes, category: categoryOf(app) },
        // category tính lại mỗi lần: sửa bảng phân loại là báo cáo cũ cũng theo
        update: { minutes, userId, category: categoryOf(app) },
      }),
    ),
    db.agentDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), lastReportAt: new Date() },
    }),
  ])

  return rows.length
}

/** Tính lại nhóm cho toàn bộ dữ liệu cũ sau khi sửa bảng phân loại. */
export async function recategorize(): Promise<number> {
  const rows = await db.screenReport.findMany({ select: { id: true, app: true, category: true } })
  const changed = rows.filter((r) => categoryOf(r.app) !== r.category)
  for (const r of changed) {
    await db.screenReport.update({ where: { id: r.id }, data: { category: categoryOf(r.app) } })
  }
  return changed.length
}

// ------------------------------------------------------------------ tổng hợp

export type DayTotal = { date: string; minutes: number }
export type AppTotal = { app: string; category: Category; minutes: number }
export type CategoryTotal = { category: Category; minutes: number }

export type ScreenSummary = {
  from: string
  to: string
  totalMinutes: number
  /** trung bình mỗi ngày có dữ liệu (ngày không có máy nào bật thì không tính) */
  avgPerActiveDay: number
  byDay: DayTotal[]
  byApp: AppTotal[]
  byCategory: CategoryTotal[]
  devices: Array<{ id: string; name: string; platform: string | null; lastReportAt: Date | null }>
}

/** Bao nhiêu app hiện chi tiết; phần còn lại gộp vào một dòng. */
const TOP_APPS = 12

export async function buildScreenSummary(userId: string, from: string, to: string): Promise<ScreenSummary> {
  const [rows, devices] = await Promise.all([
    db.screenReport.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { date: true, app: true, category: true, minutes: true },
    }),
    db.agentDevice.findMany({
      where: { userId },
      select: { id: true, name: true, platform: true, lastReportAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // Cộng qua các máy: một người có thể vừa dùng laptop vừa dùng máy bàn.
  const dayMap = new Map<string, number>()
  const appMap = new Map<string, { category: Category; minutes: number }>()
  const catMap = new Map<Category, number>()
  let totalMinutes = 0

  for (const r of rows) {
    totalMinutes += r.minutes
    dayMap.set(r.date, (dayMap.get(r.date) ?? 0) + r.minutes)
    const cat = r.category as Category
    catMap.set(cat, (catMap.get(cat) ?? 0) + r.minutes)
    const prev = appMap.get(r.app)
    appMap.set(r.app, { category: cat, minutes: (prev?.minutes ?? 0) + r.minutes })
  }

  // Trục ngày phải liên tục để biểu đồ không nối tắt qua ngày nghỉ.
  const byDay = dateRange(from, to).map((date) => ({ date, minutes: dayMap.get(date) ?? 0 }))
  const activeDays = byDay.filter((d) => d.minutes > 0).length

  const sortedApps = [...appMap.entries()]
    .map(([app, v]) => ({ app, category: v.category, minutes: v.minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  const byApp = sortedApps.slice(0, TOP_APPS)
  const rest = sortedApps.slice(TOP_APPS)
  if (rest.length > 0) {
    byApp.push({
      app: `${rest.length} app khác`,
      category: 'other',
      minutes: rest.reduce((sum, a) => sum + a.minutes, 0),
    })
  }

  return {
    from,
    to,
    totalMinutes,
    avgPerActiveDay: activeDays === 0 ? 0 : Math.round(totalMinutes / activeDays),
    byDay,
    byApp,
    byCategory: [...catMap.entries()]
      .map(([category, minutes]) => ({ category, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    devices,
  }
}
