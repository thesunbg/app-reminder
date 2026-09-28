/**
 * Lễ tết Việt Nam — chỉ đọc. Không có mutation nào vì danh mục là dựng sẵn,
 * không ai sửa được (muốn một ngày riêng của nhà thì thêm Sự kiện).
 *
 * Quy đổi chạy ở server để một thuật toán âm lịch duy nhất quyết định mọi ngày
 * trong app, giống hệt lý do `event.calendar` trả sẵn ngày âm cho client.
 */
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { holidayDayMap, holidaysBetween, type HolidayOccurrence } from '../../lib/holidays.js'
import { addDays, diffDays, vnToday } from '../../lib/time.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Dạng phẳng cho client: bỏ object `holiday` lồng nhau đi cho gọn. */
function flatten(o: HolidayOccurrence) {
  return {
    id: o.holiday.id,
    title: o.holiday.title,
    category: o.holiday.category,
    calendar: o.holiday.calendar,
    dayOff: Boolean(o.holiday.dayOff),
    note: o.holiday.note ?? null,
    startDate: o.startDate,
    endDate: o.endDate,
    dayCount: o.dayCount,
    lunar: o.lunar,
  }
}

export type HolidayDTO = ReturnType<typeof flatten>

export const holidayRouter = router({
  /** Các ngày lễ chạm vào khoảng [from..to], kể cả lễ bắt đầu trước `from`. */
  range: protectedProcedure
    .input(z.object({ from: dateSchema, to: dateSchema }))
    .query(({ input }) => {
      // quy đổi không đụng DB nên cho phép cả năm; chặn ở 2 năm để một request
      // hỏng không kéo theo vài nghìn phép tính âm lịch
      if (diffDays(input.from, input.to) > 800) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tối đa 2 năm' })
      }
      return holidaysBetween(input.from, input.to).map(flatten)
    }),

  /**
   * Lễ rơi vào đúng một ngày, kèm "ngày thứ mấy" — lễ nhiều ngày (Tết, Giáng
   * sinh) phải hiện cả ở ngày giữa chứ không riêng ngày bắt đầu.
   */
  on: protectedProcedure
    .input(z.object({ date: dateSchema }))
    .query(({ input }) =>
      (holidayDayMap(input.date, input.date).get(input.date) ?? []).map((o) => ({
        ...flatten(o),
        dayIndex: o.dayIndex,
      })),
    ),

  /** Cả năm dương, dùng cho trang danh sách "Lễ tết trong năm". */
  year: protectedProcedure
    .input(z.object({ year: z.number().int().min(1900).max(2199) }))
    .query(({ input }) => holidaysBetween(`${input.year}-01-01`, `${input.year}-12-31`).map(flatten)),

  /**
   * Lễ sắp tới, kèm số ngày còn lại. Lễ ĐANG diễn ra (Tết hôm nay mùng 2) vẫn
   * nằm trong danh sách — giống cách `event.upcoming` giữ sự kiện nhiều ngày.
   */
  upcoming: protectedProcedure
    .input(
      z
        .object({
          days: z.number().int().min(0).max(400).default(120),
          limit: z.number().int().min(1).max(50).default(8),
        })
        .default({}),
    )
    .query(({ input }) => {
      const today = vnToday()
      return holidaysBetween(today, addDays(today, input.days))
        .map((o) => ({
          ...flatten(o),
          daysUntil: diffDays(today, o.startDate),
          ongoing: o.startDate <= today,
          dayIndex: o.startDate <= today ? diffDays(o.startDate, today) + 1 : 1,
        }))
        .slice(0, input.limit)
    }),
})
