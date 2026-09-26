import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

const MARK = `fam-${Date.now()}`
let familyId = ''
let adminId = ''
let otherParentId = ''
let childId = ''

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
      role: 'PARENT', isAdmin: true, diaryPrivate: false,
    },
  })
  adminId = admin.id
})

beforeEach(async () => {
  await db.user.deleteMany({ where: { familyId, id: { not: adminId } } })
  const other = await db.user.create({
    data: {
      familyId, name: 'Mẹ', email: `${MARK}-me@test.local`, passwordHash: 'x',
      role: 'PARENT', isAdmin: false, diaryPrivate: false,
    },
  })
  otherParentId = other.id
  const child = await db.user.create({
    data: { familyId, name: 'Anh Tuấn', email: `${MARK}-con@test.local`, passwordHash: 'x', role: 'CHILD' },
  })
  childId = child.id
  await db.user.update({ where: { id: adminId }, data: { isAdmin: true, active: true } })
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

describe('quyền quản trị gia đình', () => {
  it('phụ huynh KHÔNG phải admin thì không thêm/sửa/xoá/reset được', async () => {
    const caller = await callerAs(otherParentId)
    const denied = /Chỉ quản trị gia đình/
    await assert.rejects(
      caller.family.addMember({ name: 'X', email: `${MARK}-x@test.local`, password: 'matkhau123', role: 'CHILD' }),
      denied,
    )
    await assert.rejects(caller.family.updateMember({ id: childId, name: 'Y' }), denied)
    await assert.rejects(caller.family.resetMemberPassword({ id: childId, password: 'matkhau123' }), denied)
    await assert.rejects(caller.family.removeMember({ id: childId, confirmName: 'Anh Tuấn' }), denied)
    await assert.rejects(caller.family.memberData({ id: childId }), denied)
    // nhưng vẫn xem được danh sách thành viên
    assert.equal((await caller.family.members()).length, 3)
  })

  it('con cũng không làm được', async () => {
    const caller = await callerAs(childId)
    await assert.rejects(caller.family.updateMember({ id: otherParentId, name: 'Z' }), /Chỉ quản trị gia đình/)
  })

  it('admin sửa được tên, email, vai trò; đổi email thì cắt phiên đang mở', async () => {
    const caller = await callerAs(adminId)
    await db.session.create({
      data: { id: `${MARK}-s1`, userId: childId, expiresAt: new Date(Date.now() + 86_400_000) },
    })
    const updated = await caller.family.updateMember({
      id: childId, name: 'Tuấn Anh', email: `${MARK}-moi@test.local`, role: 'PARENT',
    })
    assert.equal(updated.name, 'Tuấn Anh')
    assert.equal(updated.email, `${MARK}-moi@test.local`)
    assert.equal(updated.role, 'PARENT')
    assert.equal(await db.session.count({ where: { userId: childId } }), 0)
  })

  it('email trùng người khác thì bị từ chối', async () => {
    const caller = await callerAs(adminId)
    await assert.rejects(
      caller.family.updateMember({ id: childId, email: `${MARK}-me@test.local` }),
      /Email đã được dùng/,
    )
  })

  it('admin không tự khoá mình ra ngoài được', async () => {
    const caller = await callerAs(adminId)
    await assert.rejects(caller.family.updateMember({ id: adminId, active: false }), /tự vô hiệu hoá/)
    await assert.rejects(caller.family.updateMember({ id: adminId, role: 'CHILD' }), /tự chuyển mình/)
    await assert.rejects(caller.family.removeMember({ id: adminId, confirmName: 'Bố' }), /tự xoá/)
  })

  it('không đụng được vào thành viên của gia đình khác', async () => {
    const otherFamily = await db.family.create({ data: { name: `Nha khac ${MARK}` } })
    const outsider = await db.user.create({
      data: { familyId: otherFamily.id, name: 'Người lạ', email: `${MARK}-la@test.local`, passwordHash: 'x', role: 'PARENT' },
    })
    const caller = await callerAs(adminId)
    await assert.rejects(caller.family.updateMember({ id: outsider.id, name: 'Hack' }), /Không tìm thấy/)
    await assert.rejects(caller.family.removeMember({ id: outsider.id, confirmName: 'Người lạ' }), /Không tìm thấy/)
    await db.family.delete({ where: { id: otherFamily.id } })
  })
})

describe('gỡ tài khoản', () => {
  it('gõ sai tên thì không xoá — chặn ở server, không chỉ ở giao diện', async () => {
    const caller = await callerAs(adminId)
    await assert.rejects(caller.family.removeMember({ id: childId, confirmName: 'sai tên' }), /không khớp/)
    assert.ok(await db.user.findUnique({ where: { id: childId } }))
  })

  it('đếm đúng dữ liệu sẽ mất trước khi xoá', async () => {
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: childId, title: 'Học bài', timeOfDay: '19:00',
        rrule: 'FREQ=DAILY', startDate: '2026-01-01',
      },
    })
    await db.taskLog.create({ data: { routineId: routine.id, date: '2026-01-01', status: 'DONE' } })
    await db.note.create({ data: { familyId, ownerId: childId, title: 'Ghi chú' } })
    await db.diaryEntry.create({ data: { userId: childId, date: '2026-01-01', content: 'hôm nay' } })

    const caller = await callerAs(adminId)
    const data = await caller.family.memberData({ id: childId })
    assert.deepEqual(
      [data.routines, data.taskLogs, data.notes, data.diaryEntries],
      [1, 1, 1, 1],
    )
    assert.equal(data.name, 'Anh Tuấn')
  })

  it('gõ đúng tên thì xoá hẳn, kéo theo toàn bộ dữ liệu và phiên đăng nhập', async () => {
    const routine = await db.routine.create({
      data: {
        familyId, ownerId: childId, title: 'Học bài', timeOfDay: '19:00',
        rrule: 'FREQ=DAILY', startDate: '2026-01-01',
      },
    })
    await db.taskLog.create({ data: { routineId: routine.id, date: '2026-01-02', status: 'DONE' } })
    await db.diaryEntry.create({ data: { userId: childId, date: '2026-01-02', content: 'x' } })
    await db.session.create({
      data: { id: `${MARK}-s2`, userId: childId, expiresAt: new Date(Date.now() + 86_400_000) },
    })

    const caller = await callerAs(adminId)
    const r = await caller.family.removeMember({ id: childId, confirmName: '  Anh Tuấn  ' })
    assert.equal(r.name, 'Anh Tuấn')

    assert.equal(await db.user.count({ where: { id: childId } }), 0)
    assert.equal(await db.routine.count({ where: { ownerId: childId } }), 0)
    assert.equal(await db.taskLog.count({ where: { routineId: routine.id } }), 0)
    assert.equal(await db.diaryEntry.count({ where: { userId: childId } }), 0)
    assert.equal(await db.session.count({ where: { userId: childId } }), 0)
    // gia đình và các thành viên còn lại không bị ảnh hưởng
    assert.equal(await db.user.count({ where: { familyId } }), 2)
  })

  it('tắt tài khoản thì GIỮ dữ liệu, chỉ cắt đăng nhập', async () => {
    await db.diaryEntry.create({ data: { userId: childId, date: '2026-01-03', content: 'giữ lại' } })
    await db.session.create({
      data: { id: `${MARK}-s3`, userId: childId, expiresAt: new Date(Date.now() + 86_400_000) },
    })
    const caller = await callerAs(adminId)
    const r = await caller.family.updateMember({ id: childId, active: false })
    assert.equal(r.active, false)
    assert.equal(await db.session.count({ where: { userId: childId } }), 0)
    assert.equal(await db.diaryEntry.count({ where: { userId: childId } }), 1)
    // bật lại được
    assert.equal((await caller.family.updateMember({ id: childId, active: true })).active, true)
  })
})
