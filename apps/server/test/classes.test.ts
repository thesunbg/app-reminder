import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { classDraft, clearClassNotifications, materializeClasses } from '../src/notifications/classes.js'
import { buildWeekly, materializeWeekly, weeklyRef, weekFromRef } from '../src/diary/weekly.js'
import { holidaysBetween } from '../src/lib/holidays.js'
import { addDays, isoWeekday, startOfWeek, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'

const MARK = `cls-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''

const today = vnToday()

/** Ngày sắp tới rơi đúng vào thứ `weekday` (1=T2…7=CN), cách hôm nay 1–7 ngày. */
function nextWeekday(weekday: number): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i)
    if (isoWeekday(d) === weekday) return d
  }
  throw new Error('không thể')
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const parent = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}-p@test.local`, passwordHash: 'x', role: 'PARENT',
      notifyWebPush: true, notifyNative: false, classReminderAt: null,
    },
  })
  parentId = parent.id
  const child = await db.user.create({
    data: {
      familyId, name: 'Bé Su', email: `${MARK}-c@test.local`, passwordHash: 'x', role: 'CHILD',
      notifyWebPush: true, notifyNative: false, classReminderAt: '20:00',
    },
  })
  childId = child.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.notification.deleteMany({ where: { userId: { in: [parentId, childId] } } })
  await db.classSchedule.deleteMany({ where: { childId } })
  await db.studyRecord.deleteMany({ where: { childId } })
})

async function addLesson(weekday: number, period: number, subject: string, startTime = '07:00', room?: string) {
  return db.classSchedule.create({
    data: {
      childId, weekday, period, subject, startTime,
      endTime: '07:45', room: room ?? null, effectiveFrom: addDays(today, -30),
    },
  })
}

describe('nội dung nhắc thời khoá biểu', () => {
  it('gộp tiết trùng môn và ghi giờ vào học', () => {
    const d = classDraft('2026-09-30', [
      { period: 2, subject: 'Toán', startTime: '07:50', endTime: '08:35', room: null },
      { period: 1, subject: 'Toán', startTime: '07:00', endTime: '07:45', room: null },
      { period: 3, subject: 'Thể dục', startTime: '08:45', endTime: '09:30', room: 'Sân' },
    ])
    assert.match(d.title, /Mai thứ 4 \(30\/9\)/)
    assert.match(d.body, /^Toán · Thể dục/, 'hai tiết Toán liền phải gộp làm một')
    assert.match(d.body, /Vào học 07:00/, 'giờ phải lấy theo tiết ĐẦU, không phải tiết nhập trước')
    assert.match(d.body, /3 tiết/)
    assert.match(d.body, /Thể dục: Sân/)
  })
})

describe('sinh nhắc thời khoá biểu', () => {
  it('nhắc TỐI HÔM TRƯỚC, không nhắc đúng buổi sáng hôm đó', async () => {
    const day = nextWeekday(isoWeekday(addDays(today, 2)))
    await addLesson(isoWeekday(day), 1, 'Toán')
    await materializeClasses()

    // chân trời 14 ngày nên một tiết hàng tuần ra hai lần — lấy lần gần nhất
    const rows = await db.notification.findMany({
      where: { userId: childId, refTable: 'class' },
      orderBy: { fireAt: 'asc' },
    })
    assert.ok(rows.length >= 1)
    assert.equal(rows[0]!.refId, `${childId}:${day}`, 'refId mang ngày HỌC')
    assert.equal(
      rows[0]!.fireAt.getTime(),
      vnDateTimeToUtc(addDays(day, -1), '20:00').getTime(),
      'phải bắn tối hôm trước',
    )
    for (const r of rows) {
      assert.equal(isoWeekday(r.refId.split(':')[1]!), isoWeekday(day), 'chỉ được nhắc đúng thứ có tiết')
    }
  })

  it('chỉ gửi cho con, không réo phụ huynh', async () => {
    await addLesson(isoWeekday(addDays(today, 1)), 1, 'Văn')
    await materializeClasses()
    assert.equal(await db.notification.count({ where: { userId: parentId, refTable: 'class' } }), 0)
  })

  it('ngày không có tiết nào thì im', async () => {
    // chỉ học thứ 2; các ngày khác không được sinh gì
    await addLesson(1, 1, 'Toán')
    await materializeClasses()
    const rows = await db.notification.findMany({ where: { userId: childId, refTable: 'class' } })
    for (const r of rows) {
      assert.equal(isoWeekday(r.refId.split(':')[1]!), 1)
    }
  })

  it('bỏ qua ngày nghỉ lễ — nhắc soạn cặp cho ngày Quốc khánh thì lần sau con bỏ qua mọi thông báo', async () => {
    const dayOff = holidaysBetween(addDays(today, 1), addDays(today, 14)).find((h) => h.holiday.dayOff)
    if (!dayOff) return // 14 ngày tới không có ngày nghỉ nào thì không kiểm được

    // dạy đúng thứ của ngày nghỉ đó
    await addLesson(isoWeekday(dayOff.startDate), 1, 'Toán')
    await materializeClasses()

    const refIds = (await db.notification.findMany({ where: { userId: childId, refTable: 'class' } })).map(
      (r) => r.refId,
    )
    assert.ok(!refIds.includes(`${childId}:${dayOff.startDate}`), `${dayOff.holiday.title} vẫn bị nhắc`)
  })

  it('tiết đã hết hiệu lực thì không nhắc', async () => {
    const day = nextWeekday(isoWeekday(addDays(today, 3)))
    await db.classSchedule.create({
      data: {
        childId, weekday: isoWeekday(day), period: 1, subject: 'Toán',
        startTime: '07:00', endTime: '07:45',
        effectiveFrom: addDays(today, -60), effectiveTo: addDays(today, -1),
      },
    })
    await materializeClasses()
    assert.equal(await db.notification.count({ where: { userId: childId, refTable: 'class' } }), 0)
  })

  it('tắt nhắc thì không sinh, và dọn được lịch còn treo', async () => {
    await addLesson(isoWeekday(addDays(today, 1)), 1, 'Toán')
    await materializeClasses()
    assert.ok((await db.notification.count({ where: { userId: childId, refTable: 'class' } })) > 0)

    const removed = await clearClassNotifications(childId)
    assert.ok(removed > 0)

    await db.user.update({ where: { id: childId }, data: { classReminderAt: null } })
    await materializeClasses()
    assert.equal(await db.notification.count({ where: { userId: childId, refTable: 'class' } }), 0)
    await db.user.update({ where: { id: childId }, data: { classReminderAt: '20:00' } })
  })

  it('chạy lại không đẻ trùng', async () => {
    await addLesson(isoWeekday(addDays(today, 1)), 1, 'Toán')
    const first = await materializeClasses()
    const again = await materializeClasses()
    assert.ok(first > 0)
    assert.equal(again, 0)
  })
})

describe('tổng kết tuần', () => {
  it('sinh cho chủ nhật của tuần này, nội dung để trống tới lúc gửi', async () => {
    await db.user.update({ where: { id: parentId }, data: { weeklyDigestAt: '20:00' } })
    const sunday = addDays(startOfWeek(today), 6)
    // chủ nhật đã qua 20:00 thì không còn gì để sinh — bỏ qua ca đó
    const fireAt = vnDateTimeToUtc(sunday, '20:00')
    await materializeWeekly()

    const row = await db.notification.findFirst({ where: { userId: parentId, kind: 'WEEKLY_DIGEST' } })
    if (fireAt.getTime() <= Date.now()) {
      assert.equal(row, null, 'mốc đã qua thì không sinh')
      return
    }
    assert.ok(row)
    assert.equal(row.refId, weeklyRef(startOfWeek(today)))
    assert.equal(row.body, '…', 'nội dung phải tính lúc gửi, tuần chưa hết thì chưa biết')
  })

  it('refId đọc ngược ra đúng tuần', () => {
    assert.equal(weekFromRef(weeklyRef('2026-09-28')), '2026-09-28')
    assert.equal(weekFromRef('weekly:rác'), null)
  })

  it('phụ huynh thấy từng người trong nhà', async () => {
    const week = startOfWeek(today)
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: childId, title: 'Học bài', category: 'Học',
        durationMin: 30, timeOfDay: '19:00', rrule: 'FREQ=DAILY', startDate: addDays(week, -7),
      },
    })
    await db.taskLog.create({ data: { routineId: routine.id, date: week, status: 'DONE' } })

    const d = await buildWeekly(parentId, week)
    assert.match(d.title, /Tổng kết tuần/)
    assert.match(d.body, /Bé Su/, 'phụ huynh phải thấy tên từng người')

    await db.routine.delete({ where: { id: routine.id } })
  })

  it('con chỉ thấy phần của mình', async () => {
    const week = startOfWeek(today)
    const mine = await db.routine.create({
      data: {
        familyId, ownerId: childId, title: 'Học bài', category: 'Học',
        durationMin: 30, timeOfDay: '19:00', rrule: 'FREQ=DAILY', startDate: addDays(week, -7),
      },
    })
    const dad = await db.routine.create({
      data: {
        familyId, ownerId: parentId, title: 'Chạy bộ', category: 'Sức khoẻ',
        durationMin: 30, timeOfDay: '05:30', rrule: 'FREQ=DAILY', startDate: addDays(week, -7),
      },
    })
    await db.taskLog.create({ data: { routineId: dad.id, date: week, status: 'DONE' } })

    const d = await buildWeekly(childId, week)
    assert.ok(!d.body.includes('Bố'), 'con không được thấy số liệu của bố trong tin nhắn')

    await db.routine.deleteMany({ where: { id: { in: [mine.id, dad.id] } } })
  })

  it('liệt kê bài tập còn nợ và lễ tết tuần tới', async () => {
    const week = startOfWeek(today)
    await db.studyRecord.create({
      data: { childId, kind: 'HOMEWORK', title: 'Làm nốt bài hình trang 42', date: addDays(week, 2) },
    })
    const d = await buildWeekly(parentId, week)
    assert.match(d.body, /Còn 1 bài chưa xong/)
    assert.match(d.body, /bài hình trang 42/)
  })

  it('tuần không có việc nào thì nói thẳng, không im lặng gửi tin rỗng', async () => {
    const d = await buildWeekly(parentId, addDays(startOfWeek(today), -700))
    assert.match(d.body, /không có việc nào/)
  })
})
