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
  /// môn không bắt buộc — ghi nhanh rồi phân loại sau
  subject: z.string().trim().max(60).nullish(),
  /// nội dung, có thể nhiều dòng (chép nguyên đề bài)
  title: z.string().trim().min(1).max(4000),
  /// hạn nộp: bắt buộc với EXAM/SCORE, tuỳ chọn với HOMEWORK (xem assertDate)
  date: dateSchema.nullish(),
  score: z.number().min(0).max(1000).nullish(),
  maxScore: z.number().min(1).max(1000).nullish(),
  note: z.string().trim().max(2000).nullish(),
})

/**
 * Bài thi và điểm luôn gắn với một ngày cụ thể (ngày thi, ngày có điểm) — thiếu
 * ngày thì không xếp được vào biểu đồ hay tính trung bình theo thời gian.
 * Bài tập thì được để trống: nó chỉ mất quyền được nhắc.
 */
function assertDate(kind: string | undefined, date: string | null | undefined) {
  if (kind && kind !== 'HOMEWORK' && !date) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bài thi và điểm phải có ngày' })
  }
}

/** Ảnh đính kèm: chỉ ảnh, mỗi tấm tối đa 3MB sau khi trình duyệt đã nén. */
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
const MAX_ATTACHMENTS_PER_RECORD = 6
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const

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
      const window = input.from || input.to
        ? {
            // bài tập không có hạn thì không rơi vào khoảng nào — vẫn phải hiện,
            // nếu không con ghi xong rồi mở lại thấy mất bài
            OR: [
              { date: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } },
              ...(input.kind === 'HOMEWORK' ? [{ date: null }] : []),
            ],
          }
        : {}
      return db.studyRecord.findMany({
        where: {
          childId: input.childId,
          ...(input.kind ? { kind: input.kind } : {}),
          ...window,
          ...(input.pendingOnly ? { doneAt: null } : {}),
        },
        orderBy: [
          // bài chưa có hạn xuống cuối, đừng để nó chen lên đầu danh sách
          { date: { sort: input.kind === 'HOMEWORK' ? 'asc' : 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        // data của ảnh nặng nên không kéo về đây; client tải từng ảnh qua /study/anh/:id
        include: { attachments: { select: { id: true, mime: true, width: true, height: true }, orderBy: { createdAt: 'asc' } } },
        take: 300,
      })
    }),

  recordCreate: protectedProcedure.input(recordInput).mutation(async ({ ctx, input }) => {
    await assertChild(ctx, input.childId)
    assertDate(input.kind, input.date)
    const rec = await db.studyRecord.create({ data: input })
    if (rec.kind === 'HOMEWORK') await materializeHomework()
    return rec
  }),

  recordUpdate: protectedProcedure
    .input(recordInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await ownRecord(ctx, input.id)
      assertDate(input.kind ?? rec.kind, 'date' in input ? input.date : rec.date)
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

  // ---------- ảnh đính kèm ----------

  /**
   * Thêm ảnh cho một bài tập. Nhận base64 qua tRPC thay vì multipart: ảnh đã
   * được trình duyệt nén về ~1600px nên chỉ vài trăm KB, không đáng dựng thêm
   * một đường upload riêng.
   */
  attachmentAdd: protectedProcedure
    .input(
      z.object({
        recordId: z.string(),
        mime: z.enum(ALLOWED_MIME),
        /// nội dung ảnh, base64 (không có tiền tố data:)
        data: z.string().min(1),
        width: z.number().int().positive().nullish(),
        height: z.number().int().positive().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ownRecord(ctx, input.recordId)
      const count = await db.studyAttachment.count({ where: { recordId: input.recordId } })
      if (count >= MAX_ATTACHMENTS_PER_RECORD) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Tối đa ${MAX_ATTACHMENTS_PER_RECORD} ảnh mỗi bài` })
      }
      const buf = Buffer.from(input.data, 'base64')
      if (buf.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ảnh rỗng' })
      if (buf.length > MAX_ATTACHMENT_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ảnh quá lớn (tối đa 3MB)' })
      }
      const row = await db.studyAttachment.create({
        data: {
          recordId: input.recordId,
          mime: input.mime,
          size: buf.length,
          width: input.width ?? null,
          height: input.height ?? null,
          data: buf,
        },
        select: { id: true, mime: true, width: true, height: true },
      })
      return row
    }),

  attachmentRemove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await db.studyAttachment.findUnique({ where: { id: input.id } })
      if (!row) return { ok: true }
      await ownRecord(ctx, row.recordId)
      await db.studyAttachment.delete({ where: { id: input.id } })
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

      // bài không có hạn nằm ở "chưa xong" chứ không bao giờ là "quá hạn"
      const pending = homework.filter((h) => !h.doneAt && (!h.date || h.date >= today))
      const overdue = homework.filter((h) => !h.doneAt && h.date && h.date < today)
      const doneThisWeek = homework.filter((h) => h.doneAt).length

      // điểm trung bình theo môn, quy về thang 10 để so được giữa các bài khác thang
      const bySubject = new Map<string, { sum: number; n: number; last: number }>()
      for (const s of scores) {
        const v = (s.score! / (s.maxScore ?? 10)) * 10
        // môn có thể để trống — gom vào một nhóm chung thay vì bỏ điểm đi
        const subject = s.subject ?? 'Chưa phân môn'
        const cur = bySubject.get(subject) ?? { sum: 0, n: 0, last: v }
        cur.sum += v
        cur.n += 1
        bySubject.set(subject, cur)
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
