import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { lunarMonthLength, lunarOf, lunarToSolar, toSolarString } from '../../lib/lunar.js'
import { addDays, dateRange, diffDays, vnToday } from '../../lib/time.js'
import {
  clearEventNotifications,
  materializeEventOccurrences,
  materializeEvents,
  resolveLunarAnniversary,
} from '../../notifications/events.js'
import { protectedProcedure, router } from '../trpc.js'

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const baseInput = z.object({
  title: z.string().trim().min(1).max(120),
  type: z.enum(['DEATH_ANNIVERSARY', 'BIRTHDAY', 'OTHER']).default('OTHER'),
  remindBeforeDays: z.array(z.number().int().min(0).max(60)).min(1).max(6).default([7, 3, 1, 0]),
  remindAtTime: timeSchema.default('08:00'),
  note: z.string().trim().max(500).nullish(),
  // giờ sự kiện thật sự diễn ra, khác remindAtTime (giờ bắn nhắc)
  startTime: timeSchema.nullish(),
  endTime: timeSchema.nullish(),
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
  /// Ngày kết thúc cho sự kiện nhiều ngày; cùng dạng với solarDate.
  endDate: z.string().regex(/^(\d{4}-)?\d{2}-\d{2}$/).nullish(),
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
    return {
      ...common, calendar, lunarDay, lunarMonth, lunarLeap,
      solarDate: null, yearly: true, endDate: null,
    }
  }
  const { calendar, solarDate, yearly, endDate, ...common } = input
  return {
    ...common, calendar, solarDate, yearly,
    // ngày kết thúc trùng ngày bắt đầu thì đây là sự kiện một ngày
    endDate: endDate && endDate !== solarDate ? endDate : null,
    lunarDay: null, lunarMonth: null, lunarLeap: false,
  }
}

/**
 * Occurrence nào CHẠM vào khoảng [from..to] — không chỉ những cái bắt đầu trong
 * khoảng. Một chuyến đi 28/9 → 3/10 phải hiện cả ở lưới tháng 10.
 * endDate = null nghĩa là sự kiện một ngày, khi đó chính solarDate phải nằm trong khoảng.
 */
function overlapWhere(from: string, to: string) {
  return {
    solarDate: { lte: to },
    OR: [{ endDate: { gte: from } }, { endDate: null, solarDate: { gte: from } }],
  }
}

async function calendarRange(familyId: string, from: string, to: string) {
  const rows = await db.eventOccurrence.findMany({
    where: { ...overlapWhere(from, to), event: { familyId } },
    include: { event: true },
    orderBy: { solarDate: 'asc' },
  })

  // trải mỗi occurrence ra mọi ngày nó phủ, cắt theo khoảng đang xem
  const byDate = new Map<string, Array<{ occ: typeof rows[number]; dayIndex: number; dayCount: number }>>()
  for (const o of rows) {
    const end = o.endDate ?? o.solarDate
    const dayCount = diffDays(o.solarDate, end) + 1
    const visibleFrom = o.solarDate < from ? from : o.solarDate
    const visibleTo = end > to ? to : end
    for (const date of dateRange(visibleFrom, visibleTo)) {
      const entry = { occ: o, dayIndex: diffDays(o.solarDate, date) + 1, dayCount }
      byDate.set(date, [...(byDate.get(date) ?? []), entry])
    }
  }

  return dateRange(from, to).map((date) => {
    const l = lunarOf(date)
    return {
      date,
      lunar: { day: l.day, month: l.month, year: l.year, leap: l.leap },
      events: (byDate.get(date) ?? []).map(({ occ: o, dayIndex, dayCount }) => ({
        occurrenceId: o.id,
        id: o.event.id,
        title: o.event.title,
        type: o.event.type,
        calendar: o.event.calendar,
        note: o.event.note,
        startDate: o.solarDate,
        endDate: o.endDate,
        startTime: o.event.startTime,
        endTime: o.event.endTime,
        /// ngày thứ mấy trong sự kiện (1-based) và tổng số ngày — để UI nói "ngày 2/3"
        dayIndex,
        dayCount,
      })),
    }
  })
}

async function assertInFamily(familyId: string, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId } })
  if (!event || event.familyId !== familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy sự kiện' })
  }
  return event
}

/**
 * Sinh nhật tự sinh từ ngày sinh thành viên thì sửa ở Cài đặt, không sửa ở đây.
 * Cho sửa cả hai chỗ thì hai nơi sẽ lệch nhau ngay lần đầu ai đó sửa nhầm chỗ.
 */
function assertNotBirthday(event: { birthdayUserId: string | null }) {
  if (event.birthdayUserId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Đây là sinh nhật lấy từ hồ sơ thành viên — sửa ngày sinh trong Cài đặt → Gia đình',
    })
  }
}

/**
 * Ngày kết thúc phải sau ngày bắt đầu.
 *
 * Sự kiện lặp hàng năm được phép vắt qua giao thừa (28/12 → 2/1), khi đó chuỗi
 * "MM-DD" của ngày kết thúc nhỏ hơn — hợp lệ. Sự kiện một lần thì không, vì nó
 * mang năm cụ thể nên "nhỏ hơn" chỉ có thể là nhập sai.
 */
function assertRange(input: z.infer<typeof createInput>) {
  if (input.calendar !== 'SOLAR' || !input.endDate) return
  if (input.endDate === input.solarDate) return // sẽ được chuẩn hoá thành null
  const sameShape = input.endDate.length === input.solarDate.length
  if (!sameShape) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Ngày bắt đầu và ngày kết thúc phải cùng dạng (cùng có năm hoặc cùng không)',
    })
  }
  if (!input.yearly && input.endDate < input.solarDate) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ngày kết thúc phải sau ngày bắt đầu' })
  }
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
      // sự kiện đang diễn ra (bắt đầu hôm qua, kết thúc mai) vẫn là lần tới gần nhất
      const next = e.occurrences.find((o) => (o.endDate ?? o.solarDate) >= today)
      return {
        ...e,
        occurrences: undefined,
        nextDate: next?.solarDate ?? null,
        nextEndDate: next?.endDate ?? null,
        daysUntil: next ? diffDays(today, next.solarDate) : null,
        ongoing: next ? next.solarDate <= today : false,
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
        where: { ...overlapWhere(today, until), event: { familyId: ctx.user.familyId } },
        orderBy: { solarDate: 'asc' },
        include: { event: true },
      })
      return rows.map((o) => ({
        id: o.id,
        eventId: o.eventId,
        solarDate: o.solarDate,
        endDate: o.endDate,
        // âm nếu sự kiện đã bắt đầu; dùng kèm `ongoing` chứ đừng in trực tiếp
        daysUntil: diffDays(today, o.solarDate),
        ongoing: o.solarDate <= today,
        dayIndex: o.solarDate <= today ? diffDays(o.solarDate, today) + 1 : 1,
        dayCount: diffDays(o.solarDate, o.endDate ?? o.solarDate) + 1,
        lunar: o.event.calendar === 'LUNAR' ? lunarOf(o.solarDate) : null,
        event: o.event,
      }))
    }),

  /**
   * Lịch tháng dương: từng ngày kèm ngày âm + các sự kiện rơi vào ngày đó.
   * Client vẽ lưới; server chỉ lo quy đổi âm lịch để một thuật toán duy nhất
   * (Hồ Ngọc Đức, UTC+7) quyết định mọi ngày âm trong app.
   */
  calendar: protectedProcedure
    .input(z.object({ from: dateSchema, to: dateSchema }))
    .query(async ({ ctx, input }) => {
      if (diffDays(input.from, input.to) > 62) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tối đa 2 tháng' })
      return calendarRange(ctx.user.familyId, input.from, input.to)
    }),

  /** Lịch một tháng ÂM: ngày 1 → cuối tháng, mỗi ngày kèm ngày dương tương ứng. */
  lunarCalendar: protectedProcedure
    .input(z.object({ year: z.number().int().min(1900).max(2199), month: z.number().int().min(1).max(12), leap: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const len = lunarMonthLength(input.month, input.year, input.leap)
      if (len === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tháng âm không tồn tại (không có tháng nhuận này)' })
      const first = lunarToSolar(1, input.month, input.year, input.leap)!
      const from = toSolarString(first)
      const to = addDays(from, len - 1)
      const days = await calendarRange(ctx.user.familyId, from, to)
      // tháng âm kế/trước để điều hướng — tháng nhuận nằm giữa nên phải dò
      const prev = lunarOf(addDays(from, -1))
      const next = lunarOf(addDays(to, 1))
      return { from, to, length: len, days, prev: { year: prev.year, month: prev.month, leap: prev.leap }, next: { year: next.year, month: next.month, leap: next.leap } }
    }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    assertResolvable(input)
    assertRange(input)
    const created = await db.event.create({
      data: { ...toData(input), familyId: ctx.user.familyId },
    })
    await refresh()
    return created
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input
    assertNotBirthday(await assertInFamily(ctx.user.familyId, id))
    assertResolvable(rest)
    assertRange(rest)
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
      assertNotBirthday(await assertInFamily(ctx.user.familyId, input.id))
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
