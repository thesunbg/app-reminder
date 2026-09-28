import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import {
  HOLIDAYS,
  holidayById,
  holidayDayMap,
  holidaysBetween,
  holidaysOn,
  remindOffsets,
} from '../src/lib/holidays.js'
import { lunarOf } from '../src/lib/lunar.js'
import { addDays, diffDays, vnDateOf, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'
import { clearHolidayNotifications, holidayBody, materializeHolidays } from '../src/notifications/holidays.js'

const MARK = `hol-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''

/** Ngày bắt đầu của một ngày lễ trong khoảng đang xét, hoặc null. */
function startOf(id: string, from: string, to: string): string | null {
  return holidaysBetween(from, to).find((o) => o.holiday.id === id)?.startDate ?? null
}

describe('danh mục lễ tết', () => {
  it('không có id trùng nhau', () => {
    const ids = new Set(HOLIDAYS.map((h) => h.id))
    assert.equal(ids.size, HOLIDAYS.length)
  })

  it('mọi ngày lễ đều quy đổi được cho mười năm tới', () => {
    const from = '2026-01-01'
    const to = '2035-12-31'
    const occ = holidaysBetween(from, to)
    for (const h of HOLIDAYS) {
      const mine = occ.filter((o) => o.holiday.id === h.id)
      // 10 năm phải có ít nhất 10 lần (lễ tháng Chạp có thể lệch một năm ở biên)
      assert.ok(mine.length >= 9, `${h.id} chỉ quy đổi được ${mine.length} lần trong 10 năm`)
      for (const o of mine) assert.match(o.startDate, /^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('số ngày nhắc trước đã bỏ trùng và sắp giảm dần', () => {
    for (const h of HOLIDAYS) {
      const offsets = remindOffsets(h)
      assert.deepEqual(offsets, [...offsets].sort((a, b) => b - a))
      assert.equal(new Set(offsets).size, offsets.length)
    }
  })

  it('tra được theo id, id lạ thì trả null', () => {
    assert.equal(holidayById('tet-nguyen-dan')?.title, 'Tết Nguyên Đán')
    assert.equal(holidayById('khong-co-ngay-nay'), null)
  })
})

describe('mốc lễ tết đã biết', () => {
  // đối chiếu với lịch thật, gồm cả năm nhuận âm lịch (2025 nhuận tháng 6)
  const CASES: Array<[string, string, string]> = [
    ['tet-nguyen-dan', '2025', '2025-01-29'],
    ['tet-nguyen-dan', '2026', '2026-02-17'],
    ['tet-nguyen-dan', '2027', '2027-02-06'],
    ['ong-cong-ong-tao', '2025', '2025-01-22'],
    ['tat-nien', '2025', '2025-01-28'],
    ['tet-nguyen-tieu', '2025', '2025-02-12'],
    ['tet-han-thuc', '2025', '2025-03-31'],
    ['gio-to-hung-vuong', '2025', '2025-04-07'],
    ['le-phat-dan', '2025', '2025-05-12'],
    ['tet-doan-ngo', '2025', '2025-05-31'],
    ['le-vu-lan', '2025', '2025-09-06'],
    ['tet-trung-thu', '2025', '2025-10-06'],
    ['tet-trung-thu', '2026', '2026-09-25'],
    ['quoc-khanh', '2025', '2025-09-02'],
    ['giai-phong-mien-nam', '2025', '2025-04-30'],
    ['nha-giao-viet-nam', '2025', '2025-11-20'],
  ]

  for (const [id, year, expected] of CASES) {
    it(`${id} ${year} rơi vào ${expected}`, () => {
      assert.equal(startOf(id, `${year}-01-01`, `${year}-12-31`), expected)
    })
  }

  it('Tất niên luôn là ngày cuối tháng Chạp, kể cả tháng thiếu', () => {
    for (let y = 2026; y <= 2040; y++) {
      const date = startOf('tat-nien', `${y}-01-01`, `${y}-12-31`)
      assert.ok(date, `không tìm thấy Tất niên năm ${y}`)
      const l = lunarOf(date)
      assert.equal(l.month, 12, `${date} phải nằm trong tháng Chạp`)
      assert.ok(l.day === 29 || l.day === 30, `${date} là ${l.day}/12 âm — phải là ngày cuối tháng`)
      // hôm sau đã là mùng 1 Tết
      assert.equal(lunarOf(addDays(date, 1)).day, 1)
      assert.equal(lunarOf(addDays(date, 1)).month, 1)
    }
  })

  it('Tết kéo ba ngày mùng 1–3', () => {
    const tet = holidaysBetween('2026-01-01', '2026-12-31').find((o) => o.holiday.id === 'tet-nguyen-dan')!
    assert.equal(tet.startDate, '2026-02-17')
    assert.equal(tet.endDate, '2026-02-19')
    assert.equal(tet.dayCount, 3)
    assert.equal(tet.lunar.day, 1)
    assert.equal(tet.lunar.month, 1)
  })
})

describe('quét theo khoảng', () => {
  it('lễ tháng Chạp của năm âm trước vẫn hiện ở đầu năm dương sau', () => {
    // Ông Táo 23/12 âm năm Ất Tỵ rơi vào 10/2/2026 dương
    const ids = holidaysBetween('2026-02-01', '2026-02-28').map((o) => o.holiday.id)
    assert.ok(ids.includes('ong-cong-ong-tao'))
    assert.ok(ids.includes('tat-nien'))
    assert.ok(ids.includes('tet-nguyen-dan'))
  })

  it('không trả trùng một lễ trong cùng một năm', () => {
    const seen = new Set<string>()
    for (const o of holidaysBetween('2020-01-01', '2030-12-31')) {
      const key = `${o.holiday.id}:${o.startDate}`
      assert.ok(!seen.has(key), `trùng ${key}`)
      seen.add(key)
    }
  })

  it('đã sắp theo ngày tăng dần', () => {
    const dates = holidaysBetween('2026-01-01', '2027-12-31').map((o) => o.startDate)
    assert.deepEqual(dates, [...dates].sort())
  })

  it('lễ bắt đầu TRƯỚC khoảng nhưng còn kéo dài sang thì vẫn được tính', () => {
    // Giáng sinh 24–25/12: hỏi riêng ngày 25 vẫn phải thấy
    const on25 = holidaysOn('2026-12-25').map((o) => o.holiday.id)
    assert.ok(on25.includes('giang-sinh'))
    assert.equal(holidaysOn('2026-12-26').length, 0)
  })

  it('khoảng ngược (to < from) trả mảng rỗng', () => {
    assert.deepEqual(holidaysBetween('2026-05-01', '2026-04-01'), [])
  })

  it('holidayDayMap đánh số ngày thứ mấy trong lễ', () => {
    const map = holidayDayMap('2026-02-17', '2026-02-19')
    assert.equal(map.get('2026-02-17')?.[0]?.dayIndex, 1)
    assert.equal(map.get('2026-02-18')?.[0]?.dayIndex, 2)
    assert.equal(map.get('2026-02-19')?.[0]?.dayIndex, 3)
  })

  it('holidayDayMap cắt đúng phần nằm trong khoảng', () => {
    // chỉ hỏi ngày giữa của Tết: vẫn thấy, và là ngày 2
    const map = holidayDayMap('2026-02-18', '2026-02-18')
    const tet = map.get('2026-02-18')?.find((h) => h.holiday.id === 'tet-nguyen-dan')
    assert.ok(tet)
    assert.equal(tet.dayIndex, 2)
    assert.equal(map.get('2026-02-17'), undefined)
  })
})

describe('nội dung thông báo lễ', () => {
  it('ghi cả ngày dương, ngày âm và việc được nghỉ', () => {
    const tet = holidaysOn('2026-02-17').find((o) => o.holiday.id === 'tet-nguyen-dan')!
    const body = holidayBody(tet)
    assert.match(body, /17\/2/)
    assert.match(body, /1\/1 âm lịch/)
    assert.match(body, /3 ngày/)
    assert.match(body, /được nghỉ/)
  })

  it('lễ không được nghỉ thì không nói là được nghỉ', () => {
    const nhaGiao = holidaysOn('2026-11-20').find((o) => o.holiday.id === 'nha-giao-viet-nam')!
    assert.doesNotMatch(holidayBody(nhaGiao), /được nghỉ/)
  })
})

// ---------- nhắc lễ (cần DB) ----------

/**
 * Mốc thời gian giả cho phần nhắc: 20 ngày trước cái Tết kế tiếp.
 *
 * Không dùng "bây giờ" vì có quãng trong năm (tháng 7 dương) không ngày lễ nào
 * rơi vào 60 ngày tới, chạy test hôm đó là đỏ oan. Mốc này luôn nằm ở TƯƠNG LAI
 * thật nên `clearHolidayNotifications` (xoá theo giờ thật) vẫn dọn được.
 */
const NEXT_TET = holidaysBetween(vnToday(), addDays(vnToday(), 800)).find(
  (o) => o.holiday.id === 'tet-nguyen-dan' && diffDays(vnToday(), o.startDate) > 25,
)!
const NOW = vnDateTimeToUtc(addDays(NEXT_TET.startDate, -20), '05:00')

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const parent = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}-p@test.local`, passwordHash: 'x', role: 'PARENT',
      // môi trường test không có TELEGRAM_BOT_TOKEN nên chỉ Web Push được xếp vào
      telegramChatId: '111', notifyTelegram: true, notifyWebPush: true, notifyNative: false,
    },
  })
  parentId = parent.id
  const child = await db.user.create({
    data: {
      familyId, name: 'Con', email: `${MARK}-c@test.local`, passwordHash: 'x', role: 'CHILD',
      telegramChatId: '222', notifyTelegram: true, notifyWebPush: true, notifyNative: false,
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
  await db.user.updateMany({ where: { id: { in: [parentId, childId] } }, data: { notifyHolidays: true } })
})

const mine = (userId: string) =>
  db.notification.findMany({ where: { userId, refTable: 'holiday' }, orderBy: { fireAt: 'asc' } })

describe('sinh lịch nhắc lễ', () => {
  it('nhắc CẢ NHÀ, không riêng phụ huynh — Trung Thu là của bọn trẻ', async () => {
    await materializeHolidays(NOW)
    assert.ok((await mine(parentId)).length > 0)
    assert.ok((await mine(childId)).length > 0, 'con cũng phải được nhắc')
  })

  it('chạy lại không đẻ thêm bản trùng', async () => {
    const first = await materializeHolidays(NOW)
    const again = await materializeHolidays(NOW)
    assert.ok(first > 0)
    assert.equal(again, 0)
  })

  it('chỉ nhắc ngày lễ có bật remind, và bắn lúc 8h sáng giờ VN', async () => {
    await materializeHolidays(NOW)
    const rows = await mine(parentId)
    for (const n of rows) {
      const [id, date] = n.refId.split(':') as [string, string]
      const h = holidayById(id)
      assert.ok(h?.remind, `${id} không bật nhắc mà vẫn sinh thông báo`)
      const offsets = remindOffsets(h)
      const fired = rows.filter((r) => r.refId === n.refId).length
      assert.ok(fired <= offsets.length)
      // fireAt = (ngày lễ - N ngày) lúc 08:00 VN, với N nằm trong danh sách
      const ok = offsets.some((d) => vnDateTimeToUtc(addDays(date, -d), '08:00').getTime() === n.fireAt.getTime())
      assert.ok(ok, `fireAt ${n.fireAt.toISOString()} không khớp mốc nhắc nào của ${id}`)
    }
  })

  it('tắt notifyHolidays thì không sinh nữa', async () => {
    await db.user.update({ where: { id: childId }, data: { notifyHolidays: false } })
    await materializeHolidays(NOW)
    assert.equal((await mine(childId)).length, 0)
    assert.ok((await mine(parentId)).length > 0, 'người còn bật vẫn phải được nhắc')
  })

  it('người đã tắt hết kênh gửi thì bỏ qua', async () => {
    await db.user.update({
      where: { id: childId },
      data: { notifyTelegram: false, notifyWebPush: false, notifyNative: false },
    })
    await materializeHolidays(NOW)
    assert.equal((await mine(childId)).length, 0)
    await db.user.update({ where: { id: childId }, data: { notifyTelegram: true, notifyWebPush: true } })
  })

  it('giờ yên lặng phủ 8h sáng thì không nhắc', async () => {
    await db.user.update({ where: { id: childId }, data: { quietFrom: '07:00', quietTo: '09:00' } })
    await materializeHolidays(NOW)
    assert.equal((await mine(childId)).length, 0)
    await db.user.update({ where: { id: childId }, data: { quietFrom: null, quietTo: null } })
  })

  it('không sinh thông báo cho mốc đã qua', async () => {
    await materializeHolidays(NOW)
    for (const n of await mine(parentId)) {
      assert.ok(n.fireAt.getTime() > NOW.getTime(), `${n.refId} bắn vào quá khứ`)
    }
  })

  it('chỉ sinh trong tầm 60 ngày tới', async () => {
    await materializeHolidays(NOW)
    const limit = vnDateTimeToUtc(addDays(vnDateOf(NOW), 61), '00:00').getTime()
    for (const n of await mine(parentId)) {
      assert.ok(n.fireAt.getTime() < limit, `${n.refId} vượt quá chân trời 60 ngày`)
    }
  })

  it('Tết được nhắc trước hai tuần — đủ thời gian sắm sửa', async () => {
    await materializeHolidays(NOW)
    const tet = (await mine(parentId)).filter((n) => n.refId.startsWith('tet-nguyen-dan:'))
    assert.ok(tet.length > 0, 'phải có nhắc Tết')
    const earliest = tet[0]!.fireAt
    assert.equal(earliest.getTime(), vnDateTimeToUtc(addDays(NEXT_TET.startDate, -14), '08:00').getTime())
    assert.match(tet[0]!.title, /Còn 14 ngày/)
  })

  it('tắt nhắc thì dọn sạch lịch còn treo', async () => {
    await materializeHolidays(NOW)
    assert.ok((await mine(parentId)).length > 0)
    const removed = await clearHolidayNotifications(parentId)
    assert.ok(removed > 0)
    assert.equal((await mine(parentId)).length, 0)
    assert.ok((await mine(childId)).length > 0, 'không được xoá nhầm của người khác')
  })
})
