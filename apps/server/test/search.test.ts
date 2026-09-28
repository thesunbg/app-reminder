/**
 * Tìm kiếm: hai thứ dễ sai và không ai phát hiện ra cho tới lúc muộn —
 * bỏ dấu, và quyền xem (nhật ký riêng tư của người khác lọt vào kết quả).
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { snippetAround } from '../src/trpc/routers/search.js'
import { appRouter } from '../src/trpc/router.js'
import { addDays, vnToday } from '../src/lib/time.js'

const MARK = `se-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''
let otherFamilyId = ''
let otherUserId = ''

type Ctx = Parameters<typeof appRouter.createCaller>[0]

async function callerFor(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { family: true } })
  return appRouter.createCaller({ user } as unknown as Ctx)
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  parentId = (
    await db.user.create({
      data: { familyId, name: 'Bố', email: `${MARK}-p@test.local`, passwordHash: 'x', role: 'PARENT' },
    })
  ).id
  childId = (
    await db.user.create({
      data: {
        familyId, name: 'Bé Su', email: `${MARK}-c@test.local`, passwordHash: 'x', role: 'CHILD',
        diaryPrivate: true,
      },
    })
  ).id

  const other = await db.family.create({ data: { name: `Khác ${MARK}` } })
  otherFamilyId = other.id
  otherUserId = (
    await db.user.create({
      data: {
        familyId: otherFamilyId, name: 'Người lạ', email: `${MARK}-x@test.local`,
        passwordHash: 'x', role: 'PARENT',
      },
    })
  ).id

  // dữ liệu mẫu
  await db.note.create({
    data: { familyId, ownerId: parentId, title: 'Thay dầu xe SH', body: 'Hãng Honda ở phố Huế', shared: true },
  })
  await db.note.create({
    data: { familyId, ownerId: childId, title: 'Bí mật của con', body: 'Thay dầu gì đó', shared: false },
  })
  await db.diaryEntry.create({
    data: { userId: parentId, date: vnToday(), content: 'Hôm nay đi thay dầu xe, gặp bác Hường.' },
  })
  await db.diaryEntry.create({
    data: { userId: childId, date: vnToday(), content: 'Chuyện riêng: hôm nay con buồn vì thay dầu.' },
  })
  await db.studyRecord.create({
    data: { childId, kind: 'HOMEWORK', subject: 'Toán', title: 'Bài hình trang 42', date: addDays(vnToday(), 1) },
  })
  await db.event.create({
    data: {
      familyId, calendar: 'LUNAR', lunarDay: 15, lunarMonth: 7, type: 'DEATH_ANNIVERSARY',
      title: 'Giỗ ông nội', note: 'Cúng ở nhà bác cả', remindBeforeDays: [0],
    },
  })
  await db.note.create({
    data: { familyId: otherFamilyId, ownerId: otherUserId, title: 'Thay dầu xe nhà khác', body: '', shared: true },
  })
})

after(async () => {
  await db.family.deleteMany({ where: { id: { in: [familyId, otherFamilyId] } } }).catch(() => {})
  await db.$disconnect()
})

describe('cắt đoạn quanh từ khoá', () => {
  it('đoạn ngắn thì giữ nguyên', () => {
    assert.equal(snippetAround('Thay dầu xe', 'dầu'), 'Thay dầu xe')
  })

  it('đoạn dài thì cắt quanh chỗ khớp và có dấu …', () => {
    const long = `${'a'.repeat(200)} cần tìm ${'b'.repeat(200)}`
    const out = snippetAround(long, 'cần tìm')
    assert.ok(out.includes('cần tìm'))
    assert.ok(out.startsWith('…') && out.endsWith('…'))
    assert.ok(out.length < 200)
  })
})

describe('tìm kiếm', () => {
  it('gõ KHÔNG DẤU vẫn ra kết quả có dấu', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'gio ong noi' })
    assert.ok(res.hits.some((h) => h.title === 'Giỗ ông nội'), 'phải tìm được ngày giỗ bằng chữ không dấu')
  })

  it('gõ có dấu cũng ra', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'Giỗ ông' })
    assert.ok(res.hits.some((h) => h.kind === 'event'))
  })

  it('không phân biệt hoa thường', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'THAY DAU' })
    assert.ok(res.hits.some((h) => h.kind === 'note'))
  })

  it('tìm được trong nhiều loại cùng lúc', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'thay dau' })
    const kinds = new Set(res.hits.map((h) => h.kind))
    assert.ok(kinds.has('note'), 'ghi chú')
    assert.ok(kinds.has('diary'), 'nhật ký')
  })

  it('KHÔNG lọt nhật ký riêng tư của người khác', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'thay dau' })
    assert.ok(
      !res.hits.some((h) => h.kind === 'diary' && h.snippet.includes('Chuyện riêng')),
      'nhật ký con để riêng tư mà bố tìm ra được là hỏng cả cam kết của app',
    )
  })

  it('KHÔNG lọt ghi chú riêng của người khác', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'thay dau' })
    assert.ok(!res.hits.some((h) => h.title === 'Bí mật của con'))
  })

  it('KHÔNG lọt dữ liệu nhà khác', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'thay dau' })
    assert.ok(!res.hits.some((h) => h.title.includes('nhà khác')))
  })

  it('con tìm được bài tập của chính mình', async () => {
    const caller = await callerFor(childId)
    const res = await caller.search.all({ q: 'bai hinh' })
    assert.ok(res.hits.some((h) => h.kind === 'study' && h.title.includes('Bài hình')))
  })

  it('con không thấy nhật ký của bố', async () => {
    const caller = await callerFor(childId)
    const res = await caller.search.all({ q: 'bac Huong' })
    assert.ok(!res.hits.some((h) => h.kind === 'diary'))
  })

  it('từ khoá không có thì trả rỗng chứ không lỗi', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: 'khongcogiday' })
    assert.equal(res.total, 0)
  })

  it('dấu nháy và ký tự lạ không làm vỡ truy vấn', async () => {
    const caller = await callerFor(parentId)
    const res = await caller.search.all({ q: "'; DROP TABLE \"Note\"; --" })
    assert.equal(res.total, 0)
    // bảng vẫn còn
    assert.ok((await db.note.count({ where: { familyId } })) > 0)
  })
})
