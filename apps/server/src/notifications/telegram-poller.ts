import { db } from '../db.js'
import { getUpdates, sendMessage, telegramEnabled, escapeHtml } from '../lib/telegram.js'

const OFFSET_KEY = 'telegram:offset'
const LONG_POLL_SEC = 30

async function readOffset(): Promise<number> {
  const row = await db.appState.findUnique({ where: { key: OFFSET_KEY } })
  return row ? Number(row.value) || 0 : 0
}

async function writeOffset(offset: number): Promise<void> {
  await db.appState.upsert({
    where: { key: OFFSET_KEY },
    create: { key: OFFSET_KEY, value: String(offset) },
    update: { value: String(offset) },
  })
}

const HELP = [
  'Các lệnh:',
  '/start &lt;mã&gt; — liên kết tài khoản Family Hub',
  '/huylienket — ngắt liên kết máy này',
  '/help — xem trợ giúp',
].join('\n')

async function handleStart(chatId: string, code: string): Promise<void> {
  const user = await db.user.findUnique({ where: { telegramLinkCode: code.toUpperCase() } })

  if (!user || !user.telegramLinkExpires || user.telegramLinkExpires < new Date()) {
    await sendMessage(chatId, '❌ Mã không đúng hoặc đã hết hạn.\nVào Family Hub → Cài đặt → Kênh nhắc nhở để lấy mã mới.')
    return
  }

  // một chat Telegram chỉ gắn với một tài khoản
  await db.user.updateMany({
    where: { telegramChatId: chatId, id: { not: user.id } },
    data: { telegramChatId: null },
  })
  await db.user.update({
    where: { id: user.id },
    data: { telegramChatId: chatId, telegramLinkCode: null, telegramLinkExpires: null },
  })

  await sendMessage(
    chatId,
    `✅ Đã liên kết với <b>${escapeHtml(user.name)}</b>.\nTừ giờ các nhắc nhở sẽ được gửi vào đây.`,
  )
}

async function handleUnlink(chatId: string): Promise<void> {
  const res = await db.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } })
  await sendMessage(
    chatId,
    res.count > 0 ? '✅ Đã ngắt liên kết. Sẽ không nhắc vào đây nữa.' : 'Máy này chưa liên kết với tài khoản nào.',
  )
}

/** Xử lý một lượt getUpdates. Trả về số update đã xử lý. */
export async function pollTelegramOnce(longPoll = false): Promise<number> {
  if (!telegramEnabled()) return 0

  const offset = await readOffset()
  const updates = await getUpdates(offset, longPoll ? LONG_POLL_SEC : 0)
  if (updates.length === 0) return 0

  for (const u of updates) {
    const msg = u.message
    const text = msg?.text?.trim()
    if (!msg || !text) continue
    const chatId = String(msg.chat.id)

    try {
      if (text.startsWith('/start')) {
        const code = text.slice('/start'.length).trim()
        if (code) await handleStart(chatId, code)
        else await sendMessage(chatId, `👋 Chào bạn!\n\nĐể nhận nhắc nhở, lấy mã ở Family Hub → Cài đặt, rồi gửi:\n<code>/start MÃCỦABẠN</code>`)
      } else if (text.startsWith('/huylienket')) {
        await handleUnlink(chatId)
      } else if (text.startsWith('/help')) {
        await sendMessage(chatId, HELP)
      }
    } catch (err) {
      console.error('[telegram] lỗi xử lý update', u.update_id, (err as Error).message)
    }
  }

  // Telegram xoá update khi offset vượt qua nó — luôn tiến offset kể cả khi
  // xử lý lỗi, nếu không một tin nhắn hỏng sẽ kẹt vòng lặp mãi mãi.
  const maxId = Math.max(...updates.map((u) => u.update_id))
  await writeOffset(maxId + 1)
  return updates.length
}
