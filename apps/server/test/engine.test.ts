import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { addDays, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'
import {
  cancelRoutineNotifications,
  materializeRoutines,
  rescheduleRoutine,
  restoreRoutineNotifications,
  routineRef,
} from '../src/notifications/materialize.js'
import { dispatchDue } from '../src/notifications/dispatch.js'

const MARK = `test-${Date.now()}`
let familyId = ''
let userId = ''

/** Chỉ đếm thông báo của user test, không đụng dữ liệu thật trong DB dev. */
const countFor = (where: object = {}) => db.notification.count({ where: { userId, ...where } })

async function makeRoutine(over: Partial<Parameters<typeof db.routine.create>[0]['data']> = {}) {
  return db.routine.create({
    data: {
      familyId, ownerId: userId,
      title: 'Học tiếng Anh', category: 'Học', durationMin: 60,
      timeOfDay: '06:00', rrule: 'FREQ=DAILY',
      startDate: addDays(vnToday(), -1),
      remindBeforeMin: 10, nagAfterMin: 30,
      ...over,
    } as Parameters<typeof db.routine.create>[0]['data'],
  })
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const user = await db.user.create({
    data: {
      familyId, name: 'Test', email: `${MARK}@test.local`,
      passwordHash: 'x', role: 'PARENT',
      // Telegram coi như đã liên kết để materialize mở kênh
      telegramChatId: '123456', notifyTelegram: true, notifyWebPush: false,
    },
  })
  userId = user.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

describe('materialize', () => {
  it('sinh 3 mốc nhắc cho mỗi lần xuất hiện, đúng thời điểm', async () => {
    const r = await makeRoutine()
    await materializeRoutines()

    // ngày mai chắc chắn còn ở tương lai với mọi giờ chạy test
    const tomorrow = addDays(vnToday(), 1)
    const rows = await db.notification.findMany({
      where: { userId, refId: routineRef(r.id, tomorrow) },
      orderBy: { fireAt: 'asc' },
    })
    assert.equal(rows.length, 3, 'phải có UPCOMING + DUE + NAG')
    assert.deepEqual(rows.map((x) => x.kind), ['ROUTINE_UPCOMING', 'ROUTINE_DUE', 'ROUTINE_NAG'])

    const due = vnDateTimeToUtc(tomorrow, '06:00')
    assert.equal(rows[0]!.fireAt.getTime(), due.getTime() - 10 * 60_000)
    assert.equal(rows[1]!.fireAt.getTime(), due.getTime())
    assert.equal(rows[2]!.fireAt.getTime(), due.getTime() + 30 * 60_000)
    // Kênh lúc sinh lịch chỉ là dự kiến; dispatch tính lại lúc gửi. Ở môi
    // trường test không có TELEGRAM_BOT_TOKEN nên Telegram không được xếp vào,
    // dù user này đã liên kết chat — đúng như dispatch sẽ xử sự.
    assert.deepEqual(rows[1]!.channels, ['native'])

    await db.routine.delete({ where: { id: r.id } })
  })

  it('chạy lại không đẻ trùng', async () => {
    const r = await makeRoutine()
    await materializeRoutines()
    const first = await countFor()
    await materializeRoutines()
    await materializeRoutines()
    assert.equal(await countFor(), first, 'materialize phải idempotent')
    await db.routine.delete({ where: { id: r.id } })
  })

  it('không sinh thông báo cho thời điểm đã qua', async () => {
    const r = await makeRoutine({ timeOfDay: '00:01', nagAfterMin: null, remindBeforeMin: 0 })
    await materializeRoutines()
    const past = await db.notification.count({
      where: { userId, refId: { startsWith: `${r.id}:` }, fireAt: { lte: new Date() } },
    })
    assert.equal(past, 0)
    await db.routine.delete({ where: { id: r.id } })
  })

  it('giờ yên lặng chặn thông báo rơi vào khoảng đó', async () => {
    await db.user.update({ where: { id: userId }, data: { quietFrom: '22:30', quietTo: '06:30' } })
    const r = await makeRoutine({ timeOfDay: '23:00', remindBeforeMin: 0, nagAfterMin: null })
    await materializeRoutines()
    assert.equal(await countFor({ refId: { startsWith: `${r.id}:` } }), 0, '23:00 nằm trong giờ yên lặng')

    const r2 = await makeRoutine({ timeOfDay: '09:00', remindBeforeMin: 0, nagAfterMin: null })
    await materializeRoutines()
    assert.ok((await countFor({ refId: { startsWith: `${r2.id}:` } })) > 0, '09:00 ngoài giờ yên lặng')

    await db.user.update({ where: { id: userId }, data: { quietFrom: null, quietTo: null } })
    await db.routine.deleteMany({ where: { id: { in: [r.id, r2.id] } } })
  })

  it('không sinh gì khi user không bật kênh nào', async () => {
    await db.user.update({
      where: { id: userId },
      data: { notifyTelegram: false, notifyWebPush: false, notifyNative: false },
    })
    const r = await makeRoutine()
    await materializeRoutines()
    assert.equal(await countFor({ refId: { startsWith: `${r.id}:` } }), 0)
    await db.user.update({ where: { id: userId }, data: { notifyTelegram: true, notifyNative: true } })
    await db.routine.delete({ where: { id: r.id } })
  })
})

describe('vòng đời khi tick / bỏ tick', () => {
  it('tick xong thì huỷ nhắc, bỏ tick thì khôi phục', async () => {
    const r = await makeRoutine()
    await materializeRoutines()
    const tomorrow = addDays(vnToday(), 1)
    const ref = routineRef(r.id, tomorrow)

    assert.equal(await countFor({ refId: ref, status: 'PENDING' }), 3)

    const cancelled = await cancelRoutineNotifications(r.id, tomorrow)
    assert.equal(cancelled, 3)
    assert.equal(await countFor({ refId: ref, status: 'PENDING' }), 0)
    assert.equal(await countFor({ refId: ref, status: 'CANCELLED' }), 3)

    // materialize KHÔNG được âm thầm tạo lại (bản ghi CANCELLED chiếm khoá unique)
    await materializeRoutines()
    assert.equal(await countFor({ refId: ref, status: 'PENDING' }), 0)

    const restored = await restoreRoutineNotifications(r.id, tomorrow)
    assert.equal(restored, 3, 'bỏ tick phải bật lại đúng 3 mốc')
    assert.equal(await countFor({ refId: ref, status: 'PENDING' }), 3)

    await db.routine.delete({ where: { id: r.id } })
  })

  it('sửa routine thì lịch nhắc sinh lại theo giờ mới', async () => {
    const r = await makeRoutine({ timeOfDay: '06:00', remindBeforeMin: 0, nagAfterMin: null })
    await materializeRoutines()
    const tomorrow = addDays(vnToday(), 1)
    const ref = routineRef(r.id, tomorrow)

    const before = await db.notification.findFirst({ where: { userId, refId: ref, status: 'PENDING' } })
    assert.equal(before!.fireAt.getTime(), vnDateTimeToUtc(tomorrow, '06:00').getTime())

    await db.routine.update({ where: { id: r.id }, data: { timeOfDay: '20:00' } })
    await rescheduleRoutine(r.id)

    const rows = await db.notification.findMany({ where: { userId, refId: ref, status: 'PENDING' } })
    assert.equal(rows.length, 1, 'không được để sót bản ghi giờ cũ')
    assert.equal(rows[0]!.fireAt.getTime(), vnDateTimeToUtc(tomorrow, '20:00').getTime())

    await db.routine.delete({ where: { id: r.id } })
  })

  it('sửa mà giờ KHÔNG đổi vẫn còn nguyên lịch nhắc', async () => {
    // đây là ca mà cách "cancel rồi materialize" sẽ làm mất nhắc nhở:
    // bản ghi CANCELLED chiếm khoá unique nên không tạo lại được
    const r = await makeRoutine({ timeOfDay: '06:00', remindBeforeMin: 0, nagAfterMin: null })
    await materializeRoutines()
    const ref = routineRef(r.id, addDays(vnToday(), 1))
    assert.equal(await countFor({ refId: ref, status: 'PENDING' }), 1)

    await rescheduleRoutine(r.id)
    assert.equal(await countFor({ refId: ref, status: 'PENDING' }), 1, 'vẫn phải còn đúng 1 nhắc nhở')

    await db.routine.delete({ where: { id: r.id } })
  })

  it('lưu trữ routine thì xoá sạch nhắc nhở tương lai', async () => {
    const r = await makeRoutine()
    await materializeRoutines()
    assert.ok((await countFor({ refId: { startsWith: `${r.id}:` } })) > 0)

    await db.routine.update({ where: { id: r.id }, data: { active: false } })
    await rescheduleRoutine(r.id, false)
    assert.equal(await countFor({ refId: { startsWith: `${r.id}:` }, status: 'PENDING' }), 0)

    await db.routine.delete({ where: { id: r.id } })
  })
})

describe('dispatch', () => {
  it('bỏ qua thông báo của việc đã tick xong', async () => {
    const r = await makeRoutine({ timeOfDay: '06:00', remindBeforeMin: 0, nagAfterMin: null })
    const today = vnToday()

    // ép một thông báo đến hạn ngay
    const n = await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_DUE', refTable: 'routine', refId: routineRef(r.id, today),
        title: 'x', body: 'y', fireAt: new Date(Date.now() - 1000), channels: ['telegram'],
      },
    })
    await db.taskLog.create({ data: { routineId: r.id, date: today, status: 'DONE' } })

    const res = await dispatchDue()
    assert.ok(res.claimed >= 1)
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } })
    assert.equal(after.status, 'CANCELLED', 'đã làm xong thì không gửi nữa')

    await db.routine.delete({ where: { id: r.id } })
  })

  it('gửi hỏng thì lùi lại để thử lại, không mất', async () => {
    const r = await makeRoutine()
    // chat id rác -> Telegram trả lỗi (hoặc bot chưa cấu hình -> cũng lỗi)
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '0' } })
    const n = await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_DUE', refTable: 'routine', refId: routineRef(r.id, vnToday()),
        title: 'x', body: 'y', fireAt: new Date(Date.now() - 1000), channels: ['telegram'],
      },
    })

    await dispatchDue()
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } })
    assert.equal(after.status, 'PENDING', 'phải quay lại PENDING để thử lại')
    assert.equal(after.attempts, 1)
    assert.ok(after.fireAt.getTime() > Date.now(), 'phải lùi thời điểm thử lại')
    assert.ok(after.error)

    await db.user.update({ where: { id: userId }, data: { telegramChatId: '123456' } })
    await db.routine.delete({ where: { id: r.id } })
  })

  it('hỏng quá số lần thì đánh dấu FAILED', async () => {
    const r = await makeRoutine()
    await db.user.update({ where: { id: userId }, data: { telegramChatId: '0' } })
    const n = await db.notification.create({
      data: {
        userId, kind: 'ROUTINE_DUE', refTable: 'routine', refId: routineRef(r.id, vnToday()),
        title: 'x', body: 'y', fireAt: new Date(Date.now() - 1000), channels: ['telegram'],
        attempts: 3,
      },
    })
    await dispatchDue()
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } })
    assert.equal(after.status, 'FAILED')

    await db.user.update({ where: { id: userId }, data: { telegramChatId: '123456' } })
    await db.routine.delete({ where: { id: r.id } })
  })
})
