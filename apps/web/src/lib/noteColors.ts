export const NOTE_COLORS = [
  'default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray',
] as const

export type NoteColor = (typeof NOTE_COLORS)[number]

export const COLOR_LABEL: Record<NoteColor, string> = {
  default: 'Mặc định', red: 'Đỏ', orange: 'Cam', yellow: 'Vàng', green: 'Xanh lá',
  teal: 'Xanh ngọc', blue: 'Xanh dương', purple: 'Tím', pink: 'Hồng', gray: 'Xám',
}

/** Nền của ghi chú. Biến CSS tự đảo giá trị theo sáng/tối, chữ vẫn dùng --text. */
export function noteBackground(color: string): string {
  return NOTE_COLORS.includes(color as NoteColor) ? `var(--note-${color})` : 'var(--surface)'
}
