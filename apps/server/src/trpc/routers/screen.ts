/**
 * Quản lý agent máy tính và xem báo cáo thời lượng dùng app (Phase 8).
 *
 * Quyền: phụ huynh xem được cả nhà và cấp được token cho máy của con; con chỉ
 * xem và quản lý máy của chính mình. Cùng khuôn với học tập/nhật ký.
 *
 * Minh bạch là một phần của thiết kế, không phải tuỳ chọn: con luôn thấy đúng
 * những gì bố mẹ thấy về máy mình, và luôn tự gỡ được máy khỏi danh sách.
 * Lý do ở docs/PLAN.md mục 1 và 7.
 */
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { addDays, diffDays, vnToday } from '../../lib/time.js'
import { buildScreenSummary, hashAgentToken, newAgentToken } from '../../screen/report.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Regex chỉ nói "đúng hình dạng", không nói "hợp lý". `from: '0001-01-01'` vẫn
 * lọt, và `dateRange` sẽ dựng bảy trăm nghìn phần tử — treo cả tiến trình.
 * Một năm đã dài hơn mọi câu hỏi thật sự ai đó đặt ra ở màn hình này.
 */
const MAX_RANGE_DAYS = 366

/** Ai được xem/sửa máy của `targetId`? */
async function assertAccess(
  viewer: { id: string; role: string; familyId: string },
  targetId: string,
): Promise<void> {
  if (viewer.id === targetId) return
  if (viewer.role !== 'PARENT') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không xem được máy của người khác' })
  }
  const target = await db.user.findUnique({ where: { id: targetId }, select: { familyId: true } })
  if (!target || target.familyId !== viewer.familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
  }
}

export const screenRouter = router({
  /** Máy đã ghép của một người + tình trạng còn báo cáo hay không. */
  devices: protectedProcedure
    .input(z.object({ userId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.user.id
      await assertAccess(ctx.user, userId)
      return db.agentDevice.findMany({
        where: { userId },
        // tokenHash không bao giờ ra khỏi server
        select: { id: true, name: true, platform: true, createdAt: true, lastSeenAt: true, lastReportAt: true },
        orderBy: { createdAt: 'asc' },
      })
    }),

  /**
   * Ghép một máy mới. Token thô trả về **đúng một lần** — mất thì tạo máy khác,
   * không có đường xem lại, vì DB chỉ giữ hash.
   */
  createDevice: protectedProcedure
    .input(
      z.object({
        userId: z.string().optional(),
        name: z.string().min(1).max(60),
        platform: z.enum(['darwin', 'win32', 'linux']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.user.id
      await assertAccess(ctx.user, userId)

      const token = newAgentToken()
      const device = await db.agentDevice.create({
        data: { userId, name: input.name, platform: input.platform, tokenHash: hashAgentToken(token) },
        select: { id: true, name: true, platform: true, createdAt: true },
      })
      return { device, token }
    }),

  /** Gỡ máy: token ngừng có tác dụng ngay, dữ liệu đã báo cáo cũng đi theo. */
  removeDevice: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const device = await db.agentDevice.findUnique({ where: { id: input.id } })
      if (!device) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy máy' })
      await assertAccess(ctx.user, device.userId)
      await db.agentDevice.delete({ where: { id: input.id } })
      return { ok: true }
    }),

  /** Báo cáo thời lượng theo ngày / theo app / theo nhóm. */
  summary: protectedProcedure
    .input(
      z.object({
        userId: z.string().optional(),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
      }).default({}),
    )
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? ctx.user.id
      await assertAccess(ctx.user, userId)
      const to = input.to ?? vnToday()
      const from = input.from ?? addDays(to, -13)
      const span = diffDays(from, to)
      if (span < 0 || span > MAX_RANGE_DAYS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Khoảng xem tối đa ${MAX_RANGE_DAYS} ngày` })
      }
      return buildScreenSummary(userId, from, to)
    }),
})
