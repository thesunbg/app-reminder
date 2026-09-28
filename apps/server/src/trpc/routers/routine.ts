import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { isValidRRule, occurrencesBetween, occursOn } from '../../lib/recurrence.js'
import { addDays, startOfWeek, vnToday } from '../../lib/time.js'
import { materializeRoutines, rescheduleRoutine } from '../../notifications/materialize.js'
import { assertCanEditRoutine, canEditRoutine, markTask } from '../../routines/mark.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải dạng YYYY-MM-DD')
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải dạng HH:mm')

const routineInput = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40).default('general'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  durationMin: z.number().int().min(1).max(24 * 60).default(30),
  timeOfDay: timeSchema,
  rrule: z.string().min(3).refine(isValidRRule, 'Quy tắc lặp không hợp lệ'),
  startDate: dateSchema.optional(),
  targetPerWeek: z.number().int().min(1).max(21).nullish(),
  remindBeforeMin: z.number().int().min(0).max(24 * 60).default(10),
  nagAfterMin: z.number().int().min(5).max(24 * 60).nullish(),
  ownerId: z.string().optional(),
})

// `canEditRoutine`, `assertCanEditRoutine` và `markTask` nằm ở routines/mark.ts
// vì tin nhắn Telegram cũng tick được, không chỉ giao diện web.

export const routineRouter = router({
  list: protectedProcedure
    .input(z.object({ ownerId: z.string().optional(), includeArchived: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const ownerId = input.ownerId ?? (ctx.user.role === 'PARENT' ? undefined : ctx.user.id)
      const rows = await db.routine.findMany({
        where: {
          familyId: ctx.user.familyId,
          ...(ownerId ? { ownerId } : {}),
          ...(input.includeArchived ? {} : { active: true }),
        },
        orderBy: [{ sortOrder: 'asc' }, { timeOfDay: 'asc' }],
        include: { owner: { select: { id: true, name: true, avatarColor: true, role: true } } },
      })
      return rows.map((r) => ({ ...r, canEdit: canEditRoutine(ctx.user.id, ctx.user.role, r.owner) }))
    }),

  /** Danh sách việc phải làm của một ngày, kèm trạng thái đã tick hay chưa. */
  day: protectedProcedure
    .input(z.object({ date: dateSchema.optional(), ownerId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const date = input.date ?? vnToday()
      const ownerId = input.ownerId ?? (ctx.user.role === 'PARENT' ? undefined : ctx.user.id)

      const routines = await db.routine.findMany({
        where: {
          familyId: ctx.user.familyId,
          active: true,
          ...(ownerId ? { ownerId } : {}),
        },
        orderBy: [{ timeOfDay: 'asc' }, { sortOrder: 'asc' }],
        include: { owner: { select: { id: true, name: true, avatarColor: true, role: true } } },
      })

      const due = routines.filter((r) => occursOn(r.rrule, r.startDate, date))
      if (due.length === 0) return { date, items: [] }

      const logs = await db.taskLog.findMany({
        where: { date, routineId: { in: due.map((r) => r.id) } },
      })
      const byRoutine = new Map(logs.map((l) => [l.routineId, l]))

      return {
        date,
        items: due.map((r) => ({
          routine: r,
          log: byRoutine.get(r.id) ?? null,
          // giao diện dùng cờ này để khoá nút tick thay vì để người ta bấm rồi
          // mới nhận lỗi
          canEdit: canEditRoutine(ctx.user.id, ctx.user.role, r.owner),
        })),
      }
    }),

  create: protectedProcedure.input(routineInput).mutation(async ({ ctx, input }) => {
    const { ownerId, startDate, ...rest } = input
    // chỉ phụ huynh mới giao việc cho người khác
    const targetOwner = ownerId && ownerId !== ctx.user.id ? ownerId : ctx.user.id
    if (targetOwner !== ctx.user.id && ctx.user.role !== 'PARENT') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Không thể giao việc cho người khác' })
    }
    if (targetOwner !== ctx.user.id) {
      const target = await db.user.findUnique({ where: { id: targetOwner } })
      if (!target || target.familyId !== ctx.user.familyId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
      }
    }
    const created = await db.routine.create({
      data: {
        ...rest,
        startDate: startDate ?? vnToday(),
        familyId: ctx.user.familyId,
        ownerId: targetOwner,
      },
    })
    await materializeRoutines()
    return created
  }),

  update: protectedProcedure
    .input(z.object({ id: z.string() }).merge(routineInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const { id, ownerId: _ignored, ...data } = input
      await assertCanEditRoutine(ctx.user, id)
      const updated = await db.routine.update({ where: { id }, data })
      await rescheduleRoutine(id)
      return updated
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEditRoutine(ctx.user, input.id)
      const archived = await db.routine.update({
        where: { id: input.id },
        data: { active: false, archivedAt: new Date() },
      })
      await rescheduleRoutine(input.id, false)
      return archived
    }),

  /** Tick hoàn thành / bỏ qua. Gọi lại với status cũ = bỏ tick. */
  mark: protectedProcedure
    .input(
      z.object({
        routineId: z.string(),
        date: dateSchema,
        status: z.enum(['DONE', 'PARTIAL', 'SKIPPED']),
        actualMin: z.number().int().min(0).max(24 * 60).nullish(),
        note: z.string().trim().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { log } = await markTask(ctx.user, input)
      return log
    }),

  /** Lưới 7 ngày của tuần chứa `date`, dùng cho màn hình tuần. */
  week: protectedProcedure
    .input(z.object({ date: dateSchema.optional(), ownerId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const anchor = input.date ?? vnToday()
      const from = startOfWeek(anchor)
      const to = addDays(from, 6)
      const ownerId = input.ownerId ?? (ctx.user.role === 'PARENT' ? undefined : ctx.user.id)

      const routines = await db.routine.findMany({
        where: { familyId: ctx.user.familyId, active: true, ...(ownerId ? { ownerId } : {}) },
        orderBy: [{ timeOfDay: 'asc' }],
        include: { owner: { select: { id: true, name: true, role: true } } },
      })
      const logs = await db.taskLog.findMany({
        where: { date: { gte: from, lte: to }, routineId: { in: routines.map((r) => r.id) } },
      })
      const logKey = (rid: string, d: string) => `${rid}|${d}`
      const logMap = new Map(logs.map((l) => [logKey(l.routineId, l.date), l]))

      return {
        from,
        to,
        rows: routines.map((r) => {
          const days = occurrencesBetween(r.rrule, r.startDate, from, to)
          const dayset = new Set(days)
          return {
            routine: r,
            canEdit: canEditRoutine(ctx.user.id, ctx.user.role, r.owner),
            days: Array.from({ length: 7 }, (_, i) => {
              const d = addDays(from, i)
              return {
                date: d,
                due: dayset.has(d),
                log: logMap.get(logKey(r.id, d)) ?? null,
              }
            }),
          }
        }),
      }
    }),
})
