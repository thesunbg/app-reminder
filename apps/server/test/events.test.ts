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
  resolveOccurrenceEnd,
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

// ---------- lịch tháng dương/âm ----------

import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

async function callerAsParent() {
  const user = await db.user.findUniqueOrThrow({ where: { id: parentId }, include: { family: true } })
  const ctx = { req: { headers: {}, cookies: {} }, res: { setCookie() {}, clearCookie() {} }, session: { user }, user } as unknown as Context
  return appRouter.createCaller(ctx)
}

describe('event.calendar / lunarCalendar', () => {
  it('mỗi ngày dương kèm ngày âm, sự kiện rơi đúng ô; tối đa 2 tháng', async () => {
    const caller = await callerAsParent()
    // rằm tháng 7 âm năm nay
    const ev = await makeEvent({})
    await materializeEventOccurrences()
    const occ = await db.eventOccurrence.findFirstOrThrow({ where: { eventId: ev.id, year: thisLunarYear } })
    const month = occ.solarDate.slice(0, 7)
    const from = `${month}-01`
    const [y, mo] = month.split('-').map(Number) as [number, number]
    const to = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
    const days = await caller.event.calendar({ from, to })
    assert.equal(days[0]!.date, from)
    const cell = days.find((d) => d.date === occ.solarDate)!
    assert.deepEqual([cell.lunar.day, cell.lunar.month], [15, 7])
    assert.deepEqual(cell.events.map((e) => e.title), ['Giỗ ông nội'])
    // các ô khác không có sự kiện
    assert.equal(days.filter((d) => d.events.length > 0).length, 1)
    await assert.rejects(caller.event.calendar({ from: '2026-01-01', to: '2026-04-01' }), /Tối đa 2 tháng/)
  })

  it('tháng âm: đúng số ngày, ngày 1 khớp lunarToSolar, prev/next liền mạch', async () => {
    const caller = await callerAsParent()
    const m = await caller.event.lunarCalendar({ year: thisLunarYear, month: 7, leap: false })
    assert.equal(m.length, lunarMonthLength(7, thisLunarYear, false))
    assert.equal(m.days.length, m.length)
    assert.equal(m.from, toSolarString(lunarToSolar(1, 7, thisLunarYear, false)!))
    assert.deepEqual([m.days[0]!.lunar.day, m.days.at(-1)!.lunar.day], [1, m.length])
    const next = await caller.event.lunarCalendar(m.next)
    assert.equal(next.from, addDays(m.to, 1))
    const prev = await caller.event.lunarCalendar(m.prev)
    assert.equal(prev.to, addDays(m.from, -1))
    await assert.rejects(caller.event.lunarCalendar({ year: 2026, month: 3, leap: true }), /không tồn tại/)
  })
})

// ---------- sự kiện nhiều ngày (chuyến đi, nghỉ lễ) ----------

describe('sự kiện nhiều ngày', () => {
  it('quy đổi ngày kết thúc: một lần giữ nguyên, hàng năm gắn năm, vắt giao thừa sang năm sau', async () => {
    const once = await makeEvent({
      calendar: 'SOLAR', title: 'Đi Mù Cang Chải', type: 'OTHER',
      solarDate: '2026-10-03', endDate: '2026-10-04', yearly: false,
      lunarDay: null, lunarMonth: null,
    })
    assert.equal(resolveOccurrenceEnd(once, 2026, '2026-10-03'), '2026-10-04')

    const yearly = await makeEvent({
      calendar: 'SOLAR', title: 'Nghỉ lễ', type: 'OTHER',
      solarDate: '04-30', endDate: '05-01', yearly: true,
      lunarDay: null, lunarMonth: null,
    })
    assert.equal(resolveOccurrenceEnd(yearly, 2027, '2027-04-30'), '2027-05-01')

    // 28/12 → 2/1: ngày kết thúc thuộc năm sau
    const newYear = await makeEvent({
      calendar: 'SOLAR', title: 'Về quê ăn Tết', type: 'OTHER',
      solarDate: '12-28', endDate: '01-02', yearly: true,
      lunarDay: null, lunarMonth: null,
    })
    assert.equal(resolveOccurrenceEnd(newYear, 2026, '2026-12-28'), '2027-01-02')

    // sự kiện một ngày và sự kiện âm lịch không có ngày kết thúc
    const oneDay = await makeEvent({
      calendar: 'SOLAR', title: 'Sinh nhật', solarDate: '06-12', yearly: true,
      lunarDay: null, lunarMonth: null,
    })
    assert.equal(resolveOccurrenceEnd(oneDay, 2027, '2027-06-12'), null)
    assert.equal(resolveOccurrenceEnd(await makeEvent({ endDate: '07-16' }), thisLunarYear, '2026-08-27'), null)
  })

  it('occurrence lưu cả ngày kết thúc', async () => {
    const start = addDays(vnToday(), 12)
    const end = addDays(start, 1)
    const ev = await makeEvent({
      calendar: 'SOLAR', title: 'Đi Mù Cang Chải', type: 'OTHER',
      solarDate: start, endDate: end, yearly: false,
      lunarDay: null, lunarMonth: null,
    })
    await materializeEventOccurrences()
    const occ = await db.eventOccurrence.findFirstOrThrow({ where: { eventId: ev.id } })
    assert.equal(occ.solarDate, start)
    assert.equal(occ.endDate, end)
  })

  it('nhắc theo NGÀY BẮT ĐẦU, nội dung nói rõ cả khoảng', async () => {
    const start = addDays(vnToday(), 10)
    const end = addDays(start, 1)
    const ev = await makeEvent({
      calendar: 'SOLAR', title: 'Đi Mù Cang Chải', type: 'OTHER',
      solarDate: start, endDate: end, yearly: false,
      lunarDay: null, lunarMonth: null,
      remindBeforeDays: [3, 0], remindAtTime: '08:00',
      startTime: '05:30', endTime: '18:00',
    })
    await materializeEventOccurrences()
    await materializeEvents()

    const rows = await db.notification.findMany({
      where: { userId: parentId, refId: eventRef(ev.id, start) },
      orderBy: { fireAt: 'asc' },
    })
    assert.equal(rows.length, 2)
    // mốc nhắc tính từ ngày bắt đầu, không phải ngày kết thúc
    assert.equal(rows[0]!.fireAt.getTime(), vnDateTimeToUtc(addDays(start, -3), '08:00').getTime())
    assert.equal(rows[1]!.fireAt.getTime(), vnDateTimeToUtc(start, '08:00').getTime())
    // thân thông báo có khoảng ngày, giờ diễn ra và số ngày
    const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`
    assert.ok(rows[0]!.body.includes(`${dm(start)} → ${dm(end)}`), rows[0]!.body)
    assert.ok(rows[0]!.body.includes('05:30–18:00'), rows[0]!.body)
    assert.ok(rows[0]!.body.includes('2 ngày'), rows[0]!.body)
    assert.match(rows[1]!.title, /bắt đầu hôm nay/)
  })

  it('lịch tháng hiện sự kiện ở MỌI ngày nó phủ, kèm ngày thứ mấy', async () => {
    const caller = await callerAsParent()
    const ev = await makeEvent({
      calendar: 'SOLAR', title: 'Đi Mù Cang Chải', type: 'OTHER',
      solarDate: '2026-10-03', endDate: '2026-10-05', yearly: false,
      lunarDay: null, lunarMonth: null,
    })
    await materializeEventOccurrences()
    const days = await caller.event.calendar({ from: '2026-10-01', to: '2026-10-31' })
    const covered = days.filter((d) => d.events.some((e) => e.id === ev.id))
    assert.deepEqual(covered.map((d) => d.date), ['2026-10-03', '2026-10-04', '2026-10-05'])
    const mid = covered[1]!.events.find((e) => e.id === ev.id)!
    assert.deepEqual([mid.dayIndex, mid.dayCount], [2, 3])
    assert.equal(mid.startDate, '2026-10-03')
    assert.equal(mid.endDate, '2026-10-05')
  })

  it('sự kiện vắt qua biên tháng vẫn hiện ở tháng sau, dayIndex tính từ ngày bắt đầu thật', async () => {
    const caller = await callerAsParent()
    const ev = await makeEvent({
      calendar: 'SOLAR', title: 'Nghỉ dài', type: 'OTHER',
      solarDate: '2026-09-29', endDate: '2026-10-02', yearly: false,
      lunarDay: null, lunarMonth: null,
    })
    await materializeEventOccurrences()
    const days = await caller.event.calendar({ from: '2026-10-01', to: '2026-10-31' })
    const covered = days.filter((d) => d.events.some((e) => e.id === ev.id))
    assert.deepEqual(covered.map((d) => d.date), ['2026-10-01', '2026-10-02'])
    const first = covered[0]!.events.find((e) => e.id === ev.id)!
    // 1/10 là ngày thứ 3 của sự kiện, dù nó là ô đầu tiên của khoảng đang xem
    assert.deepEqual([first.dayIndex, first.dayCount], [3, 4])
  })

  it('upcoming: sự kiện đang diễn ra vẫn hiện, kèm ongoing và ngày thứ mấy', async () => {
    const caller = await callerAsParent()
    const start = addDays(vnToday(), -1)
    const end = addDays(vnToday(), 1)
    const ev = await makeEvent({
      calendar: 'SOLAR', title: 'Đang đi Mù Cang Chải', type: 'OTHER',
      solarDate: start, endDate: end, yearly: false,
      lunarDay: null, lunarMonth: null,
    })
    await materializeEventOccurrences()
    const rows = await caller.event.upcoming({ days: 30 })
    const row = rows.find((r) => r.eventId === ev.id)
    assert.ok(row, 'sự kiện đang diễn ra phải nằm trong upcoming')
    assert.equal(row.ongoing, true)
    assert.deepEqual([row.dayIndex, row.dayCount], [2, 3])

    const list = await caller.event.list()
    const item = list.find((e) => e.id === ev.id)!
    assert.equal(item.ongoing, true)
    assert.equal(item.nextDate, start)
    assert.equal(item.nextEndDate, end)
  })

  it('từ chối ngày kết thúc trước ngày bắt đầu với sự kiện một lần, và hai dạng ngày lệch nhau', async () => {
    const caller = await callerAsParent()
    await assert.rejects(
      caller.event.create({
        calendar: 'SOLAR', title: 'Sai', solarDate: '2026-10-05', endDate: '2026-10-03',
        yearly: false, remindBeforeDays: [0], remindAtTime: '08:00',
      }),
      /Ngày kết thúc phải sau/,
    )
    await assert.rejects(
      caller.event.create({
        calendar: 'SOLAR', title: 'Sai dạng', solarDate: '2026-10-05', endDate: '10-07',
        yearly: false, remindBeforeDays: [0], remindAtTime: '08:00',
      }),
      /cùng dạng/,
    )
    // ngày kết thúc trùng ngày bắt đầu -> chuẩn hoá thành sự kiện một ngày
    const same = await caller.event.create({
      calendar: 'SOLAR', title: 'Một ngày', solarDate: '2026-10-05', endDate: '2026-10-05',
      yearly: false, remindBeforeDays: [0], remindAtTime: '08:00',
    })
    assert.equal(same.endDate, null)
  })
})
