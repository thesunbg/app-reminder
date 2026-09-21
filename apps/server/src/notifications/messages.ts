import type { NotificationKind } from '@prisma/client'
import { escapeHtml } from '../lib/telegram.js'
import { minutesText } from '../lib/text.js'

export type Draft = { title: string; body: string }

export function routineDraft(
  kind: Extract<NotificationKind, 'ROUTINE_UPCOMING' | 'ROUTINE_DUE' | 'ROUTINE_NAG'>,
  routine: { title: string; timeOfDay: string; durationMin: number },
  minutesAhead: number,
): Draft {
  const what = `${routine.title} · ${routine.timeOfDay} · ${minutesText(routine.durationMin)}`
  switch (kind) {
    case 'ROUTINE_UPCOMING':
      return { title: `Sắp đến giờ: ${routine.title}`, body: `Còn ${minutesText(minutesAhead)} nữa — ${what}` }
    case 'ROUTINE_DUE':
      return { title: `Đến giờ: ${routine.title}`, body: what }
    case 'ROUTINE_NAG':
      return { title: `Chưa tick: ${routine.title}`, body: `${what}\nBạn đã làm chưa? Vào app tick một cái cho xong.` }
  }
}

/** Telegram HTML: chỉ dùng <b>/<i>, phần còn lại escape hết. */
export function toTelegramHtml(d: Draft): string {
  return `<b>${escapeHtml(d.title)}</b>\n${escapeHtml(d.body)}`
}

/**
 * Bấm vào thông báo thì mở màn hình nào.
 *
 * Dùng chung cho cả push (server gửi kèm `data.url`) lẫn local notification
 * mà app tự đặt — hai đường phải dẫn tới cùng một chỗ, nếu không cùng một lời
 * nhắc sẽ mở khác nhau tuỳ hôm đó máy có mạng hay không.
 */
export function notificationUrl(n: { kind: NotificationKind; refTable: string }): string {
  if (n.kind === 'DAILY_DIGEST') return '/nhat-ky'
  if (n.refTable === 'note') return '/ghi-chu'
  if (n.refTable === 'event') return '/su-kien'
  if (n.refTable === 'homework') return '/hoc-tap'
  return '/'
}
