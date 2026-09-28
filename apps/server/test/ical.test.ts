/**
 * Lịch .ics — định dạng RFC 5545 rất dễ sai một cách im lặng: phần mềm lịch bên
 * kia chỉ báo "không hợp lệ" chứ không nói sai ở đâu, và không thử được bằng
 * tay nếu chưa có iPhone trong tay.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { buildFamilyCalendar, hashIcalToken, newIcalToken } from '../src/ical.js'
import { materializeEventOccurrences } from '../src/notifications/events.js'
import { addDays, vnToday } from '../src/lib/time.js'

const MARK = `ics-${Date.now()}`
let familyId = ''

before(async () => {
  const family = await db.family.create({ data: { name: 'Gia đình Đỗ; nhà "số 4"' } })
  familyId = family.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

/** Bung phần gấp dòng để so sánh nội dung cho dễ. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n')
}

describe('token đăng ký lịch', () => {
  it('token mới mỗi lần và hash ổn định', () => {
    const a = newIcalToken()
    const b = newIcalToken()
    assert.notEqual(a, b)
    assert.equal(hashIcalToken(a), hashIcalToken(a))
    assert.notEqual(hashIcalToken(a), hashIcalToken(b))
    assert.equal(hashIcalToken(a).length, 64, 'SHA-256 dạng hex')
    assert.ok(!hashIcalToken(a).includes(a), 'hash không được chứa token thô')
  })
})

describe('soạn file .ics', () => {
  it('khung VCALENDAR đúng chuẩn, dòng kết thúc bằng CRLF', async () => {
    const ics = await buildFamilyCalendar(familyId, 'Gia đình Đỗ')
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
    const lines = unfold(ics)
    assert.ok(lines.includes('VERSION:2.0'))
    assert.ok(lines.includes('CALSCALE:GREGORIAN'))
    assert.ok(lines.includes('BEGIN:VTIMEZONE'), 'phải khai múi giờ VN')
    assert.ok(lines.includes('TZID:Asia/Ho_Chi_Minh'))
    assert.ok(lines.some((l) => l.startsWith('TZOFFSETTO:+0700')))
  })

  it('escape đúng dấu ; , và nháy trong tên', async () => {
    const ics = await buildFamilyCalendar(familyId, 'Gia đình Đỗ; nhà "số 4", tầng 2')
    const name = unfold(ics).find((l) => l.startsWith('X-WR-CALNAME:'))!
    assert.match(name, /Gia đình Đỗ\\; nhà "số 4"\\, tầng 2/)
  })

  it('mỗi dòng gấp ở 75 octet và không cắt giữa một ký tự tiếng Việt', async () => {
    const event = await db.event.create({
      data: {
        familyId, calendar: 'SOLAR', yearly: true, solarDate: '06-15', type: 'OTHER',
        title: 'Kỷ niệm ngày cưới của ông bà nội, tổ chức ở nhà hàng Hương Sen phố Nguyễn Chí Thanh',
        remindBeforeDays: [0],
      },
    })
    await materializeEventOccurrences()
    const ics = await buildFamilyCalendar(familyId, 'Đỗ')

    for (const line of ics.split('\r\n')) {
      assert.ok(Buffer.byteLength(line) <= 76, `dòng dài ${Buffer.byteLength(line)} byte: ${line.slice(0, 40)}`)
    }
    // bung ra phải khôi phục nguyên văn tiêu đề, không sót ký tự rác
    assert.ok(unfold(ics).some((l) => l.includes('phố Nguyễn Chí Thanh')), 'gấp dòng làm vỡ chữ có dấu')

    await db.event.delete({ where: { id: event.id } })
  })

  it('sự kiện cả ngày dùng DTEND là ngày SAU ngày cuối (biên mở)', async () => {
    const start = addDays(vnToday(), 10)
    const end = addDays(start, 2)
    const event = await db.event.create({
      data: {
        familyId, calendar: 'SOLAR', yearly: false, solarDate: start, endDate: end,
        type: 'OTHER', title: 'Đi Mù Cang Chải', remindBeforeDays: [0],
      },
    })
    await materializeEventOccurrences()
    const lines = unfold(await buildFamilyCalendar(familyId, 'Đỗ'))

    const i = lines.findIndex((l) => l.includes('Đi Mù Cang Chải'))
    assert.ok(i > 0)
    const block = lines.slice(Math.max(0, i - 6), i + 3).join('\n')
    assert.ok(block.includes(`DTSTART;VALUE=DATE:${start.replace(/-/g, '')}`))
    assert.ok(
      block.includes(`DTEND;VALUE=DATE:${addDays(end, 1).replace(/-/g, '')}`),
      'chuyến 3 ngày mà DTEND trùng ngày cuối thì Lịch iPhone hiện thiếu một ngày',
    )

    await db.event.delete({ where: { id: event.id } })
  })

  it('sự kiện có giờ dùng TZID và có giờ kết thúc', async () => {
    const date = addDays(vnToday(), 5)
    const event = await db.event.create({
      data: {
        familyId, calendar: 'SOLAR', yearly: false, solarDate: date,
        startTime: '07:30', endTime: '17:00',
        type: 'OTHER', title: 'Đi Tam Đảo', remindBeforeDays: [0],
      },
    })
    await materializeEventOccurrences()
    const lines = unfold(await buildFamilyCalendar(familyId, 'Đỗ'))
    const i = lines.findIndex((l) => l.includes('Đi Tam Đảo'))
    const block = lines.slice(Math.max(0, i - 6), i + 3).join('\n')

    assert.ok(block.includes(`DTSTART;TZID=Asia/Ho_Chi_Minh:${date.replace(/-/g, '')}T073000`))
    assert.ok(block.includes(`DTEND;TZID=Asia/Ho_Chi_Minh:${date.replace(/-/g, '')}T170000`))

    await db.event.delete({ where: { id: event.id } })
  })

  it('sự kiện có giờ bắt đầu mà không có giờ kết thúc thì dài một tiếng', async () => {
    const date = addDays(vnToday(), 6)
    const event = await db.event.create({
      data: {
        familyId, calendar: 'SOLAR', yearly: false, solarDate: date, startTime: '09:15',
        type: 'OTHER', title: 'Khám răng', remindBeforeDays: [0],
      },
    })
    await materializeEventOccurrences()
    const lines = unfold(await buildFamilyCalendar(familyId, 'Đỗ'))
    const i = lines.findIndex((l) => l.includes('Khám răng'))
    const block = lines.slice(Math.max(0, i - 6), i + 3).join('\n')
    assert.ok(block.includes('T091500'))
    assert.ok(block.includes('T101500'), 'thiếu DTEND thì nhiều phần mềm lịch nuốt trọn cả ngày')

    await db.event.delete({ where: { id: event.id } })
  })

  it('ngày giỗ âm lịch kèm ngày âm trong mô tả', async () => {
    const event = await db.event.create({
      data: {
        familyId, calendar: 'LUNAR', lunarDay: 15, lunarMonth: 7, type: 'DEATH_ANNIVERSARY',
        title: 'Giỗ ông nội', remindBeforeDays: [0],
      },
    })
    await materializeEventOccurrences()
    const lines = unfold(await buildFamilyCalendar(familyId, 'Đỗ'))
    const i = lines.findIndex((l) => l.includes('Giỗ ông nội'))
    assert.ok(i > 0, 'phải có ngày giỗ trong lịch')
    assert.ok(lines.slice(i, i + 3).some((l) => l.startsWith('DESCRIPTION:') && l.includes('15/7 âm lịch')))

    await db.event.delete({ where: { id: event.id } })
  })

  it('có lễ tết Việt Nam, không cần nhà nào tự thêm', async () => {
    const ics = await buildFamilyCalendar(familyId, 'Đỗ')
    assert.match(ics, /Tết Nguyên Đán|Quốc khánh|Tết Trung Thu/)
  })

  it('UID duy nhất cho từng lần xuất hiện', async () => {
    const event = await db.event.create({
      data: {
        familyId, calendar: 'LUNAR_MONTHLY', lunarDay: 1, type: 'OTHER',
        title: 'Thắp hương mùng 1', remindBeforeDays: [0],
      },
    })
    await materializeEventOccurrences()
    const uids = unfold(await buildFamilyCalendar(familyId, 'Đỗ')).filter((l) => l.startsWith('UID:'))
    assert.ok(uids.length > 12, `mới có ${uids.length} sự kiện`)
    assert.equal(new Set(uids).size, uids.length, 'UID trùng thì phần mềm lịch gộp mất sự kiện')

    await db.event.delete({ where: { id: event.id } })
  })

  it('không xuất việc định kỳ — lịch hệ thống không hiểu vòng đời của chúng', async () => {
    const user = await db.user.create({
      data: { familyId, name: 'Bố', email: `${MARK}@test.local`, passwordHash: 'x', role: 'PARENT' },
    })
    await db.routine.create({
      data: {
        familyId, ownerId: user.id, title: 'Tập thể dục buổi sáng', category: 'Sức khoẻ',
        durationMin: 30, timeOfDay: '05:30', rrule: 'FREQ=DAILY', startDate: vnToday(),
      },
    })
    const ics = await buildFamilyCalendar(familyId, 'Đỗ')
    assert.ok(!ics.includes('Tập thể dục buổi sáng'))
  })
})
