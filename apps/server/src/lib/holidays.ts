/**
 * Lễ tết Việt Nam — danh mục dựng sẵn, KHÔNG lưu trong DB.
 *
 * Vì sao không seed thành `Event`: ngày lễ là của chung, năm nào cũng có và
 * không nhà nào sửa. Nếu chép vào bảng Event thì mỗi gia đình lại có một bản
 * sao, phải viết migration để thêm lễ mới, và danh sách sự kiện của nhà sẽ bị
 * hai chục dòng không phải của mình làm loãng. Ở đây chỉ có một danh mục duy
 * nhất, quy đổi tại chỗ cho bất kỳ năm nào — kể cả năm 2100.
 *
 * Ngày âm lịch đi qua đúng thuật toán trong `lunar.ts` (Hồ Ngọc Đức, UTC+7),
 * nên Tết trên lịch, Tết trong thông báo và ngày giỗ của nhà luôn cùng một
 * nguồn sự thật.
 */
import { addDays, diffDays } from './time.js'
import { lunarOf, resolveLunarAnniversary } from './lunar.js'

export type HolidayCategory =
  /** nghỉ lễ chính thức theo Bộ luật Lao động */
  | 'PUBLIC'
  /** lễ tết cổ truyền, phần lớn theo âm lịch */
  | 'TRADITIONAL'
  /** ngày kỷ niệm, vẫn đi làm đi học */
  | 'OBSERVANCE'

export type Holiday = {
  id: string
  title: string
  calendar: 'SOLAR' | 'LUNAR'
  /** tháng/ngày theo đúng loại lịch ở trên */
  month: number
  day: number
  /** số ngày kéo dài, mặc định 1 */
  days?: number
  category: HolidayCategory
  /** được nghỉ làm, nghỉ học */
  dayOff?: boolean
  /**
   * Có bắn thông báo không (khi người dùng bật "nhắc ngày lễ").
   * Ngày kỷ niệm không có việc gì phải chuẩn bị thì chỉ hiện trên lịch.
   */
  remind?: boolean
  /** số ngày nhắc trước, mặc định NHẮC_MẶC_ĐỊNH */
  remindBefore?: number[]
  note?: string
}

/** Trước một hôm và đúng sáng hôm đó — đủ cho phần lớn ngày lễ. */
const DEFAULT_REMIND_BEFORE = [1, 0]

/**
 * Danh mục. Thứ tự trong mảng không quan trọng — mọi hàm bên dưới đều sắp lại
 * theo ngày dương đã quy đổi.
 *
 * Ngày nghỉ lễ lấy theo Điều 112 Bộ luật Lao động 2019. Riêng Tết Nguyên Đán
 * và Quốc khánh, luật cho nghỉ nhiều hơn số ngày ghi ở đây nhưng ngày cụ thể
 * do Chính phủ chốt lại mỗi năm, nên chỗ này chỉ ghi phần cố định và nói rõ
 * trong `note`.
 */
export const HOLIDAYS: Holiday[] = [
  // ---------- nghỉ lễ chính thức ----------
  {
    id: 'tet-duong-lich',
    title: 'Tết Dương lịch',
    calendar: 'SOLAR', month: 1, day: 1,
    category: 'PUBLIC', dayOff: true, remind: true,
  },
  {
    id: 'tet-nguyen-dan',
    title: 'Tết Nguyên Đán',
    calendar: 'LUNAR', month: 1, day: 1, days: 3,
    category: 'PUBLIC', dayOff: true, remind: true, remindBefore: [14, 7, 3, 1, 0],
    note: 'Ba ngày Tết (mùng 1–3). Lịch nghỉ chính thức 5 ngày do Chính phủ chốt mỗi năm.',
  },
  {
    id: 'gio-to-hung-vuong',
    title: 'Giỗ Tổ Hùng Vương',
    calendar: 'LUNAR', month: 3, day: 10,
    category: 'PUBLIC', dayOff: true, remind: true, remindBefore: [3, 1, 0],
  },
  {
    id: 'giai-phong-mien-nam',
    title: 'Ngày Giải phóng miền Nam',
    calendar: 'SOLAR', month: 4, day: 30,
    category: 'PUBLIC', dayOff: true, remind: true, remindBefore: [3, 1, 0],
  },
  {
    id: 'quoc-te-lao-dong',
    title: 'Ngày Quốc tế Lao động',
    calendar: 'SOLAR', month: 5, day: 1,
    category: 'PUBLIC', dayOff: true, remind: true,
  },
  {
    id: 'quoc-khanh',
    title: 'Quốc khánh',
    calendar: 'SOLAR', month: 9, day: 2,
    category: 'PUBLIC', dayOff: true, remind: true, remindBefore: [3, 1, 0],
    note: 'Nghỉ 2 ngày: 2/9 và một ngày liền kề do Chính phủ chốt mỗi năm.',
  },

  // ---------- lễ tết cổ truyền ----------
  {
    id: 'ong-cong-ong-tao',
    title: 'Tết Ông Công Ông Táo',
    calendar: 'LUNAR', month: 12, day: 23,
    category: 'TRADITIONAL', remind: true, remindBefore: [3, 1, 0],
    note: 'Cúng tiễn Táo quân về trời, thả cá chép.',
  },
  {
    id: 'tat-nien',
    title: 'Tất niên — Giao thừa',
    calendar: 'LUNAR', month: 12, day: 30,
    category: 'TRADITIONAL', remind: true, remindBefore: [3, 1, 0],
    note: 'Ngày cuối tháng Chạp; tháng Chạp thiếu thì rơi vào 29 âm.',
  },
  {
    id: 'tet-nguyen-tieu',
    title: 'Rằm tháng Giêng (Tết Nguyên Tiêu)',
    calendar: 'LUNAR', month: 1, day: 15,
    category: 'TRADITIONAL', remind: true,
    note: '"Cúng cả năm không bằng Rằm tháng Giêng".',
  },
  {
    id: 'tet-han-thuc',
    title: 'Tết Hàn thực',
    calendar: 'LUNAR', month: 3, day: 3,
    category: 'TRADITIONAL', remind: true,
    note: 'Làm bánh trôi, bánh chay.',
  },
  {
    id: 'le-phat-dan',
    title: 'Lễ Phật Đản',
    calendar: 'LUNAR', month: 4, day: 15,
    category: 'TRADITIONAL', remind: true,
  },
  {
    id: 'tet-doan-ngo',
    title: 'Tết Đoan Ngọ',
    calendar: 'LUNAR', month: 5, day: 5,
    category: 'TRADITIONAL', remind: true,
    note: 'Tết "giết sâu bọ" — ăn rượu nếp, hoa quả chua.',
  },
  {
    id: 'le-vu-lan',
    title: 'Lễ Vu Lan (Rằm tháng Bảy)',
    calendar: 'LUNAR', month: 7, day: 15,
    category: 'TRADITIONAL', remind: true, remindBefore: [3, 1, 0],
    note: 'Báo hiếu cha mẹ, cúng cô hồn.',
  },
  {
    id: 'tet-trung-thu',
    title: 'Tết Trung Thu',
    calendar: 'LUNAR', month: 8, day: 15,
    category: 'TRADITIONAL', remind: true, remindBefore: [7, 3, 1, 0],
    note: 'Tết thiếu nhi: đèn ông sao, bánh nướng bánh dẻo, phá cỗ trông trăng.',
  },
  {
    id: 'tet-trung-cuu',
    title: 'Tết Trùng Cửu',
    calendar: 'LUNAR', month: 9, day: 9,
    category: 'TRADITIONAL',
  },
  {
    id: 'tet-ha-nguyen',
    title: 'Tết Hạ Nguyên (Rằm tháng Mười)',
    calendar: 'LUNAR', month: 10, day: 15,
    category: 'TRADITIONAL',
    note: 'Mừng lúa mới, cúng tổ tiên.',
  },

  // ---------- ngày kỷ niệm ----------
  {
    id: 'thanh-lap-dang',
    title: 'Thành lập Đảng Cộng sản Việt Nam',
    calendar: 'SOLAR', month: 2, day: 3, category: 'OBSERVANCE',
  },
  {
    id: 'valentine',
    title: 'Lễ tình nhân (Valentine)',
    calendar: 'SOLAR', month: 2, day: 14, category: 'OBSERVANCE',
  },
  {
    id: 'thay-thuoc',
    title: 'Ngày Thầy thuốc Việt Nam',
    calendar: 'SOLAR', month: 2, day: 27, category: 'OBSERVANCE',
  },
  {
    id: 'quoc-te-phu-nu',
    title: 'Ngày Quốc tế Phụ nữ',
    calendar: 'SOLAR', month: 3, day: 8,
    category: 'OBSERVANCE', remind: true, remindBefore: [3, 1, 0],
  },
  {
    id: 'thanh-lap-doan',
    title: 'Thành lập Đoàn TNCS Hồ Chí Minh',
    calendar: 'SOLAR', month: 3, day: 26, category: 'OBSERVANCE',
  },
  {
    id: 'chien-thang-dien-bien-phu',
    title: 'Chiến thắng Điện Biên Phủ',
    calendar: 'SOLAR', month: 5, day: 7, category: 'OBSERVANCE',
  },
  {
    id: 'sinh-nhat-bac',
    title: 'Ngày sinh Chủ tịch Hồ Chí Minh',
    calendar: 'SOLAR', month: 5, day: 19, category: 'OBSERVANCE',
  },
  {
    id: 'quoc-te-thieu-nhi',
    title: 'Ngày Quốc tế Thiếu nhi',
    calendar: 'SOLAR', month: 6, day: 1,
    category: 'OBSERVANCE', remind: true, remindBefore: [3, 1, 0],
  },
  {
    id: 'bao-chi-cach-mang',
    title: 'Ngày Báo chí Cách mạng Việt Nam',
    calendar: 'SOLAR', month: 6, day: 21, category: 'OBSERVANCE',
  },
  {
    id: 'gia-dinh-viet-nam',
    title: 'Ngày Gia đình Việt Nam',
    calendar: 'SOLAR', month: 6, day: 28,
    category: 'OBSERVANCE', remind: true,
  },
  {
    id: 'thuong-binh-liet-si',
    title: 'Ngày Thương binh Liệt sĩ',
    calendar: 'SOLAR', month: 7, day: 27, category: 'OBSERVANCE',
  },
  {
    id: 'cach-mang-thang-tam',
    title: 'Ngày Cách mạng Tháng Tám',
    calendar: 'SOLAR', month: 8, day: 19, category: 'OBSERVANCE',
  },
  {
    id: 'giai-phong-thu-do',
    title: 'Ngày Giải phóng Thủ đô',
    calendar: 'SOLAR', month: 10, day: 10, category: 'OBSERVANCE',
  },
  {
    id: 'phu-nu-viet-nam',
    title: 'Ngày Phụ nữ Việt Nam',
    calendar: 'SOLAR', month: 10, day: 20,
    category: 'OBSERVANCE', remind: true, remindBefore: [3, 1, 0],
  },
  {
    id: 'nha-giao-viet-nam',
    title: 'Ngày Nhà giáo Việt Nam',
    calendar: 'SOLAR', month: 11, day: 20,
    category: 'OBSERVANCE', remind: true, remindBefore: [7, 3, 1, 0],
  },
  {
    id: 'quan-doi-nhan-dan',
    title: 'Thành lập Quân đội nhân dân Việt Nam',
    calendar: 'SOLAR', month: 12, day: 22, category: 'OBSERVANCE',
  },
  {
    id: 'giang-sinh',
    title: 'Giáng sinh',
    calendar: 'SOLAR', month: 12, day: 24, days: 2,
    category: 'OBSERVANCE', remind: true, remindBefore: [3, 1, 0],
    note: 'Đêm Giáng sinh 24/12 và ngày 25/12.',
  },
]

const BY_ID = new Map(HOLIDAYS.map((h) => [h.id, h]))

/** Tra một ngày lễ theo id, null nếu id không còn trong danh mục. */
export function holidayById(id: string): Holiday | null {
  return BY_ID.get(id) ?? null
}

/** Số ngày nhắc trước của một ngày lễ (đã sắp giảm dần, bỏ trùng). */
export function remindOffsets(h: Holiday): number[] {
  const raw = h.remindBefore ?? DEFAULT_REMIND_BEFORE
  return [...new Set(raw)].filter((d) => d >= 0).sort((a, b) => b - a)
}

export type HolidayOccurrence = {
  holiday: Holiday
  /** ngày dương bắt đầu, "YYYY-MM-DD" */
  startDate: string
  /** ngày dương kết thúc; null khi lễ gói trong một ngày */
  endDate: string | null
  /** số ngày kéo dài (1 nếu một ngày) */
  dayCount: number
  /** ngày âm của ngày bắt đầu — Tết rơi vào mùng mấy thì nhìn là biết */
  lunar: { day: number; month: number; year: number; leap: boolean }
}

/** refId của thông báo: gói cả ngày để mỗi lần xuất hiện là một khoá riêng. */
export const holidayRef = (holidayId: string, solarDate: string) => `${holidayId}:${solarDate}`

/** Gắn "tháng/ngày" dương vào một năm; 29/2 ở năm không nhuận lùi về 28/2. */
function solarInYear(month: number, day: number, year: number): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const d = Math.min(day, daysInMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function occurrenceOf(h: Holiday, startDate: string): HolidayOccurrence {
  const dayCount = h.days ?? 1
  const l = lunarOf(startDate)
  return {
    holiday: h,
    startDate,
    endDate: dayCount > 1 ? addDays(startDate, dayCount - 1) : null,
    dayCount,
    lunar: { day: l.day, month: l.month, year: l.year, leap: l.leap },
  }
}

/**
 * Mọi lần lễ CHẠM vào khoảng [from..to] — kể cả lễ bắt đầu trước `from` mà còn
 * kéo dài sang (Tết mùng 1 rơi vào 31/1 thì tháng 2 vẫn phải thấy mùng 2, 3).
 *
 * Năm âm được quét rộng ra hai bên vì lễ tháng Chạp của năm âm trước rơi vào
 * đầu năm dương sau (Ông Táo 23/12 âm năm Ất Tỵ là 10/2/2026 dương).
 */
export function holidaysBetween(from: string, to: string): HolidayOccurrence[] {
  if (diffDays(from, to) < 0) return []
  const out: HolidayOccurrence[] = []

  const solarFrom = Number(from.slice(0, 4))
  const solarTo = Number(to.slice(0, 4))
  const lunarFrom = lunarOf(from).year - 1
  const lunarTo = lunarOf(to).year + 1

  for (const h of HOLIDAYS) {
    const years =
      h.calendar === 'SOLAR'
        ? range(solarFrom - 1, solarTo + 1) // lễ vắt qua giao thừa (24–25/12)
        : range(lunarFrom, lunarTo)

    for (const year of years) {
      const start =
        h.calendar === 'SOLAR'
          ? solarInYear(h.month, h.day, year)
          : resolveLunarAnniversary(h.day, h.month, false, year)
      if (!start) continue
      const occ = occurrenceOf(h, start)
      const end = occ.endDate ?? occ.startDate
      if (end < from || occ.startDate > to) continue
      out.push(occ)
    }
  }

  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.holiday.id.localeCompare(b.holiday.id))
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let y = from; y <= to; y++) out.push(y)
  return out
}

/** Các ngày lễ rơi vào đúng `date` (kể cả ngày giữa của lễ nhiều ngày). */
export function holidaysOn(date: string): HolidayOccurrence[] {
  return holidaysBetween(date, date)
}

/**
 * Trải các lần lễ ra theo từng ngày trong [from..to] — đúng dạng lưới lịch cần.
 * `dayIndex` là ngày thứ mấy trong lễ (1-based), giống hệt quy ước của sự kiện
 * nhiều ngày để client dùng chung một cách vẽ.
 */
export function holidayDayMap(
  from: string,
  to: string,
): Map<string, Array<HolidayOccurrence & { dayIndex: number }>> {
  const map = new Map<string, Array<HolidayOccurrence & { dayIndex: number }>>()
  for (const occ of holidaysBetween(from, to)) {
    for (let i = 0; i < occ.dayCount; i++) {
      const date = addDays(occ.startDate, i)
      if (date < from || date > to) continue
      map.set(date, [...(map.get(date) ?? []), { ...occ, dayIndex: i + 1 }])
    }
  }
  return map
}
