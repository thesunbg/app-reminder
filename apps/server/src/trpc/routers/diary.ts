import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { buildAutoSummary, getAutoEntry } from '../../diary/auto.js'
import { addDays, dateRange, vnToday } from '../../lib/time.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

/**
 * Quyền đọc nhật ký của người khác.
 *
 * Phụ huynh thấy CON CÓ VIẾT hay không, không thấy VIẾT GÌ, trừ khi người đó
 * tự tắt chế độ riêng tư. Lý do ở docs/PLAN.md mục 5.4: nhật ký mà bố mẹ đọc
 * được thì con sẽ viết cho bố mẹ đọc, chứ không viết cho mình.
 */
async function accessTo(viewer: { id: string; role: string; familyId: string }, targetId: string) {
  if (viewer.id === targetId) return { level: 'full' as const, target: null }
  const target = await db.user.findUnique({ where: { id: targetId } })
  if (!target || target.familyId !== viewer.familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
  }
  if (viewer.role !== 'PARENT') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Không xem được nhật ký của người khác' })
  }
  return { level: target.diaryPrivate ? ('meta' as const) : ('full' as const), target }
}

export const diaryRouter = router({
  /** Một ngày: bản viết tay + bản tự động. */
  day: protectedProcedure
    .input(z.object({ date: dateSchema.optional(), userId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const date = input.date ?? vnToday()
      const userId = input.userId ?? ctx.user.id
      const { level } = await accessTo(ctx.user, userId)

      const entries = await db.diaryEntry.findMany({ where: { userId, date } })
      const manual = entries.find((e) => e.source === 'MANUAL') ?? null

      if (level === 'meta') {
        return {
          date,
          private: true,
          manual: manual ? { hasContent: true, length: manual.content.length, updatedAt: manual.updatedAt } : null,
          auto: null,
          summary: null,
        }
      }

      // chỉ tự sinh bản auto cho chính mình — đừng ghi DB khi phụ huynh xem của con
      const auto = userId === ctx.user.id
        ? await getAutoEntry(userId, date)
        : entries.find((e) => e.source === 'AUTO_TASK') ?? null

      return {
        date,
        private: false,
        manual,
        auto,
        summary: await buildAutoSummary(userId, date),
      }
    }),

  /** Viết / sửa nhật ký của chính mình. Nội dung rỗng = xoá. */
  save: protectedProcedure
    .input(
      z.object({
        date: dateSchema,
        content: z.string().max(50_000),
        mood: z.number().int().min(1).max(5).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = { userId_date_source: { userId: ctx.user.id, date: input.date, source: 'MANUAL' as const } }
      if (input.content.trim().length === 0) {
        await db.diaryEntry.delete({ where: key }).catch(() => {})
        return null
      }
      return db.diaryEntry.upsert({
        where: key,
        create: { userId: ctx.user.id, date: input.date, source: 'MANUAL', content: input.content, mood: input.mood ?? null },
        update: { content: input.content, mood: input.mood ?? null },
      })
    }),

  /** Lịch sử gần đây của chính mình, để lướt lại và thấy chuỗi ngày. */
  recent: protectedProcedure
    .input(z.object({ days: z.number().int().min(7).max(120).default(30) }).default({}))
    .query(async ({ ctx, input }) => {
      const to = vnToday()
      const from = addDays(to, -(input.days - 1))
      const entries = await db.diaryEntry.findMany({
        where: { userId: ctx.user.id, date: { gte: from, lte: to } },
        orderBy: { date: 'desc' },
      })
      const manualByDate = new Map(entries.filter((e) => e.source === 'MANUAL').map((e) => [e.date, e]))

      // chuỗi ngày viết liên tiếp, tính ngược từ hôm nay;
      // hôm nay chưa viết thì chưa coi là đứt
      let streak = 0
      let cursor = to
      for (let i = 0; i < input.days; i++) {
        if (manualByDate.has(cursor)) streak++
        else if (cursor !== to) break
        cursor = addDays(cursor, -1)
      }

      return {
        from,
        to,
        streak,
        written: manualByDate.size,
        days: dateRange(from, to)
          .reverse()
          .map((date) => {
            const m = manualByDate.get(date)
            return {
              date,
              mood: m?.mood ?? null,
              preview: m ? m.content.slice(0, 120) : null,
              length: m?.content.length ?? 0,
            }
          }),
      }
    }),

  /** Bảng theo dõi cho phụ huynh: ai đã viết ngày nào (không lộ nội dung). */
  familyOverview: protectedProcedure
    .input(z.object({ days: z.number().int().min(7).max(60).default(14) }).default({}))
    .query(async ({ ctx }) => {
      if (ctx.user.role !== 'PARENT') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ phụ huynh xem được' })
      }
      const to = vnToday()
      const from = addDays(to, -13)
      const members = await db.user.findMany({
        where: { familyId: ctx.user.familyId, active: true },
        select: { id: true, name: true, avatarColor: true, role: true, diaryPrivate: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      })
      const entries = await db.diaryEntry.findMany({
        where: { userId: { in: members.map((m) => m.id) }, source: 'MANUAL', date: { gte: from, lte: to } },
        select: { userId: true, date: true, content: true },
      })
      const key = (u: string, d: string) => `${u}|${d}`
      const map = new Map(entries.map((e) => [key(e.userId, e.date), e.content.length]))

      return {
        from,
        to,
        dates: dateRange(from, to),
        members: members.map((m) => ({
          ...m,
          days: dateRange(from, to).map((date) => ({
            date,
            written: map.has(key(m.id, date)),
            length: map.get(key(m.id, date)) ?? 0,
          })),
        })),
      }
    }),

  /** Bật/tắt riêng tư — CHỈ chính chủ đổi được, phụ huynh không ép con mở. */
  setPrivate: protectedProcedure
    .input(z.object({ diaryPrivate: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db.user.update({ where: { id: ctx.user.id }, data: { diaryPrivate: input.diaryPrivate } })
      return { ok: true }
    }),

  /** Giờ nhận tổng kết cuối ngày; null = tắt. */
  setDigest: protectedProcedure
    .input(z.object({ at: timeSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await db.user.update({ where: { id: ctx.user.id }, data: { dailyDigestAt: input.at } })
      if (input.at === null) {
        await db.notification.deleteMany({
          where: { userId: ctx.user.id, kind: 'DAILY_DIGEST', status: 'PENDING' },
        })
      } else {
        const { materializeDigests } = await import('../../diary/digest.js')
        await db.notification.deleteMany({
          where: { userId: ctx.user.id, kind: 'DAILY_DIGEST', status: 'PENDING' },
        })
        await materializeDigests()
      }
      return { ok: true }
    }),

  settings: protectedProcedure.query(async ({ ctx }) => {
    const me = await db.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { diaryPrivate: true, dailyDigestAt: true, role: true },
    })
    return me
  }),
})
