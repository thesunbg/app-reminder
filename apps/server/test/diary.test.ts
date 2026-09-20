import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { buildAutoSummary, getAutoEntry } from '../src/diary/auto.js'
import { buildDigest, digestRef, materializeDigests } from '../src/diary/digest.js'
import { addDays, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'

const MARK = `diary-${Date.now()}`
let familyId = ''
let userId = ''
const today = vnToday()
const yesterday = addDays(today, -1)

async function makeRoutine(title: string, over: Record<string, unknown> = {}) {
  return db.routine.create({
    data: {
      familyId, ownerId: userId, title, category: 'Học', durationMin: 60,
      timeOfDay: '06:00', rrule: 'FREQ=DAILY', startDate: addDays(today, -30),
      remindBeforeMin: 0, ...over,
    } as never,
  })
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const user = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}@test.local`, passwordHash: 'x', role: 'PARENT',
      telegramChatId: '111', notifyTelegram: true, notifyWebPush: false,
    },
  })
  userId = user.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.diaryEntry.deleteMany({ where: { userId } })
  await db.notification.deleteMany({ where: { userId } })
  await db.routine.deleteMany({ where: { familyId } })
  await db.note.deleteMany({ where: { familyId } })
  await db.user.update({ where: { id: userId }, data: { dailyDigestAt: null } })
})

describe('nhật ký tự động', () => {
  it('ngày không có gì thì không tạo entry rỗng', async () => {
    const s = await buildAutoSummary(userId, today)
    assert.equal(s.empty, true)
    assert.equal(await getAutoEntry(userId, today), null)
    assert.equal(await db.diaryEntry.count({ where: { userId } }), 0)
  })

  it('gom việc đã làm kèm thời lượng và việc chưa làm', async () => {
    const r1 = await makeRoutine('Học tiếng Anh', { durationMin: 60 })
    const r2 = await makeRoutine('Tập thể dục', { durationMin: 30 })
    await makeRoutine('Đọc sách')
    await db.taskLog.create({ data: { routineId: r1.id, date: today, status: 'DONE', actualMin: 60 } })
    await db.taskLog.create({ data: { routineId: r2.id, date: today, status: 'PARTIAL', actualMin: 15 } })

    const s = await buildAutoSummary(userId, today)
    assert.equal(s.done, 2)
    assert.equal(s.due, 3)
    assert.equal(s.totalMinutes, 75)
    assert.match(s.text, /Đã làm:.*Học tiếng Anh 1 giờ/)
    assert.match(s.text, /Tập thể dục 15 phút \(làm dở\)/)
    assert.match(s.text, /Chưa làm:.*Đọc sách/)
  })

  it('ghi nhận ghi chú đã hoàn thành trong ngày', async () => {
    await db.note.create({
      data: { familyId, ownerId: userId, title: 'Thay dầu xe', doneAt: vnDateTimeToUtc(today, '14:30') },
    })
    // hoàn thành hôm qua thì không được tính vào hôm nay
    await db.note.create({
      data: { familyId, ownerId: userId, title: 'Việc cũ', doneAt: vnDateTimeToUtc(yesterday, '10:00') },
    })
    const s = await buildAutoSummary(userId, today)
    assert.match(s.text, /Xong: Thay dầu xe/)
    assert.doesNotMatch(s.text, /Việc cũ/)
  })

  it('ghi chú xong lúc 23:30 giờ VN vẫn thuộc ngày hôm đó', async () => {
    // 23:30 VN = 16:30 UTC cùng ngày — dễ sai nếu so ngày theo UTC
    await db.note.create({
      data: { familyId, ownerId: userId, title: 'Việc khuya', doneAt: vnDateTimeToUtc(today, '23:30') },
    })
    const s = await buildAutoSummary(userId, today)
    assert.match(s.text, /Việc khuya/)
  })

  it('ghi chú xong lúc 00:30 giờ VN thuộc ngày đó, không phải hôm trước', async () => {
    // 00:30 VN = 17:30 UTC ngày HÔM TRƯỚC
    await db.note.create({
      data: { familyId, ownerId: userId, title: 'Việc sớm', doneAt: vnDateTimeToUtc(today, '00:30') },
    })
    assert.match((await buildAutoSummary(userId, today)).text, /Việc sớm/)
    assert.doesNotMatch((await buildAutoSummary(userId, yesterday)).text, /Việc sớm/)
  })

  it('ngày đã qua thì giữ nguyên bản đã lưu, không tính lại', async () => {
    const r = await makeRoutine('Học tiếng Trung')
    await db.taskLog.create({ data: { routineId: r.id, date: yesterday, status: 'DONE', actualMin: 45 } })

    const first = await getAutoEntry(userId, yesterday)
    assert.ok(first)
    assert.match(first.content, /Học tiếng Trung/)

    // xoá routine -> lịch sử tháng trước KHÔNG được biến mất
    await db.routine.delete({ where: { id: r.id } })
    const again = await getAutoEntry(userId, yesterday)
    assert.ok(again)
    assert.equal(again.content, first.content, 'bản của ngày đã qua phải giữ nguyên')
  })

  it('hôm nay thì luôn tính lại vì ngày còn đang diễn ra', async () => {
    const r = await makeRoutine('Học tiếng Anh')
    const before = await getAutoEntry(userId, today)
    assert.match(before!.content, /Chưa làm/)

    await db.taskLog.create({ data: { routineId: r.id, date: today, status: 'DONE', actualMin: 60 } })
    const after = await getAutoEntry(userId, today)
    assert.match(after!.content, /Đã làm/)
    assert.notEqual(after!.content, before!.content)
  })

  it('bản tự động và bản viết tay sống song song, không đè nhau', async () => {
    const r = await makeRoutine('Học tiếng Anh')
    await db.taskLog.create({ data: { routineId: r.id, date: today, status: 'DONE' } })
    await db.diaryEntry.create({
      data: { userId, date: today, source: 'MANUAL', content: 'Hôm nay trời đẹp, đi cà phê với vợ.', mood: 5 },
    })
    await getAutoEntry(userId, today)

    const rows = await db.diaryEntry.findMany({ where: { userId, date: today } })
    assert.equal(rows.length, 2)
    const manual = rows.find((r) => r.source === 'MANUAL')!
    assert.match(manual.content, /đi cà phê/)
    assert.equal(manual.mood, 5)
  })
})

describe('tổng kết cuối ngày', () => {
  it('tắt thì không sinh thông báo', async () => {
    assert.equal(await materializeDigests(), 0)
  })

  it('bật thì sinh đúng một thông báo cho hôm nay', async () => {
    // truyền `now` tường minh: nếu lấy giờ thật thì test chạy lúc nửa đêm sẽ đỏ
    const now = vnDateTimeToUtc(today, '08:00')
    const at = '21:00'
    await db.user.update({ where: { id: userId }, data: { dailyDigestAt: at } })
    const created = await materializeDigests(now)
    assert.equal(created, 1)

    const row = await db.notification.findFirstOrThrow({ where: { userId, kind: 'DAILY_DIGEST' } })
    assert.equal(row.refId, digestRef(today))
    assert.equal(row.fireAt.getTime(), vnDateTimeToUtc(today, at).getTime())

    // chạy lại không đẻ trùng
    await materializeDigests(now)
    assert.equal(await db.notification.count({ where: { userId, kind: 'DAILY_DIGEST' } }), 1)
  })

  it('giờ đã qua trong ngày thì không sinh', async () => {
    await db.user.update({ where: { id: userId }, data: { dailyDigestAt: '08:00' } })
    assert.equal(await materializeDigests(vnDateTimeToUtc(today, '21:00')), 0)
  })

  it('nội dung nhắc viết nhật ký khi chưa viết', async () => {
    const r = await makeRoutine('Học tiếng Anh')
    await db.taskLog.create({ data: { routineId: r.id, date: today, status: 'DONE', actualMin: 60 } })

    const chua = await buildDigest(userId, today)
    assert.match(chua.body, /xong 1\/1 việc/)
    assert.match(chua.body, /Chưa viết nhật ký/)

    await db.diaryEntry.create({ data: { userId, date: today, source: 'MANUAL', content: 'xong rồi' } })
    const roi = await buildDigest(userId, today)
    assert.match(roi.body, /đã viết/)
  })

  it('tổng kết cũng chốt luôn bản nhật ký tự động của ngày', async () => {
    const r = await makeRoutine('Tập thể dục', { durationMin: 30 })
    await db.taskLog.create({ data: { routineId: r.id, date: today, status: 'DONE', actualMin: 30 } })
    assert.equal(await db.diaryEntry.count({ where: { userId, source: 'AUTO_TASK' } }), 0)
    await buildDigest(userId, today)
    assert.equal(await db.diaryEntry.count({ where: { userId, date: today, source: 'AUTO_TASK' } }), 1)
  })
})
