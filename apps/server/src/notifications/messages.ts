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
