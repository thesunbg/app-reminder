/**
 * Cách hiển thị lễ tết Việt Nam. Danh mục nằm ở server
 * (`apps/server/src/lib/holidays.ts`); đây chỉ là màu và nhãn.
 */
export type HolidayCategory = 'PUBLIC' | 'TRADITIONAL' | 'OBSERVANCE'

export const HOLIDAY_META: Record<HolidayCategory, { icon: string; color: string; label: string }> = {
  // đỏ như chủ nhật trên lịch giấy: nhìn là biết được nghỉ
  PUBLIC: { icon: '🎉', color: '#dc2626', label: 'Nghỉ lễ' },
  TRADITIONAL: { icon: '🏮', color: '#ea580c', label: 'Lễ tết cổ truyền' },
  // không nghỉ thì cũng đừng tranh chỗ với việc thật: màu xám
  OBSERVANCE: { icon: '⭐', color: '#64748b', label: 'Ngày kỷ niệm' },
}

export function holidayMeta(category: string) {
  return HOLIDAY_META[category as HolidayCategory] ?? HOLIDAY_META.OBSERVANCE
}

/** "17/2 → 19/2" cho lễ nhiều ngày, "6/10" cho lễ một ngày. */
export function holidaySpan(startDate: string, endDate: string | null): string {
  const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`
  return endDate ? `${dm(startDate)} → ${dm(endDate)}` : dm(startDate)
}

/** "15/8 âm lịch" — chỉ có nghĩa với lễ tính theo âm lịch. */
export function lunarLabel(lunar: { day: number; month: number; leap: boolean }): string {
  return `${lunar.day}/${lunar.month}${lunar.leap ? ' nhuận' : ''} âm lịch`
}
