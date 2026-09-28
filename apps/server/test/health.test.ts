import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { appRouter } from '../src/trpc/router.js'
import { bmi } from '../src/trpc/routers/health.js'
import { clearHealthNotifications, healthDraft, materializeHealth } from '../src/notifications/health.js'
import { addDays, vnToday } from '../src/lib/time.js'

const MARK = `he-${Date.now()}`
let familyId = ''
let parentId = ''
let momId = ''
let childId = ''

const today = vnToday()
type Ctx = Parameters<typeof appRouter.createCaller>[0]

async function callerFor(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { family: true } })
  return appRouter.createCaller({ user } as unknown as Ctx)
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const mk = (name: string, role: 'PARENT' | 'CHILD', suffix: string) =>
    db.user.create({
      data: {
        familyId, name, role, email: `${MARK}-${suffix}@test.local`, passwordHash: 'x',
        notifyWebPush: true, notifyNative: false,
      },
    })
  parentId = (await mk('Bố', 'PARENT', 'p')).id
  momId = (await mk('Mẹ', 'PARENT', 'm')).id
  childId = (await mk('Bé Su', 'CHILD', 'c')).id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.healthRecord.deleteMany({ where: { userId: { in: [parentId, momId, childId] } } })
  await db.notification.deleteMany({ where: { userId: { in: [parentId, momId, childId] } } })
})

describe('BMI', () => {
  it('tính đúng và làm tròn một chữ số', () => {
    assert.equal(bmi(170, 65), 22.5)
    assert.equal(bmi(138.5, 32.4), 16.9)
  })
  it('thiếu một trong hai số thì không đoán bừa', () => {
    assert.equal(bmi(170, null), null)
    assert.equal(bmi(null, 65), null)
  })
})

describe('quyền trong sổ sức khoẻ', () => {
  it('phụ huynh ghi và xem được hồ sơ của con', async () => {
    const caller = await callerFor(parentId)
    await caller.health.create({ userId: childId, kind: 'GROWTH', date: today, title: '', heightCm: 138, weightKg: 32 })
    const list = await caller.health.list({ userId: childId })
    assert.equal(list.records.length, 1)
    assert.equal(list.growth[0]?.bmi, 16.8)
  })

  it('con KHÔNG xem được hồ sơ của bố mẹ', async () => {
    const caller = await callerFor(childId)
    await assert.rejects(() => caller.health.list({ userId: parentId }), /chính mình/)
  })

  it('con KHÔNG ghi được vào hồ sơ người khác', async () => {
    const caller = await callerFor(childId)
    await assert.rejects(
      () => caller.health.create({ userId: momId, kind: 'VACCINE', date: today, title: 'Mũi 2' }),
      /chính mình/,
    )
  })

  it('con ghi và xem được hồ sơ của chính mình', async () => {
    const caller = await callerFor(childId)
    await caller.health.create({ userId: childId, kind: 'GROWTH', date: today, title: '', heightCm: 140 })
    assert.equal((await caller.health.list({ userId: childId })).records.length, 1)
  })

  it('người chọn được chỉ gồm người trong nhà; con chỉ thấy chính mình', async () => {
    assert.equal((await (await callerFor(childId)).health.people()).length, 1)
    assert.equal((await (await callerFor(parentId)).health.people()).length, 3)
  })
})

describe('ràng buộc dữ liệu', () => {
  it('GROWTH không có số đo nào thì từ chối', async () => {
    const caller = await callerFor(parentId)
    await assert.rejects(
      () => caller.health.create({ userId: childId, kind: 'GROWTH', date: today, title: '' }),
      /chiều cao hoặc cân nặng/,
    )
  })

  it('mũi tiêm không tên thì từ chối', async () => {
    const caller = await callerFor(parentId)
    await assert.rejects(
      () => caller.health.create({ userId: childId, kind: 'VACCINE', date: today, title: '  ' }),
      /Cần ghi tên/,
    )
  })

  it('số đo vô lý bị chặn ngay ở đầu vào', async () => {
    const caller = await callerFor(parentId)
    await assert.rejects(() =>
      caller.health.create({ userId: childId, kind: 'GROWTH', date: today, title: '', heightCm: 900 }),
    )
  })

  it('biểu đồ sắp theo ngày tăng dần dù nhập lộn xộn', async () => {
    const caller = await callerFor(parentId)
    for (const d of [addDays(today, -60), addDays(today, -120), addDays(today, -30)]) {
      await caller.health.create({ userId: childId, kind: 'GROWTH', date: d, title: '', heightCm: 130 })
    }
    const g = (await caller.health.list({ userId: childId })).growth.map((r) => r.date)
    assert.deepEqual(g, [...g].sort())
  })
})

describe('nhắc hẹn sức khoẻ', () => {
  it('hồ sơ của CON thì nhắc bố mẹ, không nhắc đứa bé', async () => {
    const caller = await callerFor(parentId)
    await caller.health.create({
      userId: childId, kind: 'VACCINE', date: today, title: 'Sởi mũi 2',
      nextDate: addDays(today, 20),
    })
    await materializeHealth()

    assert.ok((await db.notification.count({ where: { userId: parentId, refTable: 'health' } })) > 0)
    assert.ok((await db.notification.count({ where: { userId: momId, refTable: 'health' } })) > 0, 'cả hai bố mẹ')
    assert.equal(await db.notification.count({ where: { userId: childId, refTable: 'health' } }), 0)
  })

  it('hồ sơ của phụ huynh thì nhắc chính họ', async () => {
    const caller = await callerFor(momId)
    await caller.health.create({
      userId: momId, kind: 'CHECKUP', date: today, title: 'Khám mắt', nextDate: addDays(today, 20),
    })
    await materializeHealth()
    assert.ok((await db.notification.count({ where: { userId: momId, refTable: 'health' } })) > 0)
    assert.equal(await db.notification.count({ where: { userId: parentId, refTable: 'health' } }), 0)
  })

  it('không có ngày hẹn thì không nhắc gì', async () => {
    const caller = await callerFor(parentId)
    await caller.health.create({ userId: childId, kind: 'MEDICINE', date: today, title: 'Siro ho' })
    await materializeHealth()
    assert.equal(await db.notification.count({ where: { refTable: 'health', userId: parentId } }), 0)
  })

  it('đổi ngày hẹn thì lịch nhắc cũ bị dọn', async () => {
    const caller = await callerFor(parentId)
    const rec = await caller.health.create({
      userId: childId, kind: 'VACCINE', date: today, title: 'Cúm', nextDate: addDays(today, 20),
    })
    await materializeHealth()
    const before = await db.notification.findMany({ where: { refTable: 'health' } })
    assert.ok(before.length > 0)

    await caller.health.update({
      id: rec.id, userId: childId, kind: 'VACCINE', date: today, title: 'Cúm',
      nextDate: addDays(today, 40),
    })
    const after = await db.notification.findMany({ where: { refTable: 'health' } })
    for (const n of after) {
      assert.equal(n.refId, `${rec.id}:${addDays(today, 40)}`, 'còn sót lịch nhắc của ngày hẹn cũ')
    }
  })

  it('xoá bản ghi thì lịch nhắc cũng đi theo', async () => {
    const caller = await callerFor(parentId)
    const rec = await caller.health.create({
      userId: childId, kind: 'VACCINE', date: today, title: 'Viêm gan B', nextDate: addDays(today, 15),
    })
    await materializeHealth()
    assert.ok((await db.notification.count({ where: { refTable: 'health' } })) > 0)
    await caller.health.remove({ id: rec.id })
    assert.equal(await db.notification.count({ where: { refTable: 'health' } }), 0)
  })

  it('chạy lại không đẻ trùng', async () => {
    const caller = await callerFor(parentId)
    await caller.health.create({
      userId: childId, kind: 'CHECKUP', date: today, title: 'Khám răng', nextDate: addDays(today, 30),
    })
    await materializeHealth()
    assert.equal(await materializeHealth(), 0)
  })

  it('nội dung nhắc nói rõ của ai và ngày nào', () => {
    const d = healthDraft({ kind: 'VACCINE', title: 'Sởi mũi 2', note: 'Trạm y tế phường' }, 'Bé Su', '2026-10-20', 7)
    assert.match(d.title, /Còn 7 ngày: Sởi mũi 2/)
    assert.match(d.body, /20\/10 · Bé Su/)
    assert.match(d.body, /Trạm y tế phường/)
  })

  it('dọn được lịch nhắc theo bản ghi', async () => {
    const caller = await callerFor(parentId)
    const rec = await caller.health.create({
      userId: childId, kind: 'VACCINE', date: today, title: 'Dại', nextDate: addDays(today, 25),
    })
    await materializeHealth()
    assert.ok((await clearHealthNotifications(rec.id)) > 0)
    assert.equal(await db.notification.count({ where: { refTable: 'health' } }), 0)
  })
})
