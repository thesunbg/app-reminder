export function minutesText(min: number): string {
  if (min < 60) return `${min} phút`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`
}
