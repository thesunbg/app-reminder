import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { MILESTONES, buildStreaks } from '../src/stats/streaks.js'
import { addDays, isoWeekday, vnToday } from '../src/lib/time.js'

const MARK = `st-${Date.now()}`
let familyId = ''
let childId = ''

const today = vnToday()

async function makeRoutine(rrule = 'FREQ=DAILY', startDate = addDays(today, -60)) {
  return db.routine.create({
    data: {
      familyId, ownerId: childId, title: 'Tập thể dục', category: 'Sức khoẻ',
      durationMin: 30, timeOfDay: '05:30', rrule, startDate,
    },
  })
}

/** Tick một loạt ngày cho nhanh. */
async function tick(routineId: string, dates: string[], status: 'DONE' | 'PARTIAL' | 'SKIPPED' = 'DONE') {
  for (const date of dates) {
    await db.taskLog.create({ data: { routineId, date, status } })
  }
}

const lastDays = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => addDays(today, -(n - 1 + offset) + i))

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const child = await db.user.create({
    data: { familyId, name: 'Con', email: `${MARK}-c@test.local`, passwordHash: 'x', role: 'CHILD' },
  })
  childId = child.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.routine.deleteMany({ where: { familyId } })
})

describe('chuỗi liên tiếp', () => {
  it('chưa làm gì thì chuỗi bằng 0', async () => {
    await makeRoutine()
    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, 0)
    assert.equal(s?.best, 0)
    assert.deepEqual(s?.badges, [])
  })

  it('đếm đúng số ngày liên tiếp tính tới hôm qua', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(5, 1)) // 5 ngày, kết thúc ở hôm qua
    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, 5)
    assert.equal(s?.best, 5)
  })

  it('HÔM NAY chưa tick thì chưa phá chuỗi — ngày chưa hết', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(9, 1))
    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, 9, 'không được tụt về 0 chỉ vì sáng nay chưa tập')
  })

  it('tick luôn hôm nay thì chuỗi cộng thêm', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(10))
    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, 10)
  })

  it('làm dở vẫn giữ chuỗi, bỏ qua thì đứt', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(3, 1))
    await tick(r.id, [addDays(today, -4)], 'PARTIAL')
    await tick(r.id, [addDays(today, -5)], 'SKIPPED')
    await tick(r.id, lastDays(4, 6))

    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, 4, '3 ngày gần nhất + 1 ngày làm dở, rồi đứt ở ngày bỏ qua')
    assert.equal(s?.best, 4)
  })

  it('bỏ một ngày ở giữa thì chuỗi hiện tại ngắn lại nhưng kỷ lục còn nguyên', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(10, 5)) // chuỗi 10 ngày ở quá khứ
    await tick(r.id, lastDays(2, 1)) // rồi nghỉ 3 ngày, làm lại 2 ngày
    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, 2)
    assert.equal(s?.best, 10, 'kỷ lục không được mất chỉ vì đang đứt')
  })

  it('huy hiệu lấy theo kỷ lục, và nói còn mấy lần nữa tới mốc sau', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(8, 1))
    const [s] = await buildStreaks(familyId, childId)
    assert.deepEqual(s?.badges, [7], 'đạt mốc 7 thì phải có huy hiệu 7')
    assert.equal(s?.nextMilestone, 30)
    assert.equal(s?.toNext, 22)
  })

  it('qua mốc cao nhất thì không còn mốc kế tiếp', async () => {
    const r = await makeRoutine('FREQ=DAILY', addDays(today, -380))
    await tick(r.id, lastDays(370, 1))
    const [s] = await buildStreaks(familyId, childId)
    assert.deepEqual(s?.badges, [...MILESTONES])
    assert.equal(s?.nextMilestone, null)
    assert.equal(s?.toNext, null)
  })

  it('việc hàng tuần đếm theo LẦN chứ không theo ngày', async () => {
    // Thứ 2 gần nhất TÍNH CẢ HÔM NAY, rồi lùi k tuần. Phải neo như vậy chứ
    // không phải "hôm nay trừ 7×k": nếu hôm nay là thứ 3 thì cách kia bỏ sót
    // đúng thứ 2 hôm qua, mốc gần nhất thành chưa tick và chuỗi về 0 — test
    // đang xanh sẽ đỏ vào một ngày nào đó trong tuần mà không ai hiểu vì sao.
    const lastMonday = (weeksAgo: number) => {
      let d = today
      while (isoWeekday(d) !== 1) d = addDays(d, -1)
      return addDays(d, -7 * weeksAgo)
    }
    const start = lastMonday(8)
    const r = await makeRoutine('FREQ=WEEKLY;BYDAY=MO', start)
    await tick(r.id, [lastMonday(0), lastMonday(1), lastMonday(2), lastMonday(3)])

    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.daily, false, 'việc hàng tuần không được gọi là "ngày"')
    assert.equal(s?.current, 4)
  })

  it('ngày không có lịch thì không phá chuỗi', async () => {
    // chỉ làm thứ 2–6; cuối tuần không có lịch nên không tính là trượt
    const r = await makeRoutine('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', addDays(today, -30))
    const { occurrencesBetween } = await import('../src/lib/recurrence.js')
    const days = occurrencesBetween(r.rrule, r.startDate, addDays(today, -30), addDays(today, -1))
    await tick(r.id, days)

    const [s] = await buildStreaks(familyId, childId)
    assert.equal(s?.current, days.length, 'cuối tuần nghỉ không được coi là bỏ việc')
  })

  it('việc đã lưu trữ không xuất hiện', async () => {
    const r = await makeRoutine()
    await tick(r.id, lastDays(5, 1))
    await db.routine.update({ where: { id: r.id }, data: { active: false } })
    assert.deepEqual(await buildStreaks(familyId, childId), [])
  })

  it('đang cháy mạnh nhất xếp lên đầu', async () => {
    const a = await makeRoutine()
    const b = await db.routine.create({
      data: {
        familyId, ownerId: childId, title: 'Đọc sách', category: 'Học',
        durationMin: 20, timeOfDay: '20:00', rrule: 'FREQ=DAILY', startDate: addDays(today, -60),
      },
    })
    await tick(a.id, lastDays(2, 1))
    await tick(b.id, lastDays(9, 1))

    const rows = await buildStreaks(familyId, childId)
    assert.equal(rows[0]?.title, 'Đọc sách')
    assert.equal(rows[0]?.current, 9)
  })
})
