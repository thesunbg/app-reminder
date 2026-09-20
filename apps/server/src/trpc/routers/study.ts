import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { addDays, isoWeekday, startOfWeek, vnToday } from '../../lib/time.js'
import { clearHomeworkNotifications, materializeHomework } from '../../notifications/homework.js'
import { buildSummary } from '../../stats/summary.js'
import type { Context } from '../trpc.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/)
const KINDS = ['HOMEWORK', 'EXAM', 'SCORE'] as const

/**
 * Quyền: phụ huynh thấy/sửa mọi con trong nhà; con chỉ thấy/sửa của mình.
 * Con tự nhập bài tập của mình là chủ đích (docs/PLAN.md mục 7) — không phải
 * bố mẹ nhập hộ.
 */
async function assertChild(ctx: Context & { user: NonNullable<Context['user']> }, childId: string) {
  if (childId === ctx.user.id) return ctx.user
  if (ctx.user.role !== 'PARENT') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ xem được dữ liệu của mình' })
  }
  const child = await db.user.findFirst({ where: { id: childId, familyId: ctx.user.familyId } })
  if (!child) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không có thành viên này' })
  return child
}

async function ownRecord(ctx: Context & { user: NonNullable<Context['user']> }, id: string) {
  const rec = await db.studyRecord.findUnique({ where: { id } })
  if (!rec) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy' })
  await assertChild(ctx, rec.childId)
  return rec
}

const scheduleInput = z.object({
  childId: z.string(),
  weekday: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(15),
  subject: z.string().trim().min(1).max(60),
  room: z.string().trim().max(40).nullish(),
  teacher: z.string().trim().max(60).nullish(),
  startTime: timeSchema,
  endTime: timeSchema,
  effectiveFrom: dateSchema.optional(),
  effectiveTo: dateSchema.nullish(),
})

const recordInput = z.object({
  childId: z.string(),
  kind: z.enum(KINDS),
  subject: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200),
  date: dateSchema,
  score: z.number().min(0).max(1000).nullish(),
  maxScore: z.number().min(1).max(1000).nullish(),
  note: z.string().trim().max(2000).nullish(),
})

export const studyRouter = router({
  /** Danh sách "con" mà người này được xem: phụ huynh → mọi con; con → chính mình. */
  children: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'PARENT') {
      const { id, name, avatarColor, birthday } = ctx.user
      return [{ id, name, avatarColor, birthday }]
    }
    return db.user.findMany({
      where: { familyId: ctx.user.familyId, role: 'CHILD', active: true },
      select: { id: true, name: true, avatarColor: true, birthday: true },
      orderBy: { createdAt: 'asc' },
    })
  }),

  // ---------- thời khoá biểu ----------

  schedule: protectedProcedure
    .input(z.object({ childId: z.string(), date: dateSchema.optional() }))
    .query(async ({ ctx, input }) => {
      await assertChild(ctx, input.childId)
      const on = input.date ?? vnToday()
      return db.classSchedule.findMany({
        where: {
          childId: input.childId,
          effectiveFrom: { lte: on },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
        },
        orderBy: [{ weekday: 'asc' }, { period: 'asc' }, { startTime: 'asc' }],
      })
    }),

  scheduleUpsert: protectedProcedure
    .input(scheduleInput.extend({ id: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertChild(ctx, input.childId)
      if (input.endTime <= input.startTime) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Giờ kết thúc phải sau giờ bắt đầu' })
      }
      const { id, ...data } = input
      const payload = { ...data, effectiveFrom: data.effectiveFrom ?? vnToday() }
      if (id) {
        const existing = await db.classSchedule.findUnique({ where: { id } })
        if (!existing || existing.childId !== input.childId) throw new TRPCError({ code: 'NOT_FOUND' })
        return db.classSchedule.update({ where: { id }, data: payload })
      }
      return db.classSchedule.create({ data: payload })
    }),

  scheduleRemove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await db.classSchedule.findUnique({ where: { id: input.id } })
      if (!row) return { ok: true }
      await assertChild(ctx, row.childId)
      await db.classSchedule.delete({ where: { id: input.id } })
      return { ok: true }
    }),

  /** Chép nguyên tuần của một con sang con khác (hai anh em cùng trường). */
  scheduleCopy: protectedProcedure
    .input(z.object({ fromChildId: z.string(), toChildId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertChild(ctx, input.fromChildId)
      await assertChild(ctx, input.toChildId)
      const rows = await db.classSchedule.findMany({ where: { childId: input.fromChildId, effectiveTo: null } })
      await db.classSchedule.createMany({
        data: rows.map(({ id: _id, childId: _c, ...r }) => ({ ...r, childId: input.toChildId })),
      })
      return { copied: rows.length }
    }),

  // ---------- bài tập / bài thi / điểm ----------

  records: protectedProcedure
    .input(
      z.object({
        childId: z.string(),
        kind: z.enum(KINDS).optional(),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        /** HOMEWORK: chỉ lấy chưa xong */
        pendingOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertChild(ctx, input.childId)
      return db.studyRecord.findMany({
        where: {
          childId: input.childId,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.from || input.to ? { date: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
          ...(input.pendingOnly ? { doneAt: null } : {}),
        },
        orderBy: [{ date: input.kind === 'HOMEWORK' ? 'asc' : 'desc' }, { createdAt: 'desc' }],
        take: 300,
      })
    }),

  recordCreate: protectedProcedure.input(recordInput).mutation(async ({ ctx, input }) => {
    await assertChild(ctx, input.childId)
    const rec = await db.studyRecord.create({ data: input })
    if (rec.kind === 'HOMEWORK') await materializeHomework()
    return rec
  }),

  recordUpdate: protectedProcedure
    .input(recordInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await ownRecord(ctx, input.id)
      const { id, childId: _c, ...data } = input
      const updated = await db.studyRecord.update({ where: { id }, data })
      if (rec.kind === 'HOMEWORK') {
        await clearHomeworkNotifications(id)
        await materializeHomework()
      }
      return updated
    }),

  recordRemove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ownRecord(ctx, input.id)
      await clearHomeworkNotifications(input.id)
      await db.studyRecord.delete({ where: { id: input.id } })
      return { ok: true }
    }),

  /** Tick bài tập xong / bỏ tick. Xong thì huỷ nhắc; bỏ tick thì sinh lại. */
  homeworkToggle: protectedProcedure
    .input(z.object({ id: z.string(), done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await ownRecord(ctx, input.id)
      if (rec.kind !== 'HOMEWORK') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ bài tập mới tick được' })
      const updated = await db.studyRecord.update({
        where: { id: input.id },
        data: { doneAt: input.done ? new Date() : null },
      })
      if (input.done) await clearHomeworkNotifications(input.id)
      else await materializeHomework()
      return updated
    }),

  // ---------- dashboard ----------

  /**
   * Bức tranh một con trong tuần này: việc định kỳ, bài tập, điểm, nhật ký (đếm
   * thôi — nội dung theo quyền riêng tư của con), lịch học hôm nay.
   */
  dashboard: protectedProcedure
    .input(z.object({ childId: z.string() }))
    .query(async ({ ctx, input }) => {
      const child = await assertChild(ctx, input.childId)
      const today = vnToday()
      const weekStart = startOfWeek(today)
      const weekEnd = addDays(weekStart, 6)

      const [week, month, homework, scores, diaryCount, todayClasses, upcomingExams] = await Promise.all([
        buildSummary(ctx.user.familyId, child.id, weekStart, today),
        buildSummary(ctx.user.familyId, child.id, addDays(today, -29), today),
        db.studyRecord.findMany({
          where: { childId: child.id, kind: 'HOMEWORK', OR: [{ doneAt: null }, { doneAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] },
          orderBy: { date: 'asc' },
        }),
        db.studyRecord.findMany({
          where: { childId: child.id, kind: { in: ['SCORE', 'EXAM'] }, score: { not: null }, date: { gte: addDays(today, -90) } },
          orderBy: { date: 'desc' },
        }),
        db.diaryEntry.count({ where: { userId: child.id, source: 'MANUAL', date: { gte: addDays(today, -6), lte: today } } }),
        db.classSchedule.findMany({
          where: {
            childId: child.id,
            weekday: isoWeekday(today),
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          },
          orderBy: [{ period: 'asc' }, { startTime: 'asc' }],
        }),
        db.studyRecord.findMany({
          where: { childId: child.id, kind: 'EXAM', date: { gte: today, lte: addDays(today, 14) } },
          orderBy: { date: 'asc' },
        }),
      ])

      const pending = homework.filter((h) => !h.doneAt && h.date >= today)
      const overdue = homework.filter((h) => !h.doneAt && h.date < today)
      const doneThisWeek = homework.filter((h) => h.doneAt).length

      // điểm trung bình theo môn, quy về thang 10 để so được giữa các bài khác thang
      const bySubject = new Map<string, { sum: number; n: number; last: number }>()
      for (const s of scores) {
        const v = (s.score! / (s.maxScore ?? 10)) * 10
        const cur = bySubject.get(s.subject) ?? { sum: 0, n: 0, last: v }
        cur.sum += v
        cur.n += 1
        bySubject.set(s.subject, cur)
      }

      return {
        child: { id: child.id, name: child.name, avatarColor: child.avatarColor, diaryPrivate: child.diaryPrivate },
        week: { from: weekStart, to: weekEnd, completionRate: week.completionRate, totalDue: week.totalDue, totalDone: week.totalDone, totalMinutes: week.totalMinutes, streak: week.streak },
        month: { completionRate: month.completionRate, totalHours: month.totalHours, daily: month.daily },
        homework: { pending, overdue, doneThisWeek },
        upcomingExams,
        scores: {
          recent: scores.slice(0, 8),
          bySubject: [...bySubject.entries()]
            .map(([subject, v]) => ({ subject, avg: Math.round((v.sum / v.n) * 10) / 10, count: v.n, last: Math.round(v.last * 10) / 10 }))
            .sort((a, b) => a.subject.localeCompare(b.subject, 'vi')),
        },
        diary: { entriesThisWeek: diaryCount },
        todayClasses,
      }
    }),
})
