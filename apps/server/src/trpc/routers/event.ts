import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { lunarOf, lunarToSolar, toSolarString } from '../../lib/lunar.js'
import { addDays, diffDays, vnToday } from '../../lib/time.js'
import {
  clearEventNotifications,
  materializeEventOccurrences,
  materializeEvents,
  resolveLunarAnniversary,
} from '../../notifications/events.js'
import { protectedProcedure, router } from '../trpc.js'

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const baseInput = z.object({
  title: z.string().trim().min(1).max(120),
  type: z.enum(['DEATH_ANNIVERSARY', 'BIRTHDAY', 'OTHER']).default('OTHER'),
  remindBeforeDays: z.array(z.number().int().min(0).max(60)).min(1).max(6).default([7, 3, 1, 0]),
  remindAtTime: timeSchema.default('08:00'),
  note: z.string().trim().max(500).nullish(),
})

const lunarInput = baseInput.extend({
  calendar: z.literal('LUNAR'),
  lunarDay: z.number().int().min(1).max(30),
  lunarMonth: z.number().int().min(1).max(12),
  lunarLeap: z.boolean().default(false),
})

const solarInput = baseInput.extend({
  calendar: z.literal('SOLAR'),
  // "MM-DD" khi lặp hàng năm, "YYYY-MM-DD" khi chỉ một lần
  solarDate: z.string().regex(/^(\d{4}-)?\d{2}-\d{2}$/),
  yearly: z.boolean().default(true),
})

const createInput = z.discriminatedUnion('calendar', [lunarInput, solarInput])

const updateInput = z.discriminatedUnion('calendar', [
  lunarInput.extend({ id: z.string() }),
  solarInput.extend({ id: z.string() }),
])

/**
 * Chuyển payload đã validate thành dữ liệu ghi DB.
 * Xoá hẳn các trường của loại lịch kia: đổi sự kiện từ dương sang âm mà để
 * lại solarDate cũ thì lần sinh occurrence sau sẽ đọc nhầm.
 */
function toData(input: z.infer<typeof createInput>) {
  if (input.calendar === 'LUNAR') {
    const { calendar, lunarDay, lunarMonth, lunarLeap, ...common } = input
    return { ...common, calendar, lunarDay, lunarMonth, lunarLeap, solarDate: null, yearly: true }
  }
  const { calendar, solarDate, yearly, ...common } = input
  return { ...common, calendar, solarDate, yearly, lunarDay: null, lunarMonth: null, lunarLeap: false }
}

async function assertInFamily(familyId: string, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId } })
  if (!event || event.familyId !== familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy sự kiện' })
  }
  return event
}

/** Chặn ngay lúc lưu nếu ngày âm không quy đổi được — đừng để phát hiện lúc chạy nền. */
function assertResolvable(input: z.infer<typeof createInput>) {
  if (input.calendar !== 'LUNAR') return
  const thisYear = lunarOf(vnToday()).year
  const ok = resolveLunarAnniversary(input.lunarDay, input.lunarMonth, input.lunarLeap, thisYear)
  if (!ok) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ngày âm lịch không hợp lệ' })
}

/** Sinh lại cache occurrence + lịch nhắc sau mỗi thay đổi. */
async function refresh() {
  await materializeEventOccurrences()
  await materializeEvents()
}

export const eventRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const events = await db.event.findMany({
      where: { familyId: ctx.user.familyId },
      orderBy: { title: 'asc' },
      include: { occurrences: { orderBy: { solarDate: 'asc' } } },
    })
    const today = vnToday()
    return events.map((e) => {
      const next = e.occurrences.find((o) => o.solarDate >= today)
      return {
        ...e,
        occurrences: undefined,
        nextDate: next?.solarDate ?? null,
        daysUntil: next ? diffDays(today, next.solarDate) : null,
        nextLunar: next && e.calendar === 'LUNAR' ? lunarOf(next.solarDate) : null,
      }
    })
  }),

  /** Các sự kiện sắp tới trong N ngày, đã sắp theo ngày — dùng cho màn hình chính. */
  upcoming: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(400).default(120) }).default({}))
    .query(async ({ ctx, input }) => {
      const today = vnToday()
      const until = addDays(today, input.days)
      const rows = await db.eventOccurrence.findMany({
        where: {
          solarDate: { gte: today, lte: until },
          event: { familyId: ctx.user.familyId },
        },
        orderBy: { solarDate: 'asc' },
        include: { event: true },
      })
      return rows.map((o) => ({
        id: o.id,
        eventId: o.eventId,
        solarDate: o.solarDate,
        daysUntil: diffDays(today, o.solarDate),
        lunar: o.event.calendar === 'LUNAR' ? lunarOf(o.solarDate) : null,
        event: o.event,
      }))
    }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    assertResolvable(input)
    const created = await db.event.create({
      data: { ...toData(input), familyId: ctx.user.familyId },
    })
    await refresh()
    return created
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input
    await assertInFamily(ctx.user.familyId, id)
    assertResolvable(rest)
    const updated = await db.event.update({ where: { id }, data: toData(rest) })
    // ngày có thể đã đổi -> xoá lịch cũ rồi sinh lại từ đầu
    await clearEventNotifications(id)
    await db.eventOccurrence.deleteMany({ where: { eventId: id } })
    await refresh()
    return updated
  }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertInFamily(ctx.user.familyId, input.id)
      await clearEventNotifications(input.id)
      await db.event.delete({ where: { id: input.id } })
      return { ok: true }
    }),

  /** Xem trước: ngày âm này rơi vào ngày dương nào trong vài năm tới. */
  previewLunar: protectedProcedure
    .input(
      z.object({
        lunarDay: z.number().int().min(1).max(30),
        lunarMonth: z.number().int().min(1).max(12),
        lunarLeap: z.boolean().default(false),
        years: z.number().int().min(1).max(10).default(4),
      }),
    )
    .query(({ input }) => {
      const base = lunarOf(vnToday()).year
      const out: Array<{ lunarYear: number; solarDate: string | null; usedLeap: boolean; usedDay: number }> = []
      for (let i = 0; i < input.years; i++) {
        const y = base + i
        const canLeap = input.lunarLeap && lunarToSolar(1, input.lunarMonth, y, true) !== null
        const solar = lunarToSolar(input.lunarDay, input.lunarMonth, y, canLeap)
        // kiểm tra tràn tháng thiếu bằng cách quy đổi ngược
        let usedDay = input.lunarDay
        let solarDate: string | null = null
        if (solar) {
          const back = lunarOf(toSolarString(solar))
          if (back.day !== input.lunarDay) {
            const fallback = lunarToSolar(input.lunarDay - 1, input.lunarMonth, y, canLeap)
            usedDay = input.lunarDay - 1
            solarDate = fallback ? toSolarString(fallback) : null
          } else {
            solarDate = toSolarString(solar)
          }
        }
        out.push({ lunarYear: y, solarDate, usedLeap: canLeap, usedDay })
      }
      return out
    }),

  /** Đổi ngày dương sang âm — dùng khi người dùng chỉ nhớ ngày dương của đám giỗ. */
  toLunar: protectedProcedure
    .input(z.object({ solarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(({ input }) => lunarOf(input.solarDate)),
})
