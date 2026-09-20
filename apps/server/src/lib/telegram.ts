import { env } from '../env.js'

export const telegramEnabled = () => env.TELEGRAM_BOT_TOKEN.length > 0

type TelegramResponse<T> = { ok: true; result: T } | { ok: false; description: string; error_code: number }

async function call<T>(method: string, body?: unknown): Promise<T> {
  if (!telegramEnabled()) throw new Error('TELEGRAM_BOT_TOKEN chưa được cấu hình')
  const res = await fetch(`${env.TELEGRAM_API_BASE}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  })
  const data = (await res.json()) as TelegramResponse<T>
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description} (${data.error_code})`)
  return data.result
}

/** HTML mode của Telegram chỉ cho vài thẻ; escape phần còn lại. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function sendMessage(chatId: string, html: string): Promise<void> {
  await call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
}

export async function getMe(): Promise<{ id: number; username?: string; first_name: string }> {
  return call('getMe')
}

export type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string }
    from?: { id: number; first_name: string; username?: string }
    text?: string
  }
}

export async function getUpdates(offset: number, timeoutSec = 0): Promise<TelegramUpdate[]> {
  return call('getUpdates', {
    offset,
    timeout: timeoutSec,
    allowed_updates: ['message'],
  })
}
