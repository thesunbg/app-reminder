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
      data: { notifyTelegram: false, notifyWebPush: false, notifyNative: false },
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

    await db.user.update({
      where: { id: userId },
      data: { notifyTelegram: true, notifyWebPush: true, notifyNative: true },
    })
    await db.routine.delete({ where: { id: routine.id } })
  })
})

// ---------- nút bấm trong tin nhắn ----------

const { buttonsFor, SNOOZE_MIN } = await import('../src/notifications/actions.js')

/** Một lần bấm nút, đúng hình dạng Telegram gửi về. */
const press = (id: number, data: string, chatId = 777, text = 'Đến giờ: Học bài') => ({
  update_id: id,
  callback_query: {
    id: `cb${id}`,
    from: { id: chatId, first_name: 'X' },
    message: { message_id: id * 10, chat: { id: chatId, type: 'private' }, text },
    data,
  },
})

describe('telegram — nút bấm', () => {
  it('callback_data luôn nằm trong giới hạn 64 byte của Bot API', () => {
    const long = 'c'.repeat(25) // cuid dài 25 ký tự
    const rows = buttonsFor({ refTable: 'routine', refId: `${long}:2026-09-28` })
    assert.ok(rows.length > 0, 'việc định kỳ phải có nút')
    for (const row of rows) {
      for (const b of row) {
        assert.ok(Buffer.byteLength(b.data) <= 64, `${b.data} dài ${Buffer.byteLength(b.data)} byte`)
      }
    }
  })

  it('sự kiện và lễ tết không có nút — chẳng có gì để tick', () => {
    assert.deepEqual(buttonsFor({ refTable: 'event', refId: 'abc:2026-09-28' }), [])
    assert.deepEqual(buttonsFor({ refTable: 'holiday', refId: 'tet:2026-02-17' }), [])
    assert.deepEqual(buttonsFor({ refTable: 'digest', refId: 'u:2026-09-28' }), [])
  })

  it('dispatch gắn nút vào tin nhắn việc định kỳ', async () => {
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Tập thể dục', category: 'Sức khoẻ',
        durationMin: 30, timeOfDay: '05:30', rrule: 'FREQ=DAILY',
        startDate: vnToday(), remindBeforeMin: 0,
      },
    })
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777', notifyTelegram: true, notifyWebPush: false, notifyNative: false } })
    await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_DUE', refTable: 'routine',
        refId: `${routine.id}:${vnToday()}`, title: 'Đến giờ: Tập thể dục', body: '05:30',
        fireAt: new Date(Date.now() - 1000), channels: ['telegram'],
      },
    })
    await dispatchDue()

    const msg = calls.find((c) => c.method === 'sendMessage')!
    const markup = msg.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
    assert.ok(markup, 'tin nhắn phải có bàn phím inline')
    const flat = markup.inline_keyboard.flat()
    assert.ok(flat.some((b) => b.callback_data === `r:${routine.id}:${vnToday()}:D`))
    assert.ok(flat.some((b) => b.callback_data === `z:${routine.id}:${vnToday()}`))

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('bấm "✓ Xong" thì ghi TaskLog, trả lời và gỡ nút', async () => {
    const date = vnToday()
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Đọc sách', category: 'Học',
        durationMin: 20, timeOfDay: '20:00', rrule: 'FREQ=DAILY',
        startDate: date, remindBeforeMin: 0,
      },
    })
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })

    queuedUpdates = [press(100, `r:${routine.id}:${date}:D`)]
    await pollTelegramOnce()

    const log = await db.taskLog.findUnique({ where: { routineId_date: { routineId: routine.id, date } } })
    assert.equal(log?.status, 'DONE')
    assert.equal(log?.actualMin, 20, 'mặc định lấy thời lượng của việc')

    const answer = calls.find((c) => c.method === 'answerCallbackQuery')
    assert.ok(answer, 'phải trả lời callback, nếu không Telegram quay vòng mãi')
    assert.match(String(answer!.body.text), /Xong/)

    const edit = calls.find((c) => c.method === 'editMessageText')
    assert.ok(edit, 'phải sửa lại tin nhắn gốc')
    assert.match(String(edit!.body.text), /Đọc sách/)
    assert.deepEqual(edit!.body.reply_markup, { inline_keyboard: [] }, 'phải gỡ nút sau khi tick')

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('bấm lại đúng trạng thái cũ = bỏ tick', async () => {
    const date = vnToday()
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Luyện chữ', category: 'Học',
        durationMin: 20, timeOfDay: '20:30', rrule: 'FREQ=DAILY', startDate: date, remindBeforeMin: 0,
      },
    })
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })

    queuedUpdates = [press(110, `r:${routine.id}:${date}:D`)]
    await pollTelegramOnce()
    queuedUpdates = [press(111, `r:${routine.id}:${date}:D`)]
    await pollTelegramOnce()

    const log = await db.taskLog.findUnique({ where: { routineId_date: { routineId: routine.id, date } } })
    assert.equal(log, null, 'lần bấm thứ hai phải bỏ tick')
    assert.match(String(calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!.body.text), /bỏ tick/)

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('tick xong thì các nhắc còn treo của ngày đó bị huỷ', async () => {
    const date = vnToday()
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Ôn bài', category: 'Học',
        durationMin: 30, timeOfDay: '19:00', rrule: 'FREQ=DAILY', startDate: date, remindBeforeMin: 0,
        nagAfterMin: 30,
      },
    })
    const pending = await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_NAG', refTable: 'routine', refId: `${routine.id}:${date}`,
        title: 'x', body: 'y', fireAt: new Date(Date.now() + 3_600_000), channels: ['telegram'],
      },
    })
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })

    queuedUpdates = [press(120, `r:${routine.id}:${date}:D`)]
    await pollTelegramOnce()

    const after = await db.notification.findUniqueOrThrow({ where: { id: pending.id } })
    assert.equal(after.status, 'CANCELLED')

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('bấm "💤" sinh một nhắc mới sau 15 phút, không sửa lịch sử cái cũ', async () => {
    const date = vnToday()
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Uống thuốc', category: 'Sức khoẻ',
        durationMin: 5, timeOfDay: '08:00', rrule: 'FREQ=DAILY', startDate: date, remindBeforeMin: 0,
      },
    })
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })

    const before = Date.now()
    queuedUpdates = [press(130, `z:${routine.id}:${date}`)]
    await pollTelegramOnce()

    const snoozed = await db.notification.findFirst({
      where: { refTable: 'routine', refId: `${routine.id}:${date}`, status: 'PENDING' },
    })
    assert.ok(snoozed, 'phải có một nhắc mới đang chờ')
    const delayMin = (snoozed.fireAt.getTime() - before) / 60_000
    assert.ok(delayMin > SNOOZE_MIN - 1 && delayMin < SNOOZE_MIN + 1, `hoãn ${delayMin} phút`)

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('chat chưa liên kết thì không tick được việc của người khác', async () => {
    const date = vnToday()
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: userId, title: 'Việc riêng', category: 'Khác',
        durationMin: 10, timeOfDay: '10:00', rrule: 'FREQ=DAILY', startDate: date, remindBeforeMin: 0,
      },
    })
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })

    // chat 999 chưa gắn với tài khoản nào
    queuedUpdates = [press(140, `r:${routine.id}:${date}:D`, 999)]
    await pollTelegramOnce()

    const log = await db.taskLog.findUnique({ where: { routineId_date: { routineId: routine.id, date } } })
    assert.equal(log, null, 'người lạ đoán được id cũng không tick được')
    assert.match(String(calls.find((c) => c.method === 'answerCallbackQuery')!.body.text), /chưa liên kết/)

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('nút hỏng / dữ liệu rác không làm kẹt offset', async () => {
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '777' } })
    queuedUpdates = [press(200, 'r:khong-co-that:2026-01-01:D'), press(201, 'rác')]
    await pollTelegramOnce()
    const row = await db.appState.findUniqueOrThrow({ where: { key: 'telegram:offset' } })
    assert.equal(row.value, '202')
    assert.equal(calls.filter((c) => c.method === 'answerCallbackQuery').length, 2, 'lần bấm nào cũng phải được trả lời')
  })
})
