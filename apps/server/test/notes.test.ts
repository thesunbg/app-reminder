import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { addDays, vnDateTimeToUtc, vnToday } from '../src/lib/time.js'
import {
  clearNoteNotifications,
  completeNote,
  materializeNotes,
  noteRef,
} from '../src/notifications/notes.js'

const MARK = `note-${Date.now()}`
let familyId = ''
let ownerId = ''
let otherId = ''

async function makeNote(data: Record<string, unknown> = {}) {
  return db.note.create({
    data: {
      familyId, ownerId, title: 'Thay dầu xe', body: 'Honda SH, 5000km',
      remindBeforeDays: [3, 0], remindAtTime: '08:00',
      ...data,
    } as never,
  })
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const owner = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}-o@test.local`, passwordHash: 'x', role: 'PARENT',
      telegramChatId: '111', notifyTelegram: true, notifyWebPush: false,
    },
  })
  ownerId = owner.id
  const other = await db.user.create({
    data: {
      familyId, name: 'Mẹ', email: `${MARK}-m@test.local`, passwordHash: 'x', role: 'PARENT',
      telegramChatId: '222', notifyTelegram: true, notifyWebPush: false,
    },
  })
  otherId = other.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.notification.deleteMany({ where: { userId: { in: [ownerId, otherId] } } })
  await db.note.deleteMany({ where: { familyId } })
})

describe('ghi chú không có hạn', () => {
  it('không sinh thông báo nào', async () => {
    await makeNote({ remindDate: null })
    assert.equal(await materializeNotes(), 0)
    assert.equal(await db.notification.count({ where: { userId: ownerId } }), 0)
  })

  it('checklist lưu kèm các dòng', async () => {
    const n = await db.note.create({
      data: {
        familyId, ownerId, title: 'Đi chợ', kind: 'CHECKLIST',
        items: { create: [{ text: 'Rau', sortOrder: 0 }, { text: 'Thịt', checked: true, sortOrder: 1 }] },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    assert.equal(n.items.length, 2)
    assert.equal(n.items[1]!.checked, true)
  })
})

describe('ghi chú có hạn', () => {
  it('sinh đúng mốc nhắc trước và đúng ngày', async () => {
    const due = addDays(vnToday(), 10)
    const n = await makeNote({ remindDate: due })
    await materializeNotes()

    const rows = await db.notification.findMany({
      where: { userId: ownerId, refId: noteRef(n.id, due) },
      orderBy: { fireAt: 'asc' },
    })
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => r.kind), ['NOTE_AHEAD', 'NOTE_DUE'])
    assert.equal(rows[0]!.fireAt.getTime(), vnDateTimeToUtc(addDays(due, -3), '08:00').getTime())
    assert.match(rows[0]!.title, /Còn 3 ngày: Thay dầu xe/)
  })

  it('ghi chú riêng tư chỉ nhắc chủ nhân', async () => {
    await makeNote({ remindDate: addDays(vnToday(), 5), shared: false })
    await materializeNotes()
    assert.ok((await db.notification.count({ where: { userId: ownerId } })) > 0)
    assert.equal(await db.notification.count({ where: { userId: otherId } }), 0)
  })

  it('ghi chú đã chia sẻ thì nhắc cả nhà', async () => {
    await makeNote({ remindDate: addDays(vnToday(), 5), shared: true })
    await materializeNotes()
    assert.ok((await db.notification.count({ where: { userId: ownerId } })) > 0)
    assert.ok((await db.notification.count({ where: { userId: otherId } })) > 0)
  })

  it('ghi chú đã lưu trữ hoặc đã xong thì không nhắc', async () => {
    await makeNote({ remindDate: addDays(vnToday(), 5), archived: true })
    await makeNote({ remindDate: addDays(vnToday(), 5), doneAt: new Date() })
    assert.equal(await materializeNotes(), 0)
  })

  it('chạy lại không đẻ trùng', async () => {
    await makeNote({ remindDate: addDays(vnToday(), 5) })
    await materializeNotes()
    const first = await db.notification.count({ where: { userId: ownerId } })
    await materializeNotes()
    await materializeNotes()
    assert.equal(await db.notification.count({ where: { userId: ownerId } }), first)
  })

  it('dọn lịch nhắc khi xoá/sửa', async () => {
    const n = await makeNote({ remindDate: addDays(vnToday(), 5) })
    await materializeNotes()
    assert.ok((await db.notification.count({ where: { userId: ownerId, status: 'PENDING' } })) > 0)
    await clearNoteNotifications(n.id)
    assert.equal(await db.notification.count({ where: { userId: ownerId, status: 'PENDING' } }), 0)
  })
})

describe('xong việc và chu kỳ lặp', () => {
  it('không có chu kỳ thì chỉ đánh dấu xong, không đẻ ghi chú mới', async () => {
    const n = await makeNote({ remindDate: addDays(vnToday(), 3) })
    const { next } = await completeNote(n.id)
    assert.equal(next, null)

    const after = await db.note.findUniqueOrThrow({ where: { id: n.id } })
    assert.ok(after.doneAt)
    assert.equal(after.archived, true)
    assert.equal(await db.note.count({ where: { familyId } }), 1)
  })

  it('có chu kỳ thì đẻ ghi chú mới cho lần tới', async () => {
    const due = addDays(vnToday(), 3)
    const n = await makeNote({ remindDate: due, recurIntervalDays: 180 })
    const { next } = await completeNote(n.id)

    assert.ok(next)
    assert.equal(next.remindDate, addDays(due, 180))
    assert.equal(next.title, 'Thay dầu xe')
    assert.equal(next.recurIntervalDays, 180)
    assert.equal(next.doneAt, null)
    assert.equal(next.archived, false)
  })

  it('hạn cũ đã lùi xa trong quá khứ thì nhảy tới mốc đầu tiên còn ở tương lai', async () => {
    // thay dầu quá hạn 400 ngày, chu kỳ 180 -> không được đặt hạn mới vào quá khứ
    const due = addDays(vnToday(), -400)
    const n = await makeNote({ remindDate: due, recurIntervalDays: 180 })
    const { next } = await completeNote(n.id)

    assert.ok(next)
    assert.ok(next.remindDate! >= vnToday(), `hạn mới ${next.remindDate} không được ở quá khứ`)
  })

  it('checklist lặp lại bắt đầu từ trạng thái chưa tick', async () => {
    const n = await db.note.create({
      data: {
        familyId, ownerId, title: 'Bảo dưỡng xe', kind: 'CHECKLIST',
        remindDate: addDays(vnToday(), 3), recurIntervalDays: 180,
        items: { create: [{ text: 'Thay dầu', checked: true, sortOrder: 0 }, { text: 'Kiểm tra phanh', checked: true, sortOrder: 1 }] },
      },
    })
    const { next } = await completeNote(n.id)
    const items = await db.noteItem.findMany({ where: { noteId: next!.id }, orderBy: { sortOrder: 'asc' } })
    assert.equal(items.length, 2)
    assert.ok(items.every((i) => !i.checked), 'lần bảo dưỡng mới phải bắt đầu từ đầu')
    assert.deepEqual(items.map((i) => i.text), ['Thay dầu', 'Kiểm tra phanh'])
  })

  it('xong việc thì lịch nhắc cũ bị dọn', async () => {
    const n = await makeNote({ remindDate: addDays(vnToday(), 5) })
    await materializeNotes()
    const before = await db.notification.count({
      where: { userId: ownerId, refId: noteRef(n.id, addDays(vnToday(), 5)), status: 'PENDING' },
    })
    assert.ok(before > 0)

    await completeNote(n.id)
    assert.equal(
      await db.notification.count({
        where: { userId: ownerId, refId: noteRef(n.id, addDays(vnToday(), 5)), status: 'PENDING' },
      }),
      0,
    )
  })
})
