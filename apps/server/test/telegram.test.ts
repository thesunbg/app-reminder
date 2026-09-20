/**
 * Chạy Telegram Bot API giả trên localhost để kiểm tra luồng gửi và luồng
 * liên kết tài khoản — phần fiddly nhất và không thể thử bằng tay nếu chưa
 * có bot thật.
 *
 * TELEGRAM_BOT_TOKEN và TELEGRAM_API_BASE phải được đặt TRƯỚC khi import
 * bất kỳ module nào đọc env.
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'

const PORT = 39_517
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${PORT}/bot`

const { db } = await import('../src/db.js')
const { sendMessage, telegramEnabled } = await import('../src/lib/telegram.js')
const { pollTelegramOnce } = await import('../src/notifications/telegram-poller.js')
const { dispatchDue } = await import('../src/notifications/dispatch.js')
const { vnToday } = await import('../src/lib/time.js')

type Call = { method: string; body: Record<string, unknown> }
const calls: Call[] = []
let queuedUpdates: unknown[] = []
let server: Server

const MARK = `tg-${Date.now()}`
let familyId = ''
let userId = ''

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const method = req.url!.split('/').pop()!
      const body = raw ? JSON.parse(raw) : {}
      calls.push({ method, body })
      res.setHeader('Content-Type', 'application/json')
      if (method === 'getUpdates') {
        const out = queuedUpdates
        queuedUpdates = []
        res.end(JSON.stringify({ ok: true, result: out }))
      } else {
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }))
      }
    })
  })
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r))

  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const user = await db.user.create({
    data: { familyId, name: 'Bố Test', email: `${MARK}@test.local`, passwordHash: 'x', role: 'PARENT' },
  })
  userId = user.id
  await db.appState.deleteMany({ where: { key: 'telegram:offset' } })
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.appState.deleteMany({ where: { key: 'telegram:offset' } })
  await new Promise<void>((r) => server.close(() => r()))
  await db.$disconnect()
})

beforeEach(() => { calls.length = 0 })

const update = (id: number, text: string, chatId = 777) => ({
  update_id: id,
  message: { message_id: id, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'X' }, text },
})

describe('telegram — gửi tin', () => {
  it('bật khi có token', () => {
    assert.equal(telegramEnabled(), true)
  })

  it('sendMessage gửi HTML và tắt preview link', async () => {
    await sendMessage('777', '<b>Chào</b>')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.method, 'sendMessage')
    assert.equal(calls[0]!.body.chat_id, '777')
    assert.equal(calls[0]!.body.parse_mode, 'HTML')
    assert.equal(calls[0]!.body.disable_web_page_preview, true)
  })
})

describe('telegram — liên kết tài khoản', () => {
  it('/start với mã hợp lệ thì gắn chat vào đúng người', async () => {
    await db.user.update({
      where: { id: userId },
      data: { telegramLinkCode: 'ABC123', telegramLinkExpires: new Date(Date.now() + 600_000) },
    })
    queuedUpdates = [update(1, '/start ABC123')]
    await pollTelegramOnce()

    const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(u.telegramChatId, '777')
    assert.equal(u.telegramLinkCode, null, 'mã phải bị tiêu huỷ sau khi dùng')
    assert.equal(u.telegramLinkExpires, null)

    const sent = calls.filter((c) => c.method === 'sendMessage')
    assert.equal(sent.length, 1)
    assert.match(String(sent[0]!.body.text), /Đã liên kết/)
  })

  it('mã đã hết hạn thì từ chối', async () => {
    await db.user.update({
      where: { id: userId },
      data: { telegramChatId: null, telegramLinkCode: 'OLD999', telegramLinkExpires: new Date(Date.now() - 1000) },
    })
    queuedUpdates = [update(2, '/start OLD999')]
    await pollTelegramOnce()

    const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(u.telegramChatId, null, 'không được liên kết bằng mã hết hạn')
    assert.match(String(calls.find((c) => c.method === 'sendMessage')!.body.text), /hết hạn/)
  })

  it('mã sai thì từ chối và không đổi gì', async () => {
    queuedUpdates = [update(3, '/start SAISAI')]
    await pollTelegramOnce()
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(u.telegramChatId, null)
  })

  it('/huylienket gỡ liên kết', async () => {
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })
    queuedUpdates = [update(4, '/huylienket')]
    await pollTelegramOnce()
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(u.telegramChatId, null)
  })

  it('offset tiến lên để không xử lý lại update cũ', async () => {
    queuedUpdates = [update(10, '/help'), update(11, '/help')]
    await pollTelegramOnce()
    const row = await db.appState.findUniqueOrThrow({ where: { key: 'telegram:offset' } })
    assert.equal(row.value, '12', 'offset = update_id lớn nhất + 1')

    // lượt sau phải hỏi từ offset đó
    queuedUpdates = []
    await pollTelegramOnce()
    assert.equal(calls.at(-1)!.body.offset, 12)
  })

  it('offset vẫn tiến kể cả khi xử lý một update bị lỗi', async () => {
    // /start với mã rác -> handleStart gửi tin từ chối; nếu có ngoại lệ nào
    // thoát ra ngoài thì offset sẽ kẹt và bot lặp vô hạn trên tin đó
    queuedUpdates = [update(20, '/start ZZZZZZ'), update(21, 'tin nhắn thường')]
    await pollTelegramOnce()
    const row = await db.appState.findUniqueOrThrow({ where: { key: 'telegram:offset' } })
    assert.equal(row.value, '22')
  })
})

describe('telegram — gửi qua dispatch', () => {
  it('liên kết Telegram SAU khi thông báo đã sinh thì vẫn nhận được', async () => {
    // Đây là ca dễ sai: thông báo sinh trước 14 ngày với channels=['webpush'].
    // Nếu dispatch tin vào giá trị đã chốt đó, người vừa liên kết Telegram
    // sẽ không nhận được gì suốt hai tuần.
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Học tiếng Trung', category: 'Học',
        durationMin: 60, timeOfDay: '21:00', rrule: 'FREQ=DAILY',
        startDate: vnToday(), remindBeforeMin: 0,
      },
    })
    const n = await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_DUE', refTable: 'routine',
        refId: `${routine.id}:${vnToday()}`,
        title: 'Đến giờ: Học tiếng Trung', body: '21:00 · 1 giờ',
        fireAt: new Date(Date.now() - 1000),
        channels: ['webpush'], // chốt lúc chưa có Telegram
      },
    })

    // giờ mới liên kết Telegram
    await db.user.update({
      where: { id: userId },
      data: { telegramChatId: '777', notifyTelegram: true, notifyWebPush: false },
    })

    await dispatchDue()

    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } })
    assert.equal(after.status, 'SENT')
    assert.deepEqual(after.channels, ['telegram'], 'phải ghi lại kênh thực sự đã gửi')

    const msg = calls.find((c) => c.method === 'sendMessage')
    assert.ok(msg, 'phải có lệnh sendMessage tới Telegram')
    assert.match(String(msg!.body.text), /Học tiếng Trung/)

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('không bật kênh nào thì báo lỗi rõ, không im lặng nuốt', async () => {
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'X', category: 'Học',
        durationMin: 30, timeOfDay: '08:00', rrule: 'FREQ=DAILY',
        startDate: vnToday(), remindBeforeMin: 0,
      },
    })
    await db.user.update({
      where: { id: userId },
      data: { notifyTelegram: false, notifyWebPush: false },
    })
    const n = await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_DUE', refTable: 'routine',
        refId: `${routine.id}:${vnToday()}`, title: 'x', body: 'y',
        fireAt: new Date(Date.now() - 1000), channels: ['telegram'],
      },
    })

    await dispatchDue()
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } })
    assert.equal(after.status, 'PENDING', 'thử lại chứ không vứt đi')
    assert.match(after.error ?? '', /chưa bật kênh/)

    await db.user.update({ where: { id: userId }, data: { notifyTelegram: true, notifyWebPush: true } })
    await db.routine.delete({ where: { id: routine.id } })
  })
})
