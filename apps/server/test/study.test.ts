import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { addDays, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'
import { clearHomeworkNotifications, materializeHomework } from '../src/notifications/homework.js'
import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

const MARK = `study-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''
let otherChildId = ''

function callerAs(userId: string) {
  return db.user.findUniqueOrThrow({ where: { id: userId }, include: { family: true } }).then((user) => {
    const ctx = {
      req: { headers: {}, cookies: {} },
      res: { setCookie() {}, clearCookie() {} },
      session: { user },
      user,
    } as unknown as Context
    return appRouter.createCaller(ctx)
  })
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const mk = (name: string, role: 'PARENT' | 'CHILD') =>
    db.user.create({
      data: { familyId, name, email: `${MARK}-${name}@test.local`, passwordHash: 'x', role, telegramChatId: '1', notifyTelegram: true, notifyWebPush: false },
    })
  parentId = (await mk('bo', 'PARENT')).id
  childId = (await mk('su', 'CHILD')).id
  otherChildId = (await mk('bin', 'CHILD')).id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.notification.deleteMany({ where: { userId: { in: [parentId, childId, otherChildId] } } })
  await db.studyRecord.deleteMany({ where: { childId: { in: [childId, otherChildId] } } })
  await db.classSchedule.deleteMany({ where: { childId: { in: [childId, otherChildId] } } })
})

describe('quyền: phụ huynh thấy mọi con, con chỉ thấy mình', () => {
  it('children', async () => {
    const parent = await callerAs(parentId)
    const child = await callerAs(childId)
    assert.deepEqual((await parent.study.children()).map((c) => c.id).sort(), [childId, otherChildId].sort())
    assert.deepEqual((await child.study.children()).map((c) => c.id), [childId])
  })

  it('con không đọc/ghi được của anh em', async () => {
    const child = await callerAs(childId)
    await assert.rejects(child.study.records({ childId: otherChildId }), /Chỉ xem được/)
    await assert.rejects(
      child.study.recordCreate({ childId: otherChildId, kind: 'HOMEWORK', subject: 'Toán', title: 'x', date: vnToday() }),
      /Chỉ xem được/,
    )
    // của mình thì được
    const rec = await child.study.recordCreate({ childId, kind: 'HOMEWORK', subject: 'Toán', title: 'Bài 1', date: vnToday() })
    assert.equal(rec.childId, childId)
  })

  it('phụ huynh không đụng được con nhà khác', async () => {
    const stranger = await db.family.create({ data: { name: `Other ${MARK}` } })
    const kid = await db.user.create({ data: { familyId: stranger.id, name: 'k', email: `${MARK}-k@test.local`, passwordHash: 'x', role: 'CHILD' } })
    try {
      const parent = await callerAs(parentId)
      await assert.rejects(parent.study.records({ childId: kid.id }), /Không có thành viên/)
    } finally {
      await db.family.delete({ where: { id: stranger.id } })
    }
  })
})

describe('thời khoá biểu', () => {
  it('thêm/sửa/xoá và lọc theo hiệu lực', async () => {
    const parent = await callerAs(parentId)
    const row = await parent.study.scheduleUpsert({ childId, weekday: 1, period: 1, subject: 'Toán', startTime: '07:00', endTime: '07:45' })
    await parent.study.scheduleUpsert({ childId, weekday: 1, period: 2, subject: 'Văn', startTime: '07:50', endTime: '08:35', effectiveTo: addDays(vnToday(), -1) })
    const live = await parent.study.schedule({ childId })
    assert.deepEqual(live.map((r) => r.subject), ['Toán']) // Văn đã hết hiệu lực

    await assert.rejects(
      parent.study.scheduleUpsert({ childId, weekday: 1, period: 3, subject: 'Anh', startTime: '09:00', endTime: '08:00' }),
      /kết thúc phải sau/,
    )
    await parent.study.scheduleUpsert({ id: row.id, childId, weekday: 2, period: 1, subject: 'Toán', startTime: '07:00', endTime: '07:45' })
    assert.equal((await parent.study.schedule({ childId }))[0]!.weekday, 2)

    const copied = await parent.study.scheduleCopy({ fromChildId: childId, toChildId: otherChildId })
    assert.equal(copied.copied, 1)
    assert.equal((await parent.study.schedule({ childId: otherChildId })).length, 1)

    await parent.study.scheduleRemove({ id: row.id })
    assert.equal((await parent.study.schedule({ childId })).length, 0)
  })
})

describe('bài tập và nhắc', () => {
  it('bài tập mai nộp → nhắc 19:00 hôm nay và 07:00 mai; tick xong thì huỷ; bỏ tick thì sinh lại', async () => {
    const child = await callerAs(childId)
    const tomorrow = addDays(vnToday(), 1)
    // giả lập "bây giờ" là 08:00 sáng để cả hai mốc đều ở tương lai
    const now = vnDateTimeToUtc(vnToday(), '08:00')
    const rec = await child.study.recordCreate({ childId, kind: 'HOMEWORK', subject: 'Toán', title: 'Bài 5 trang 32', date: tomorrow })
    await db.notification.deleteMany({ where: { userId: childId } })
    await materializeHomework(now)
    const ns = await db.notification.findMany({ where: { userId: childId, kind: 'HOMEWORK_DUE' }, orderBy: { fireAt: 'asc' } })
    assert.equal(ns.length, 2)
    assert.equal(ns[0]!.fireAt.toISOString(), vnDateTimeToUtc(vnToday(), '19:00').toISOString())
    assert.equal(ns[1]!.fireAt.toISOString(), vnDateTimeToUtc(tomorrow, '07:00').toISOString())
    assert.match(ns[0]!.title, /mai nộp/)
    assert.match(ns[1]!.title, /Nộp hôm nay/)
    // chạy lại không sinh trùng
    assert.equal(await materializeHomework(now), 0)

    await child.study.homeworkToggle({ id: rec.id, done: true })
    assert.equal(await db.notification.count({ where: { userId: childId, kind: 'HOMEWORK_DUE', fireAt: { gt: new Date() } } }), 0)

    await child.study.homeworkToggle({ id: rec.id, done: false })
    await materializeHomework(now)
    assert.equal(await db.notification.count({ where: { userId: childId, kind: 'HOMEWORK_DUE' } }), 2)

    await clearHomeworkNotifications(rec.id)
    assert.equal(await db.notification.count({ where: { userId: childId, kind: 'HOMEWORK_DUE', fireAt: { gt: new Date() } } }), 0)
  })

  it('phụ huynh không bị nhắc bài tập của con', async () => {
    const parent = await callerAs(parentId)
    await parent.study.recordCreate({ childId, kind: 'HOMEWORK', subject: 'Văn', title: 'Soạn bài', date: addDays(vnToday(), 2) })
    await materializeHomework(vnDateTimeToUtc(vnToday(), '08:00'))
    assert.equal(await db.notification.count({ where: { userId: parentId, kind: 'HOMEWORK_DUE' } }), 0)
    assert.ok((await db.notification.count({ where: { userId: childId, kind: 'HOMEWORK_DUE' } })) > 0)
  })

  it('xoá bài tập thì xoá luôn nhắc', async () => {
    const child = await callerAs(childId)
    const rec = await child.study.recordCreate({ childId, kind: 'HOMEWORK', subject: 'Toán', title: 'x', date: addDays(vnToday(), 3) })
    await materializeHomework(vnDateTimeToUtc(vnToday(), '08:00'))
    assert.ok((await db.notification.count({ where: { userId: childId, kind: 'HOMEWORK_DUE' } })) > 0)
    await child.study.recordRemove({ id: rec.id })
    assert.equal(await db.notification.count({ where: { userId: childId, kind: 'HOMEWORK_DUE', fireAt: { gt: new Date() } } }), 0)
  })
})

describe('dashboard', () => {
  it('gom bài tập quá hạn/sắp tới, điểm trung bình theo môn quy về thang 10, lịch hôm nay', async () => {
    const parent = await callerAs(parentId)
    const t = vnToday()
    await parent.study.recordCreate({ childId, kind: 'HOMEWORK', subject: 'Toán', title: 'quá hạn', date: addDays(t, -1) })
    await parent.study.recordCreate({ childId, kind: 'HOMEWORK', subject: 'Toán', title: 'sắp', date: addDays(t, 1) })
    await parent.study.recordCreate({ childId, kind: 'SCORE', subject: 'Toán', title: 'KT 15p', date: t, score: 8, maxScore: 10 })
    await parent.study.recordCreate({ childId, kind: 'EXAM', subject: 'Toán', title: 'Giữa kỳ', date: addDays(t, -3), score: 45, maxScore: 50 })
    await parent.study.recordCreate({ childId, kind: 'EXAM', subject: 'Anh', title: 'Cuối kỳ', date: addDays(t, 5) }) // chưa có điểm, sắp thi
    const wd = ((new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
    await parent.study.scheduleUpsert({ childId, weekday: wd, period: 1, subject: 'Sử', startTime: '07:00', endTime: '07:45' })

    const d = await parent.study.dashboard({ childId })
    assert.equal(d.homework.overdue.length, 1)
    assert.equal(d.homework.pending.length, 1)
    assert.deepEqual(d.scores.bySubject, [{ subject: 'Toán', avg: 8.5, count: 2, last: 8 }])
    assert.deepEqual(d.upcomingExams.map((e) => e.title), ['Cuối kỳ'])
    assert.deepEqual(d.todayClasses.map((c) => c.subject), ['Sử'])
    assert.equal(d.child.id, childId)
  })
})

// ---------- bài tập ghi nhanh: môn và hạn đều tuỳ chọn, kèm ảnh ----------

describe('bài tập ghi nhanh', () => {
  it('lưu được khi chỉ có nội dung — không môn, không hạn', async () => {
    const caller = await callerAs(childId)
    const rec = await caller.study.recordCreate({
      childId, kind: 'HOMEWORK',
      title: 'Làm nốt bài hình\ncâu b và c',
    })
    assert.equal(rec.subject, null)
    assert.equal(rec.date, null)
    assert.match(rec.title, /câu b và c/)
  })

  it('bài thi và điểm vẫn bắt buộc có ngày', async () => {
    const caller = await callerAs(childId)
    await assert.rejects(
      caller.study.recordCreate({ childId, kind: 'EXAM', title: 'Kiểm tra 1 tiết' }),
      /phải có ngày/,
    )
    await assert.rejects(
      caller.study.recordCreate({ childId, kind: 'SCORE', title: 'Miệng', score: 9 }),
      /phải có ngày/,
    )
  })

  it('bài không có hạn thì KHÔNG sinh nhắc, nhưng vẫn nằm trong danh sách chưa xong', async () => {
    const caller = await callerAs(childId)
    const noDue = await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Không hạn' })
    await caller.study.recordCreate({
      childId, kind: 'HOMEWORK', title: 'Có hạn', date: addDays(vnToday(), 3),
    })
    await materializeHomework()

    const notes = await db.notification.findMany({ where: { userId: childId, refTable: 'homework' } })
    assert.ok(notes.length > 0, 'bài có hạn phải được nhắc')
    assert.ok(
      notes.every((n) => !n.refId.startsWith(`${noDue.id}:`)),
      'bài không hạn không được sinh nhắc nào',
    )

    const list = await caller.study.records({ childId, kind: 'HOMEWORK', pendingOnly: true })
    assert.ok(list.some((r) => r.id === noDue.id), 'bài không hạn vẫn phải hiện ở danh sách chưa xong')
  })

  it('lọc theo khoảng ngày vẫn giữ lại bài không hạn', async () => {
    const caller = await callerAs(childId)
    const noDue = await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Không hạn' })
    const list = await caller.study.records({
      childId, kind: 'HOMEWORK', from: addDays(vnToday(), -30), to: vnToday(),
    })
    assert.ok(list.some((r) => r.id === noDue.id))
  })

  it('bài không hạn xếp sau bài có hạn', async () => {
    const caller = await callerAs(childId)
    await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Không hạn' })
    await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Có hạn', date: addDays(vnToday(), 2) })
    const list = await caller.study.records({ childId, kind: 'HOMEWORK' })
    assert.equal(list[0]!.title, 'Có hạn')
    assert.equal(list.at(-1)!.title, 'Không hạn')
  })

  it('dashboard: bài không hạn là "chưa xong", không bao giờ là "quá hạn"', async () => {
    const caller = await callerAs(parentId)
    await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Không hạn' })
    await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Trễ', date: addDays(vnToday(), -2) })
    const d = await caller.study.dashboard({ childId })
    assert.equal(d.homework.pending.filter((h) => h.title === 'Không hạn').length, 1)
    assert.equal(d.homework.overdue.filter((h) => h.title === 'Không hạn').length, 0)
    assert.equal(d.homework.overdue.filter((h) => h.title === 'Trễ').length, 1)
  })
})

describe('ảnh đính kèm bài tập', () => {
  // PNG 1x1 hợp lệ, đủ để kiểm đường đi của dữ liệu
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('thêm ảnh rồi lấy lại qua records, dữ liệu ảnh không kéo về kèm danh sách', async () => {
    const caller = await callerAs(childId)
    const rec = await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Chép đề' })
    const a = await caller.study.attachmentAdd({ recordId: rec.id, mime: 'image/png', data: PNG, width: 1, height: 1 })
    assert.equal(a.mime, 'image/png')

    const list = await caller.study.records({ childId, kind: 'HOMEWORK' })
    const row = list.find((r) => r.id === rec.id)!
    assert.equal(row.attachments.length, 1)
    assert.equal(row.attachments[0]!.id, a.id)
    assert.ok(!('data' in row.attachments[0]!), 'không kéo bytes ảnh về cùng danh sách')

    // nhưng trong DB thì có đủ bytes
    const stored = await db.studyAttachment.findUniqueOrThrow({ where: { id: a.id } })
    assert.deepEqual(Buffer.from(stored.data), Buffer.from(PNG, 'base64'))
    assert.equal(stored.size, Buffer.from(PNG, 'base64').length)
  })

  it('không đính được ảnh vào bài của con khác', async () => {
    const mine = await callerAs(childId)
    const rec = await mine.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Của tôi' })
    const other = await callerAs(otherChildId)
    await assert.rejects(
      other.study.attachmentAdd({ recordId: rec.id, mime: 'image/png', data: PNG }),
      /Chỉ xem được dữ liệu của mình/,
    )
  })

  it('xoá bài thì ảnh đi theo', async () => {
    const caller = await callerAs(childId)
    const rec = await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Sẽ xoá' })
    const a = await caller.study.attachmentAdd({ recordId: rec.id, mime: 'image/png', data: PNG })
    await caller.study.recordRemove({ id: rec.id })
    assert.equal(await db.studyAttachment.count({ where: { id: a.id } }), 0)
  })

  it('tối đa 6 ảnh mỗi bài', async () => {
    const caller = await callerAs(childId)
    const rec = await caller.study.recordCreate({ childId, kind: 'HOMEWORK', title: 'Nhiều ảnh' })
    for (let i = 0; i < 6; i++) {
      await caller.study.attachmentAdd({ recordId: rec.id, mime: 'image/png', data: PNG })
    }
    await assert.rejects(
      caller.study.attachmentAdd({ recordId: rec.id, mime: 'image/png', data: PNG }),
      /Tối đa 6 ảnh/,
    )
  })
})
