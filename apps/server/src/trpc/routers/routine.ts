import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { isValidRRule, occurrencesBetween, occursOn } from '../../lib/recurrence.js'
import { addDays, startOfWeek, vnToday } from '../../lib/time.js'
import {
  cancelRoutineNotifications,
  materializeRoutines,
  rescheduleRoutine,
  restoreRoutineNotifications,
} from '../../notifications/materialize.js'
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

/** Người dùng chỉ thao tác được trên routine của mình; phụ huynh thao tác được trên cả nhà. */
async function assertCanEdit(userId: string, role: string, familyId: string, routineId: string) {
  const routine = await db.routine.findUnique({ where: { id: routineId } })
  if (!routine || routine.familyId !== familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy công việc' })
  }
  if (routine.ownerId !== userId && role !== 'PARENT') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền sửa công việc này' })
  }
  return routine
}

export const routineRouter = router({
  list: protectedProcedure
    .input(z.object({ ownerId: z.string().optional(), includeArchived: z.boolean().default(false) }).default({}))
    .query(async ({ ctx, input }) => {
      const ownerId = input.ownerId ?? (ctx.user.role === 'PARENT' ? undefined : ctx.user.id)
      return db.routine.findMany({
        where: {
          familyId: ctx.user.familyId,
          ...(ownerId ? { ownerId } : {}),
          ...(input.includeArchived ? {} : { active: true }),
        },
        orderBy: [{ sortOrder: 'asc' }, { timeOfDay: 'asc' }],
        include: { owner: { select: { id: true, name: true, avatarColor: true } } },
      })
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
        include: { owner: { select: { id: true, name: true, avatarColor: true } } },
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
      await assertCanEdit(ctx.user.id, ctx.user.role, ctx.user.familyId, id)
      const updated = await db.routine.update({ where: { id }, data })
      await rescheduleRoutine(id)
      return updated
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanEdit(ctx.user.id, ctx.user.role, ctx.user.familyId, input.id)
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
      const routine = await assertCanEdit(ctx.user.id, ctx.user.role, ctx.user.familyId, input.routineId)
      if (!occursOn(routine.rrule, routine.startDate, input.date)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Công việc này không rơi vào ngày đó' })
      }
      const existing = await db.taskLog.findUnique({
        where: { routineId_date: { routineId: input.routineId, date: input.date } },
      })
      // tick lại đúng trạng thái đang có -> bỏ tick
      if (existing && existing.status === input.status && input.actualMin == null && input.note == null) {
        await db.taskLog.delete({ where: { id: existing.id } })
        // bỏ tick -> việc lại còn nợ, bật lại các nhắc nhở chưa tới giờ
        await restoreRoutineNotifications(input.routineId, input.date)
        return null
      }
      const log = await db.taskLog.upsert({
        where: { routineId_date: { routineId: input.routineId, date: input.date } },
        create: {
          routineId: input.routineId,
          date: input.date,
          status: input.status,
          actualMin: input.actualMin ?? (input.status === 'DONE' ? routine.durationMin : null),
          note: input.note ?? null,
        },
        update: {
          status: input.status,
          actualMin: input.actualMin ?? undefined,
          note: input.note ?? undefined,
          doneAt: new Date(),
        },
      })
      // đã tick rồi thì đừng nhắc nữa — nhắc tiếp làm người ta mất tin vào app
      await cancelRoutineNotifications(input.routineId, input.date)
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
