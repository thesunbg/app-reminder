/**
 * Logic cộng dồn của agent. Chạy bằng `node --test`, không cần cài gì —
 * agent cố ý không có dependency nào.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Tracker, vnDate } from '../src/tracker.js'

/** 2026-09-21 09:00 giờ VN */
const NOON = Date.parse('2026-09-21T09:00:00+07:00')
/** 2026-09-21 23:59:50 giờ VN — sát nửa đêm */
const LATE = Date.parse('2026-09-21T23:59:50+07:00')
/** 2026-09-22 00:00:10 giờ VN */
const NEXT = Date.parse('2026-09-22T00:00:10+07:00')

describe('ngày theo giờ VN', () => {
  it('quy đổi theo UTC+7 chứ không theo giờ máy', () => {
    // 23:30 ngày 21 giờ VN = 16:30 UTC cùng ngày
    assert.equal(vnDate(Date.parse('2026-09-21T16:30:00Z')), '2026-09-21')
    // 00:30 ngày 22 giờ VN = 17:30 ngày 21 UTC — chỗ dễ sai nhất
    assert.equal(vnDate(Date.parse('2026-09-21T17:30:00Z')), '2026-09-22')
  })
})

describe('cộng dồn', () => {
  it('cộng giây theo từng app', () => {
    const t = new Tracker('2026-09-21')
    t.add('Chrome', 20, NOON)
    t.add('Chrome', 20, NOON)
    t.add('Code', 20, NOON)

    assert.deepEqual(t.report(), {
      date: '2026-09-21',
      samples: [{ app: 'Chrome', minutes: 1 }],
    })
    assert.equal(t.seconds.get('Code'), 20)
  })

  it('app = null (máy rảnh hoặc không xác định) thì không cộng cho ai', () => {
    const t = new Tracker('2026-09-21')
    t.add(null, 20, NOON)
    t.add(null, 20, NOON)
    assert.deepEqual(t.report().samples, [])
  })

  it('giữ giây rồi mới quy ra phút — không làm tròn từng mẫu', () => {
    const t = new Tracker('2026-09-21')
    // 5 mẫu 20 giây = 100 giây. Làm tròn từng mẫu thì ra 0; đúng phải là 2.
    for (let i = 0; i < 5; i++) t.add('Zalo', 20, NOON)
    assert.deepEqual(t.report().samples, [{ app: 'Zalo', minutes: 2 }])
  })

  it('xếp app nhiều phút nhất lên đầu', () => {
    const t = new Tracker('2026-09-21')
    t.add('Ít', 60, NOON)
    t.add('Nhiều', 600, NOON)
    t.add('Vừa', 300, NOON)
    assert.deepEqual(t.report().samples.map((s) => s.app), ['Nhiều', 'Vừa', 'Ít'])
  })
})

describe('sang ngày mới', () => {
  it('trả lại ngày vừa xong để gửi lần cuối, rồi bắt đầu lại từ 0', () => {
    const t = new Tracker('2026-09-21')
    t.add('Chrome', 600, LATE)

    const finished = t.add('Chrome', 20, NEXT)

    assert.deepEqual(finished, { date: '2026-09-21', samples: [{ app: 'Chrome', minutes: 10 }] })
    assert.equal(t.date, '2026-09-22')
    assert.deepEqual(t.report(), { date: '2026-09-22', samples: [] })
    assert.equal(t.seconds.get('Chrome'), 20, 'mẫu của lần gọi này thuộc về ngày mới')
  })

  it('ngày cũ trống thì không trả về gì để gửi', () => {
    const t = new Tracker('2026-09-21')
    assert.equal(t.add('Chrome', 20, NEXT), null)
    assert.equal(t.date, '2026-09-22')
  })
})

describe('khôi phục sau khi khởi động lại', () => {
  it('đọc lại phần đã cộng của hôm nay', () => {
    const today = vnDate(NOON)
    const t = Tracker.fromJSON({ date: today, seconds: { Chrome: 3600 } }, NOON)

    assert.deepEqual(t.report().samples, [{ app: 'Chrome', minutes: 60 }])
  })

  it('trạng thái của ngày khác thì bỏ — nó đã gửi xong rồi', () => {
    const t = Tracker.fromJSON({ date: '2026-09-20', seconds: { Chrome: 3600 } }, NOON)

    assert.equal(t.date, vnDate(NOON))
    assert.deepEqual(t.report().samples, [])
  })

  it('file hỏng hoặc thiếu thì bắt đầu sạch, không ném lỗi', () => {
    for (const bad of [null, undefined, 'chuoi', 42, {}, { date: vnDate(NOON), seconds: null }]) {
      const t = Tracker.fromJSON(bad, NOON)
      assert.equal(t.date, vnDate(NOON))
      assert.deepEqual(t.report().samples, [])
    }
  })

  it('bỏ giá trị vô lý trong file trạng thái', () => {
    const today = vnDate(NOON)
    const t = Tracker.fromJSON(
      { date: today, seconds: { Tot: 600, Am: -100, Chuoi: 'abc', VoCuc: Infinity } },
      NOON,
    )
    assert.deepEqual([...t.seconds.keys()], ['Tot'])
  })

  it('đi trọn vòng: ghi ra rồi đọc lại ra đúng số cũ', () => {
    const t = new Tracker(vnDate(NOON))
    t.add('Code', 1200, NOON)
    t.add('Chrome', 300, NOON)

    const back = Tracker.fromJSON(JSON.parse(JSON.stringify(t.toJSON())), NOON)

    assert.deepEqual(back.report(), t.report())
  })
})
