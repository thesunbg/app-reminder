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

/** Một nút bấm gắn dưới tin nhắn. `data` tối đa 64 byte theo Bot API. */
export type InlineButton = { text: string; data: string }

/**
 * `undefined` = không đụng tới bàn phím; `[]` = gỡ hẳn bàn phím đi.
 * Phân biệt hai ca này là cần thiết: `editMessageText` thiếu `reply_markup`
 * cũng gỡ nút, nhưng dựa vào chi tiết ngầm đó thì đọc code không thấy ý định.
 */
function markup(buttons?: InlineButton[][]) {
  if (!buttons) return undefined
  return {
    inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  }
}

export async function sendMessage(
  chatId: string,
  html: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    // tin nhắn mới mà không có nút nào thì đừng gửi bàn phím rỗng
    reply_markup: markup(buttons?.length ? buttons : undefined),
  })
}

/**
 * Trả lời một lần bấm nút. BẮT BUỘC gọi trong vòng vài giây, nếu không Telegram
 * hiện vòng xoay mãi trên máy người dùng như thể bot chết.
 */
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await call('answerCallbackQuery', { callback_query_id: callbackId, text, show_alert: false })
}

/**
 * Sửa lại chính tin nhắn vừa bấm: ghi kết quả vào nội dung và gỡ nút đi.
 * Không gỡ thì lần sau mở lại lịch sử chat vẫn thấy nút, bấm lại lần nữa.
 */
export async function editMessage(
  chatId: string,
  messageId: number,
  html: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: markup(buttons),
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
  /** người dùng bấm một nút inline dưới tin nhắn nhắc nhở */
  callback_query?: {
    id: string
    from: { id: number; first_name: string; username?: string }
    message?: { message_id: number; chat: { id: number; type: string }; text?: string }
    data?: string
  }
}

export async function getUpdates(offset: number, timeoutSec = 0): Promise<TelegramUpdate[]> {
  return call('getUpdates', {
    offset,
    timeout: timeoutSec,
    allowed_updates: ['message', 'callback_query'],
  })
}
