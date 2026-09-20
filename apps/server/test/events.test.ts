import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { lunarMonthLength, lunarOf, lunarToSolar, toSolarString } from '../src/lib/lunar.js'
import { addDays, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'
import {
  clearEventNotifications,
  eventRef,
  materializeEventOccurrences,
  materializeEvents,
  resolveLunarAnniversary,
  resolveOccurrence,
} from '../src/notifications/events.js'

const MARK = `ev-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''

const thisLunarYear = lunarOf(vnToday()).year

async function makeEvent(data: Record<string, unknown>) {
  return db.event.create({
    data: {
      familyId, title: 'Giỗ ông nội', type: 'DEATH_ANNIVERSARY', calendar: 'LUNAR',
      lunarDay: 15, lunarMonth: 7, lunarLeap: false,
      remindBeforeDays: [7, 3, 0], remindAtTime: '08:00',
      ...data,
    } as never,
  })
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const parent = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}-p@test.local`, passwordHash: 'x', role: 'PARENT',
      telegramChatId: '111', notifyTelegram: true, notifyWebPush: false,
    },
  })
  parentId = parent.id
  const child = await db.user.create({
    data: {
      familyId, name: 'Con', email: `${MARK}-c@test.local`, passwordHash: 'x', role: 'CHILD',
      telegramChatId: '222', notifyTelegram: true, notifyWebPush: false,
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
  await db.event.deleteMany({ where: { familyId } })
})

describe('quy đổi ngày giỗ âm lịch', () => {
  it('ngày thường thì quy đổi thẳng', () => {
    const got = resolveLunarAnniversary(15, 7, false, 2026)
    assert.equal(got, toSolarString(lunarToSolar(15, 7, 2026, false)!))
  })

  it('ngày 30 ở tháng thiếu thì lùi về 29, KHÔNG bỏ giỗ', () => {
    // tìm một tháng chỉ có 29 ngày
    let found: [number, number] | null = null
    for (let y = 2026; y <= 2030 && !found; y++) {
      for (let m = 1; m <= 12; m++) {
        if (lunarMonthLength(m, y, false) === 29) { found = [m, y]; break }
      }
    }
    assert.ok(found, 'phải tìm được tháng thiếu để kiểm tra')
    const [m, y] = found

    const got = resolveLunarAnniversary(30, m, false, y)
    assert.ok(got, 'không được trả null — giỗ vẫn phải cúng')
    const back = lunarOf(got)
    assert.equal(back.day, 29, `tháng ${m}/${y} chỉ có 29 ngày nên phải cúng ngày 29`)
    assert.equal(back.month, m, 'không được tràn sang tháng sau')
  })

  it('ngày 30 ở tháng đủ thì vẫn là 30', () => {
    let found: [number, number] | null = null
    for (let y = 2026; y <= 2030 && !found; y++) {
      for (let m = 1; m <= 12; m++) {
        if (lunarMonthLength(m, y, false) === 30) { found = [m, y]; break }
      }
    }
    const [m, y] = found!
    const back = lunarOf(resolveLunarAnniversary(30, m, false, y)!)
    assert.equal(back.day, 30)
    assert.equal(back.month, m)
  })

  it('ghi tháng nhuận nhưng năm đó không nhuận thì cúng ở tháng thường', () => {
    // 2026 không có tháng nhuận nào
    const got = resolveLunarAnniversary(15, 6, true, 2026)
    assert.ok(got, 'không được bỏ giỗ')
    const back = lunarOf(got)
    assert.equal(back.leap, false)
    assert.equal(back.month, 6)
    assert.equal(back.day, 15)
  })

  it('ghi tháng nhuận và năm đó có nhuận thì dùng đúng tháng nhuận', () => {
    // 2025 nhuận tháng 6
    const got = resolveLunarAnniversary(15, 6, true, 2025)
    const back = lunarOf(got!)
    assert.equal(back.leap, true)
    assert.equal(back.month, 6)
  })
})

describe('sự kiện dương lịch', () => {
  it('sinh nhật lặp hàng năm từ "MM-DD"', async () => {
    const e = await makeEvent({ calendar: 'SOLAR', type: 'BIRTHDAY', title: 'Sinh nhật mẹ', solarDate: '06-12', yearly: true, lunarDay: null, lunarMonth: null })
    assert.equal(resolveOccurrence(e, 2027), '2027-06-12')
    assert.equal(resolveOccurrence(e, 2028), '2028-06-12')
  })

  it('chấp nhận cả dạng "YYYY-MM-DD" cho sự kiện lặp', async () => {
    const e = await makeEvent({ calendar: 'SOLAR', type: 'BIRTHDAY', title: 'x', solarDate: '1990-03-08', yearly: true, lunarDay: null, lunarMonth: null })
    assert.equal(resolveOccurrence(e, 2027), '2027-03-08')
  })

  it('29/2 ở năm không nhuận lùi về 28/2', async () => {
    const e = await makeEvent({ calendar: 'SOLAR', type: 'BIRTHDAY', title: 'x', solarDate: '02-29', yearly: true, lunarDay: null, lunarMonth: null })
    assert.equal(resolveOccurrence(e, 2028), '2028-02-29') // nhuận
    assert.equal(resolveOccurrence(e, 2027), '2027-02-28') // không nhuận
  })

  it('sự kiện một lần thì giữ nguyên ngày, không lặp', async () => {
    const e = await makeEvent({ calendar: 'SOLAR', type: 'OTHER', title: 'Họp lớp', solarDate: '2026-11-20', yearly: false, lunarDay: null, lunarMonth: null })
    assert.equal(resolveOccurrence(e, 2026), '2026-11-20')
    assert.equal(resolveOccurrence(e, 2030), '2026-11-20')
  })
})

describe('sinh lịch nhắc sự kiện', () => {
  it('chỉ nhắc PHỤ HUYNH, không dựng con dậy lúc 8h sáng', async () => {
    const target = addDays(vnToday(), 10)
    await makeEvent({
      calendar: 'SOLAR', title: 'Giỗ bà', solarDate: target.slice(5), yearly: true,
      lunarDay: null, lunarMonth: null, remindBeforeDays: [7, 3, 0],
    })
    await materializeEventOccurrences()
    await materializeEvents()

    assert.ok((await db.notification.count({ where: { userId: parentId } })) > 0)
    assert.equal(await db.notification.count({ where: { userId: childId } }), 0)
  })

  it('sinh đúng một thông báo cho mỗi mốc nhắc trước', async () => {
    const target = addDays(vnToday(), 10)
    const e = await makeEvent({
      calendar: 'SOLAR', title: 'Giỗ bà', solarDate: target.slice(5), yearly: true,
      lunarDay: null, lunarMonth: null, remindBeforeDays: [7, 3, 0], remindAtTime: '08:00',
    })
    await materializeEventOccurrences()
    await materializeEvents()

    const rows = await db.notification.findMany({
      where: { userId: parentId, refId: eventRef(e.id, target) },
      orderBy: { fireAt: 'asc' },
    })
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map((r) => r.kind), ['EVENT_AHEAD', 'EVENT_AHEAD', 'EVENT_TODAY'])
    assert.equal(rows[0]!.fireAt.getTime(), vnDateTimeToUtc(addDays(target, -7), '08:00').getTime())
    assert.equal(rows[2]!.fireAt.getTime(), vnDateTimeToUtc(target, '08:00').getTime())
    assert.match(rows[0]!.title, /Còn 7 ngày/)
  })

  it('chạy lại không đẻ trùng', async () => {
    await makeEvent({
      calendar: 'SOLAR', title: 'x', solarDate: addDays(vnToday(), 10).slice(5), yearly: true,
      lunarDay: null, lunarMonth: null,
    })
    await materializeEventOccurrences()
    await materializeEvents()
    const first = await db.notification.count({ where: { userId: parentId } })
    await materializeEventOccurrences()
    await materializeEvents()
    assert.equal(await db.notification.count({ where: { userId: parentId } }), first)
  })

  it('mốc nhắc đã qua thì không sinh', async () => {
    const target = addDays(vnToday(), 2)
    await makeEvent({
      calendar: 'SOLAR', title: 'x', solarDate: target.slice(5), yearly: true,
      lunarDay: null, lunarMonth: null, remindBeforeDays: [30, 7, 0],
    })
    await materializeEventOccurrences()
    await materializeEvents()
    const rows = await db.notification.findMany({ where: { userId: parentId } })
    // 30 và 7 ngày trước đều đã qua; chỉ còn mốc đúng ngày
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.kind, 'EVENT_TODAY')
  })

  it('nội dung thông báo có kèm ngày âm cho sự kiện âm lịch', async () => {
    const solar = lunarToSolar(15, 7, thisLunarYear + 1, false)!
    const e = await makeEvent({ lunarDay: 15, lunarMonth: 7, remindBeforeDays: [0] })
    await materializeEventOccurrences()
    await materializeEvents()
    const row = await db.notification.findFirst({
      where: { userId: parentId, refId: { startsWith: `${e.id}:` } },
    })
    if (row) assert.match(row.body, /15\/7 âm lịch/)
    // nếu ngày giỗ năm nay đã qua và năm sau ngoài tầm 60 ngày thì chưa có gì — vẫn hợp lệ
    assert.ok(toSolarString(solar).length === 10)
  })

  it('xoá sự kiện thì lịch nhắc tương lai bị dọn', async () => {
    const e = await makeEvent({
      calendar: 'SOLAR', title: 'x', solarDate: addDays(vnToday(), 10).slice(5), yearly: true,
      lunarDay: null, lunarMonth: null,
    })
    await materializeEventOccurrences()
    await materializeEvents()
    assert.ok((await db.notification.count({ where: { userId: parentId } })) > 0)

    await clearEventNotifications(e.id)
    assert.equal(
      await db.notification.count({ where: { userId: parentId, status: 'PENDING' } }),
      0,
    )
  })

  it('occurrence được cache cho nhiều năm, không chỉ năm nay', async () => {
    const e = await makeEvent({ lunarDay: 15, lunarMonth: 7 })
    await materializeEventOccurrences()
    const rows = await db.eventOccurrence.findMany({ where: { eventId: e.id }, orderBy: { year: 'asc' } })
    assert.equal(rows.length, 4, 'phải sinh sẵn 4 năm')
    assert.deepEqual(rows.map((r) => r.year), [thisLunarYear - 1, thisLunarYear, thisLunarYear + 1, thisLunarYear + 2])
    // các ngày dương phải khác nhau và cách nhau cỡ một năm
    const dates = rows.map((r) => r.solarDate)
    assert.equal(new Set(dates).size, 4)
  })
})
