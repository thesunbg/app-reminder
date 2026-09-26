import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { vnToday } from '../src/lib/time.js'
import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

const MARK = `rq-${Date.now()}`
let familyId = ''
let boId = ''
let meId = ''
let conId = ''

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

/** Việc chạy mỗi ngày, bắt đầu từ hôm nay — luôn rơi vào "hôm nay". */
async function makeRoutine(ownerId: string, title: string) {
  return db.routine.create({
    data: {
      familyId, ownerId, title, timeOfDay: '05:30', durationMin: 30,
      rrule: 'FREQ=DAILY', startDate: vnToday(),
    },
  })
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const mk = (name: string, role: 'PARENT' | 'CHILD') =>
    db.user.create({ data: { familyId, name, email: `${MARK}-${name}@test.local`, passwordHash: 'x', role } })
  boId = (await mk('Bo', 'PARENT')).id
  meId = (await mk('Me', 'PARENT')).id
  conId = (await mk('Con', 'CHILD')).id
})

beforeEach(async () => {
  await db.routine.deleteMany({ where: { familyId } })
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

describe('quyền tick việc định kỳ', () => {
  it('phụ huynh KHÔNG tick hộ được việc của phụ huynh khác', async () => {
    const r = await makeRoutine(boId, 'Chạy bộ')
    const me = await callerAs(meId)
    await assert.rejects(
      me.routine.mark({ routineId: r.id, date: vnToday(), status: 'DONE' }),
      /Đây là việc của Bo/,
    )
    assert.equal(await db.taskLog.count({ where: { routineId: r.id } }), 0)
  })

  it('cũng không sửa hay lưu trữ được việc của phụ huynh khác', async () => {
    const r = await makeRoutine(boId, 'Chạy bộ')
    const me = await callerAs(meId)
    await assert.rejects(me.routine.update({ id: r.id, title: 'Đổi tên' }), /chỉ người đó/)
    await assert.rejects(me.routine.archive({ id: r.id }), /chỉ người đó/)
  })

  it('chủ việc thì tick được', async () => {
    const r = await makeRoutine(boId, 'Chạy bộ')
    const bo = await callerAs(boId)
    const log = await bo.routine.mark({ routineId: r.id, date: vnToday(), status: 'DONE' })
    assert.equal(log.status, 'DONE')
  })

  it('phụ huynh VẪN tick hộ được việc của con', async () => {
    const r = await makeRoutine(conId, 'Học bài')
    const me = await callerAs(meId)
    const log = await me.routine.mark({ routineId: r.id, date: vnToday(), status: 'DONE' })
    assert.equal(log.status, 'DONE')
  })

  it('con không tick được việc của phụ huynh', async () => {
    const r = await makeRoutine(boId, 'Chạy bộ')
    const con = await callerAs(conId)
    await assert.rejects(con.routine.mark({ routineId: r.id, date: vnToday(), status: 'DONE' }), /chỉ người đó/)
  })

  it('vẫn NHÌN THẤY việc của nhau, chỉ là canEdit = false', async () => {
    await makeRoutine(boId, 'Chạy bộ')
    await makeRoutine(conId, 'Học bài')
    const me = await callerAs(meId)

    const day = await me.routine.day({})
    const chay = day.items.find((i) => i.routine.title === 'Chạy bộ')
    const hoc = day.items.find((i) => i.routine.title === 'Học bài')
    assert.ok(chay, 'việc của chồng vẫn phải hiện trên màn hình Hôm nay')
    assert.equal(chay.canEdit, false)
    assert.equal(hoc?.canEdit, true)

    const list = await me.routine.list()
    assert.equal(list.find((r) => r.title === 'Chạy bộ')?.canEdit, false)

    const week = await me.routine.week({})
    assert.equal(week.rows.find((r) => r.routine.title === 'Chạy bộ')?.canEdit, false)
  })
})
