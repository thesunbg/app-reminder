import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { vnToday } from '../src/lib/time.js'
import { syncBirthdayEvent } from '../src/notifications/birthday.js'
import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

const MARK = `bd-${Date.now()}`
let familyId = ''
let adminId = ''

async function callerAs(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { family: true } })
  const ctx = {
    req: { headers: {}, cookies: {} },
    res: { setCookie() {}, clearCookie() {} },
    session: { user },
    user,
  } as unknown as Context
  return appRouter.createCaller(ctx)
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const admin = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}-admin@test.local`, passwordHash: 'x',
      role: 'PARENT', isAdmin: true,
    },
  })
  adminId = admin.id
})

beforeEach(async () => {
  await db.user.deleteMany({ where: { familyId, id: { not: adminId } } })
  await db.event.deleteMany({ where: { familyId } })
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

describe('sinh nhật thành viên lên lịch', () => {
  it('thêm thành viên có ngày sinh thì sự kiện xuất hiện ngay, đúng ngày trên lịch', async () => {
    const caller = await callerAs(adminId)
    const con = await caller.family.addMember({
      name: 'Anh Tuấn', email: `${MARK}-con@test.local`, password: 'matkhau123',
      role: 'CHILD', birthday: '2017-10-17',
    })

    const ev = await db.event.findUniqueOrThrow({ where: { birthdayUserId: con.id } })
    assert.equal(ev.title, 'Sinh nhật Anh Tuấn')
    assert.equal(ev.type, 'BIRTHDAY')
    assert.equal(ev.calendar, 'SOLAR')
    assert.equal(ev.yearly, true)
    // giữ nguyên cả năm sinh để còn biết tròn bao nhiêu tuổi
    assert.equal(ev.solarDate, '2017-10-17')

    // và nó phải rơi đúng ô 17/10 của năm nay trên lịch tháng
    const year = Number(vnToday().slice(0, 4))
    const days = await caller.event.calendar({ from: `${year}-10-01`, to: `${year}-10-31` })
    const cell = days.find((d) => d.date === `${year}-10-17`)!
    assert.ok(cell.events.some((e) => e.title === 'Sinh nhật Anh Tuấn'))
  })

  it('đổi ngày sinh thì sự kiện dời theo, occurrence cũ bị dọn', async () => {
    const caller = await callerAs(adminId)
    const con = await caller.family.addMember({
      name: 'Bin', email: `${MARK}-bin@test.local`, password: 'matkhau123',
      role: 'CHILD', birthday: '2017-10-17',
    })
    const year = Number(vnToday().slice(0, 4))

    await caller.family.updateMember({ id: con.id, birthday: '2017-03-05' })
    const ev = await db.event.findUniqueOrThrow({ where: { birthdayUserId: con.id } })
    assert.equal(ev.solarDate, '2017-03-05')

    const occ = await db.eventOccurrence.findMany({ where: { eventId: ev.id } })
    assert.ok(occ.every((o) => o.solarDate.endsWith('-03-05')), 'không còn occurrence của ngày cũ')

    const thang10 = await caller.event.calendar({ from: `${year}-10-01`, to: `${year}-10-31` })
    assert.ok(!thang10.some((d) => d.events.some((e) => e.id === ev.id)), 'ngày cũ phải sạch')
  })

  it('đổi tên thành viên thì tên sự kiện đổi theo', async () => {
    const caller = await callerAs(adminId)
    const con = await caller.family.addMember({
      name: 'Tuấn', email: `${MARK}-t@test.local`, password: 'matkhau123',
      role: 'CHILD', birthday: '2017-10-17',
    })
    await caller.family.updateMember({ id: con.id, name: 'Anh Tuấn' })
    const ev = await db.event.findUniqueOrThrow({ where: { birthdayUserId: con.id } })
    assert.equal(ev.title, 'Sinh nhật Anh Tuấn')
  })

  it('xoá ngày sinh hoặc tắt tài khoản thì sự kiện biến mất', async () => {
    const caller = await callerAs(adminId)
    const a = await caller.family.addMember({
      name: 'A', email: `${MARK}-a@test.local`, password: 'matkhau123', role: 'CHILD', birthday: '2017-10-17',
    })
    await caller.family.updateMember({ id: a.id, birthday: null })
    assert.equal(await db.event.count({ where: { birthdayUserId: a.id } }), 0)

    const b = await caller.family.addMember({
      name: 'B', email: `${MARK}-b@test.local`, password: 'matkhau123', role: 'CHILD', birthday: '2016-02-02',
    })
    await caller.family.updateMember({ id: b.id, active: false })
    assert.equal(await db.event.count({ where: { birthdayUserId: b.id } }), 0)
  })

  it('xoá hẳn thành viên thì sự kiện sinh nhật đi theo', async () => {
    const caller = await callerAs(adminId)
    const c = await caller.family.addMember({
      name: 'C', email: `${MARK}-c@test.local`, password: 'matkhau123', role: 'CHILD', birthday: '2015-05-05',
    })
    await caller.family.removeMember({ id: c.id, confirmName: 'C' })
    assert.equal(await db.event.count({ where: { birthdayUserId: c.id } }), 0)
  })

  it('không sửa / xoá được sinh nhật tự động ở trang Sự kiện', async () => {
    const caller = await callerAs(adminId)
    const con = await caller.family.addMember({
      name: 'D', email: `${MARK}-d@test.local`, password: 'matkhau123', role: 'CHILD', birthday: '2014-04-04',
    })
    const ev = await db.event.findUniqueOrThrow({ where: { birthdayUserId: con.id } })
    await assert.rejects(
      caller.event.update({ id: ev.id, calendar: 'SOLAR', title: 'Đổi', solarDate: '01-01', yearly: true, remindBeforeDays: [0], remindAtTime: '08:00' }),
      /sửa ngày sinh trong Cài đặt/,
    )
    await assert.rejects(caller.event.remove({ id: ev.id }), /sửa ngày sinh trong Cài đặt/)
  })

  it('gọi đồng bộ nhiều lần không đẻ thêm sự kiện', async () => {
    const caller = await callerAs(adminId)
    const con = await caller.family.addMember({
      name: 'E', email: `${MARK}-e@test.local`, password: 'matkhau123', role: 'CHILD', birthday: '2013-03-03',
    })
    await syncBirthdayEvent(con.id)
    await syncBirthdayEvent(con.id)
    assert.equal(await db.event.count({ where: { birthdayUserId: con.id } }), 1)
  })
})
