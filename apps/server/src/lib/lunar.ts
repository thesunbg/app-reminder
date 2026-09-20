/**
 * Âm lịch Việt Nam — thuật toán của Hồ Ngọc Đức.
 *
 * QUAN TRỌNG: âm lịch Việt Nam tính theo múi giờ UTC+7, âm lịch Trung Quốc
 * theo UTC+8. Có những năm hai lịch lệch nhau cả ngày lẫn tháng nhuận, nên
 * KHÔNG được thay file này bằng thư viện lunar-calendar của Trung Quốc —
 * ngày giỗ sẽ sai.
 *
 * Tham chiếu: https://www.informatik.uni-leipzig.de/~duc/amlich/
 */

/** Múi giờ dùng để tính âm lịch Việt Nam. */
export const VN_TIMEZONE = 7

const PI = Math.PI
const int = (x: number): number => Math.floor(x)

/** Số ngày Julian của một ngày dương lịch (lịch Gregory, lùi về Julius trước 15/10/1582). */
export function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = int((14 - mm) / 12)
  const y = yy + 4800 - a
  const m = mm + 12 * a - 3
  let jd = dd + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - int(y / 100) + int(y / 400) - 32045
  if (jd < 2299161) {
    jd = dd + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - 32083
  }
  return jd
}

/** Ngược lại: số ngày Julian → [ngày, tháng, năm] dương lịch. */
export function jdToDate(jd: number): [number, number, number] {
  let b: number
  let c: number
  if (jd > 2299160) {
    const a = jd + 32044
    b = int((4 * a + 3) / 146097)
    c = a - int((b * 146097) / 4)
  } else {
    b = 0
    c = jd + 32082
  }
  const d = int((4 * c + 3) / 1461)
  const e = c - int((1461 * d) / 4)
  const m = int((5 * e + 2) / 153)
  const day = e - int((153 * m + 2) / 5) + 1
  const month = m + 3 - 12 * int(m / 10)
  const year = b * 100 + d - 4800 + int(m / 10)
  return [day, month, year]
}

/** Thời điểm sóc (trăng mới) thứ k tính từ 1/1/1900, theo ngày Julian. */
function newMoon(k: number): number {
  const T = k / 1236.85
  const T2 = T * T
  const T3 = T2 * T
  const dr = PI / 180
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3
  jd1 = jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr)
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3

  let c1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M)
  c1 = c1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr)
  c1 = c1 - 0.0004 * Math.sin(dr * 3 * Mpr)
  c1 = c1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr))
  c1 = c1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M))
  c1 = c1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr))
  c1 = c1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M))

  const deltat =
    T < -11
      ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2

  return jd1 + c1 - deltat
}

/** Kinh độ mặt trời (radian) tại thời điểm jdn. */
function sunLongitudeRad(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525
  const T2 = T * T
  const dr = PI / 180
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M)
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M)
  let L = (L0 + DL) * dr
  L = L - PI * 2 * int(L / (PI * 2))
  return L
}

/** Vị trí mặt trời theo cung 30 độ (0..11) lúc nửa đêm giờ địa phương. */
function getSunLongitude(dayNumber: number, timeZone: number): number {
  return int((sunLongitudeRad(dayNumber - 0.5 - timeZone / 24) / PI) * 6)
}

/** Ngày (Julian) chứa điểm sóc thứ k, theo giờ địa phương. */
function getNewMoonDay(k: number, timeZone: number): number {
  return int(newMoon(k) + 0.5 + timeZone / 24)
}

/** Ngày bắt đầu tháng 11 âm lịch của năm dương yy. */
function getLunarMonth11(yy: number, timeZone: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021
  const k = int(off / 29.530588853)
  let nm = getNewMoonDay(k, timeZone)
  const sunLong = getSunLongitude(nm, timeZone)
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone)
  }
  return nm
}

/** Tháng nhuận nằm cách tháng 11 bao nhiêu tháng. */
function getLeapMonthOffset(a11: number, timeZone: number): number {
  const k = int((a11 - 2415021.076998695) / 29.530588853 + 0.5)
  let last = 0
  let i = 1
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone)
  do {
    last = arc
    i++
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone)
  } while (arc !== last && i < 14)
  return i - 1
}

export type LunarDate = {
  day: number
  month: number
  year: number
  /** true nếu đây là tháng nhuận */
  leap: boolean
}

export type SolarDate = { day: number; month: number; year: number }

/** Dương lịch → âm lịch. */
export function solarToLunar(
  dd: number,
  mm: number,
  yy: number,
  timeZone: number = VN_TIMEZONE,
): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy)
  const k = int((dayNumber - 2415021.076998695) / 29.530588853)
  let monthStart = getNewMoonDay(k + 1, timeZone)
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone)
  }

  let a11 = getLunarMonth11(yy, timeZone)
  let b11 = a11
  let lunarYear: number
  if (a11 >= monthStart) {
    lunarYear = yy
    a11 = getLunarMonth11(yy - 1, timeZone)
  } else {
    lunarYear = yy + 1
    b11 = getLunarMonth11(yy + 1, timeZone)
  }

  const lunarDay = dayNumber - monthStart + 1
  const diff = int((monthStart - a11) / 29)
  let leap = false
  let lunarMonth = diff + 11

  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone)
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10
      if (diff === leapMonthDiff) leap = true
    }
  }
  if (lunarMonth > 12) lunarMonth = lunarMonth - 12
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1

  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap }
}

/**
 * Âm lịch → dương lịch.
 * Trả về null nếu ngày âm đó không tồn tại (vd đòi tháng nhuận ở năm không nhuận).
 */
export function lunarToSolar(
  lunarDay: number,
  lunarMonth: number,
  lunarYear: number,
  lunarLeap: boolean,
  timeZone: number = VN_TIMEZONE,
): SolarDate | null {
  let a11: number
  let b11: number
  if (lunarMonth < 11) {
    a11 = getLunarMonth11(lunarYear - 1, timeZone)
    b11 = getLunarMonth11(lunarYear, timeZone)
  } else {
    a11 = getLunarMonth11(lunarYear, timeZone)
    b11 = getLunarMonth11(lunarYear + 1, timeZone)
  }

  let off = lunarMonth - 11
  if (off < 0) off += 12

  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, timeZone)
    let leapMonth = leapOff - 2
    if (leapMonth < 0) leapMonth += 12
    if (lunarLeap && lunarMonth !== leapMonth) return null
    if (lunarLeap || off >= leapOff) off += 1
  } else if (lunarLeap) {
    return null // năm này không có tháng nhuận
  }

  const k = int(0.5 + (a11 - 2415021.076998695) / 29.530588853)
  const monthStart = getNewMoonDay(k + off, timeZone)
  const [day, month, year] = jdToDate(monthStart + lunarDay - 1)
  return { day, month, year }
}

/** Số ngày của một tháng âm lịch (29 hoặc 30). */
export function lunarMonthLength(
  lunarMonth: number,
  lunarYear: number,
  lunarLeap: boolean,
  timeZone: number = VN_TIMEZONE,
): number {
  const first = lunarToSolar(1, lunarMonth, lunarYear, lunarLeap, timeZone)
  if (!first) return 0
  const start = jdFromDate(first.day, first.month, first.year)
  // ngày 30 tồn tại khi và chỉ khi nó vẫn thuộc tháng đó
  const probe = solarToLunar(...(jdToDate(start + 29) as [number, number, number]), timeZone)
  return probe.month === lunarMonth && probe.leap === lunarLeap ? 30 : 29
}

// ---------- tiện ích cho chuỗi "YYYY-MM-DD" ----------

const pad = (n: number) => String(n).padStart(2, '0')

export function toSolarString(d: SolarDate): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`
}

export function parseSolarString(s: string): SolarDate {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return { year: y, month: m, day: d }
}

/** Âm lịch của một ngày dương dạng "YYYY-MM-DD". */
export function lunarOf(solar: string, timeZone: number = VN_TIMEZONE): LunarDate {
  const { day, month, year } = parseSolarString(solar)
  return solarToLunar(day, month, year, timeZone)
}
