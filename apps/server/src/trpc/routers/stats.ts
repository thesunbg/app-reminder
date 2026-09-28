import { z } from 'zod'
import { buildSummary } from '../../stats/summary.js'
import { buildStreaks } from '../../stats/streaks.js'
import { addDays, vnToday } from '../../lib/time.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const statsRouter = router({
  /** Tổng quan cho dashboard: tỉ lệ hoàn thành, phút theo nhóm, chuỗi ngày liên tiếp. */
  summary: protectedProcedure
    .input(
      z.object({
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        ownerId: z.string().optional(),
      }).default({}),
    )
    .query(async ({ ctx, input }) => {
      const to = input.to ?? vnToday()
      const from = input.from ?? addDays(to, -29)
      const ownerId = input.ownerId ?? (ctx.user.role === 'PARENT' ? undefined : ctx.user.id)
      return buildSummary(ctx.user.familyId, ownerId, from, to)
    }),

  /**
   * Chuỗi liên tiếp của từng việc + huy hiệu đã đạt.
   * Tính trên toàn bộ lịch sử chứ không theo khoảng đang xem — chuỗi mà reset
   * mỗi lần đổi bộ lọc thì không còn là chuỗi.
   */
  streaks: protectedProcedure
    .input(z.object({ ownerId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const ownerId = input.ownerId ?? (ctx.user.role === 'PARENT' ? undefined : ctx.user.id)
      return buildStreaks(ctx.user.familyId, ownerId)
    }),
})
