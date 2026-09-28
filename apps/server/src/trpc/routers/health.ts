/**
 * Sổ sức khoẻ gia đình.
 *
 * Bốn thứ nhà nào cũng phải nhớ mà không ai nhớ nổi: con cao cân bao nhiêu hồi
 * tháng trước, đã tiêm mũi nào, hẹn tái khám ngày nào, đang uống thuốc gì.
 * Trước giờ nằm rải rác trong ảnh chụp sổ giấy và trí nhớ.
 *
 * Quyền: phụ huynh xem và ghi cho cả nhà (sức khoẻ của con là việc bố mẹ lo);
 * con chỉ xem và ghi phần của mình — không thấy hồ sơ của bố mẹ hay anh chị em.
 */
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { clearHealthNotifications, materializeHealth } from '../../notifications/health.js'
import { diffDays, vnToday } from '../../lib/time.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const recordInput = z.object({
  userId: z.string(),
  kind: z.enum(['GROWTH', 'VACCINE', 'CHECKUP', 'MEDICINE']),
  date: dateSchema,
  title: z.string().trim().max(200).default(''),
  // người: 30–250cm, 1–250kg. Chặn ở đây để một lần gõ nhầm không làm gãy biểu đồ.
  heightCm: z.number().min(30).max(250).nullish(),
  weightKg: z.number().min(1).max(250).nullish(),
  note: z.string().trim().max(1000).nullish(),
  nextDate: dateSchema.nullish(),
})

type Actor = { id: string; role: string; familyId: string }

/** Ai được xem/ghi hồ sơ của ai. */
async function assertCanTouch(actor: Actor, userId: string) {
  if (userId === actor.id) return
  if (actor.role !== 'PARENT') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ xem được hồ sơ sức khoẻ của chính mình' })
  }
  const target = await db.user.findUnique({ where: { id: userId }, select: { familyId: true } })
  if (!target || target.familyId !== actor.familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
  }
}

/**
 * GROWTH phải có ít nhất một trong hai số đo — bản ghi rỗng chỉ làm nhiễu biểu
 * đồ. Các loại khác phải có tiêu đề, vì "một mũi tiêm không tên" thì vô dụng.
 */
function assertShape(input: z.infer<typeof recordInput>) {
  if (input.kind === 'GROWTH') {
    if (input.heightCm == null && input.weightKg == null) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cần ít nhất chiều cao hoặc cân nặng' })
    }
    return
  }
  if (!input.title.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cần ghi tên (mũi tiêm, lý do khám, tên thuốc)' })
  }
}

/** BMI = kg / m². Chỉ tính khi có đủ hai số. */
export function bmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg) return null
  const m = heightCm / 100
  return Math.round((weightKg / (m * m)) * 10) / 10
}

export const healthRouter = router({
  /** Những người mà tôi được xem hồ sơ. */
  people: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'PARENT') {
      const { id, name, avatarColor, birthday } = ctx.user
      return [{ id, name, avatarColor, birthday }]
    }
    return db.user.findMany({
      where: { familyId: ctx.user.familyId, active: true },
      select: { id: true, name: true, avatarColor: true, birthday: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  /**
   * Toàn bộ sổ của một người: dòng thời gian theo loại + chuỗi số đo đã sắp
   * tăng dần để vẽ biểu đồ (kèm BMI tính sẵn, client khỏi tính lại).
   */
  list: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanTouch(ctx.user, input.userId)
      const rows = await db.healthRecord.findMany({
        where: { userId: input.userId },
        orderBy: { date: 'desc' },
      })
      const growth = rows
        .filter((r) => r.kind === 'GROWTH')
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({
          id: r.id,
          date: r.date,
          heightCm: r.heightCm,
          weightKg: r.weightKg,
          bmi: bmi(r.heightCm, r.weightKg),
        }))

      const today = vnToday()
      // hẹn sắp tới: mũi tiêm kế, ngày tái khám — thứ người ta mở sổ ra để xem
      const upcoming = rows
        .filter((r) => r.nextDate && r.nextDate >= today)
        .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!))
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          nextDate: r.nextDate!,
          daysUntil: diffDays(today, r.nextDate!),
        }))

      return { records: rows, growth, upcoming }
    }),

  create: protectedProcedure.input(recordInput).mutation(async ({ ctx, input }) => {
    await assertCanTouch(ctx.user, input.userId)
    assertShape(input)
    const created = await db.healthRecord.create({ data: input })
    await materializeHealth()
    return created
  }),

  update: protectedProcedure
    .input(recordInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input
      const existing = await db.healthRecord.findUnique({ where: { id } })
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi' })
      await assertCanTouch(ctx.user, existing.userId)
      await assertCanTouch(ctx.user, data.userId)
      assertShape(input)

      const updated = await db.healthRecord.update({ where: { id }, data })
      // ngày hẹn có thể đã đổi -> lịch nhắc cũ không còn đúng
      await clearHealthNotifications(id)
      await materializeHealth()
      return updated
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.healthRecord.findUnique({ where: { id: input.id } })
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi' })
      await assertCanTouch(ctx.user, existing.userId)
      await clearHealthNotifications(input.id)
      await db.healthRecord.delete({ where: { id: input.id } })
      return { ok: true }
    }),
})
