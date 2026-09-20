import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { occurrencesBetween, occursOn } from '../src/lib/recurrence.js'
import { addDays, diffDays, isoWeekday, startOfWeek, vnDateOf, vnDateTimeToUtc, vnTimeOf } from '../src/lib/time.js'
import { inQuietHours } from '../src/notifications/materialize.js'

describe('time — múi giờ VN', () => {
  it('vnDateTimeToUtc trừ đúng 7 giờ', () => {
    assert.equal(vnDateTimeToUtc('2026-09-20', '06:00').toISOString(), '2026-09-19T23:00:00.000Z')
    assert.equal(vnDateTimeToUtc('2026-09-20', '21:00').toISOString(), '2026-09-20T14:00:00.000Z')
  })

  it('ngày VN vắt qua nửa đêm UTC vẫn đúng', () => {
    // 2026-09-20 00:30 giờ VN = 2026-09-19 17:30 UTC — vẫn phải là ngày 20
    const d = vnDateTimeToUtc('2026-09-20', '00:30')
    assert.equal(d.toISOString(), '2026-09-19T17:30:00.000Z')
    assert.equal(vnDateOf(d), '2026-09-20')
    assert.equal(vnTimeOf(d), '00:30')
  })

  it('vnDateOf ngay trước và sau mốc đổi ngày VN', () => {
    assert.equal(vnDateOf(new Date('2026-09-19T16:59:59Z')), '2026-09-19')
    assert.equal(vnDateOf(new Date('2026-09-19T17:00:00Z')), '2026-09-20')
  })

  it('addDays qua biên tháng và năm', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    assert.equal(addDays('2026-03-01', -1), '2026-02-28')
    assert.equal(addDays('2028-03-01', -1), '2028-02-29') // năm nhuận
  })

  it('diffDays và isoWeekday', () => {
    assert.equal(diffDays('2026-09-20', '2026-09-27'), 7)
    assert.equal(diffDays('2026-09-27', '2026-09-20'), -7)
    assert.equal(isoWeekday('2026-09-20'), 7) // chủ nhật
    assert.equal(isoWeekday('2026-09-21'), 1) // thứ hai
  })

  it('startOfWeek luôn là thứ hai', () => {
    assert.equal(startOfWeek('2026-09-20'), '2026-09-14') // CN -> T2 tuần đó
    assert.equal(startOfWeek('2026-09-21'), '2026-09-21') // T2 -> chính nó
  })
})

describe('recurrence — RRULE', () => {
  it('hàng ngày', () => {
    assert.equal(occursOn('FREQ=DAILY', '2026-09-01', '2026-09-20'), true)
    assert.equal(occursOn('FREQ=DAILY', '2026-09-21', '2026-09-20'), false) // trước startDate
  })

  it('các ngày trong tuần bỏ qua T7/CN', () => {
    const r = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    assert.equal(occursOn(r, '2026-09-01', '2026-09-18'), true)  // thứ 6
    assert.equal(occursOn(r, '2026-09-01', '2026-09-19'), false) // thứ 7
    assert.equal(occursOn(r, '2026-09-01', '2026-09-20'), false) // chủ nhật
    assert.equal(occursOn(r, '2026-09-01', '2026-09-21'), true)  // thứ 2
  })

  it('occurrencesBetween trả đúng các ngày đã chọn', () => {
    const days = occurrencesBetween('FREQ=WEEKLY;BYDAY=TU,TH,SA', '2026-09-01', '2026-09-14', '2026-09-20')
    assert.deepEqual(days, ['2026-09-15', '2026-09-17', '2026-09-19'])
  })

  it('không trả ngày trước startDate', () => {
    const days = occurrencesBetween('FREQ=DAILY', '2026-09-18', '2026-09-14', '2026-09-20')
    assert.deepEqual(days, ['2026-09-18', '2026-09-19', '2026-09-20'])
  })
})

describe('giờ yên lặng', () => {
  it('tắt khi chưa đặt', () => {
    assert.equal(inQuietHours('23:00', null, null), false)
    assert.equal(inQuietHours('23:00', '22:00', null), false)
  })

  it('khoảng trong cùng một ngày', () => {
    assert.equal(inQuietHours('13:30', '12:00', '14:00'), true)
    assert.equal(inQuietHours('14:00', '12:00', '14:00'), false) // biên phải là mở
    assert.equal(inQuietHours('12:00', '12:00', '14:00'), true)  // biên trái là đóng
    assert.equal(inQuietHours('11:59', '12:00', '14:00'), false)
  })

  it('khoảng vắt qua nửa đêm', () => {
    assert.equal(inQuietHours('23:30', '22:30', '06:00'), true)
    assert.equal(inQuietHours('02:00', '22:30', '06:00'), true)
    assert.equal(inQuietHours('05:59', '22:30', '06:00'), true)
    assert.equal(inQuietHours('06:00', '22:30', '06:00'), false)
    assert.equal(inQuietHours('12:00', '22:30', '06:00'), false)
  })
})
