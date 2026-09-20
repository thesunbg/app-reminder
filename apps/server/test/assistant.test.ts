import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { TOOLS, actionSchema } from '../src/assistant/actions.js'
import { buildSystem, collectActions } from '../src/assistant/parse.js'
import { db } from '../src/db.js'
import { addDays, vnToday } from '../src/lib/time.js'
import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

const MARK = `assist-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''

async function callerAs(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { family: true } })
  const ctx = { req: { headers: {}, cookies: {} }, res: { setCookie() {}, clearCookie() {} }, session: { user }, user } as unknown as Context
  return appRouter.createCaller(ctx)
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  parentId = (await db.user.create({ data: { familyId, name: 'Bố', email: `${MARK}-p@test.local`, passwordHash: 'x', role: 'PARENT' } })).id
  childId = (await db.user.create({ data: { familyId, name: 'Bé Su', email: `${MARK}-c@test.local`, passwordHash: 'x', role: 'CHILD' } })).id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

const toolUse = (name: string, input: object): Anthropic.ContentBlock =>
  ({ type: 'tool_use', id: `tu_${Math.random()}`, name, input }) as Anthropic.ContentBlock

describe('tool definitions', () => {
  it('mỗi tool là strict, mọi property đều required, tên khớp actionSchema', () => {
    const names = new Set(actionSchema.options.map((o) => o.shape.type.value))
    for (const t of TOOLS) {
      assert.ok(names.has(t.name as never), `tool ${t.name} không có trong actionSchema`)
      assert.equal(t.strict, true)
      const schema = t.input_schema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
      assert.equal(schema.additionalProperties, false)
    }
    assert.equal(TOOLS.length, names.size)
  })

  it('system prompt: phần cố định có cache_control, phần động chứa ngày và danh sách id', () => {
    const sys = buildSystem(
      { speaker: { id: 'u1', name: 'Bố', role: 'PARENT' }, members: [{ id: 'u1', name: 'Bố', role: 'PARENT' }, { id: 'u2', name: 'Su', role: 'CHILD' }], routines: [{ id: 'r1', title: 'Học Anh', timeOfDay: '19:00', ownerName: 'Su' }] },
      new Date('2026-09-20T05:00:00Z'),
    )
    assert.equal(sys.length, 2)
    assert.deepEqual(sys[0]!.cache_control, { type: 'ephemeral' })
    assert.match(sys[1]!.text, /NGÀY HIỆN TẠI: 2026-09-20 \(Chủ nhật\), 12:00/)
    assert.match(sys[1]!.text, /Su \(id u2, con\)/)
    assert.match(sys[1]!.text, /Học Anh lúc 19:00, của Su \(id r1\)/)
  })
})

describe('collectActions — gom tool_use, loại cái sai', () => {
  it('giữ text làm reply, validate từng tool_use', () => {
    const out = collectActions([
      { type: 'text', text: 'Đã thêm.', citations: null } as Anthropic.ContentBlock,
      toolUse('create_note', { title: 'Thay dầu xe', body: '', items: null, remindDate: '2026-10-15', remindBeforeDays: [3, 0], recurIntervalDays: 180, shared: false }),
      toolUse('add_diary', { date: 'hôm nay', content: 'x', mood: null }), // ngày sai định dạng
      toolUse('bogus_tool', {}),
    ])
    assert.equal(out.reply, 'Đã thêm.')
    assert.equal(out.actions.length, 1)
    assert.equal(out.actions[0]!.type, 'create_note')
    assert.equal(out.rejected.length, 2)
    assert.match(out.rejected[0]!.reason, /date/)
  })
})

describe('assistant.run — thực thi qua đúng procedure', () => {
  it('routine + event âm + note checklist + diary + homework + score; lỗi từng cái không chặn cái khác', async () => {
    const parent = await callerAs(parentId)
    const t = vnToday()
    const res = await parent.assistant.run({
      actions: [
        { type: 'create_routine', title: 'Học tiếng Anh', category: 'Học', timeOfDay: '19:00', durationMin: 45, repeat: 'weekly:MO,WE,FR', ownerId: childId },
        { type: 'create_event', title: 'Giỗ ông nội', kind: 'DEATH_ANNIVERSARY', calendar: 'LUNAR', lunarDay: 12, lunarMonth: 8, solarDate: null, yearly: true, remindBeforeDays: [7, 1, 0] },
        { type: 'create_note', title: 'Đi chợ', body: '', items: ['Rau', 'Thịt'], remindDate: null, remindBeforeDays: null, recurIntervalDays: null, shared: true },
        { type: 'add_diary', date: t, content: 'Hôm nay vui', mood: 4 },
        { type: 'add_homework', childId, subject: 'Toán', title: 'Bài 3', date: addDays(t, 1) },
        { type: 'add_score', childId, subject: 'Văn', title: 'KT 15p', kind: 'SCORE', score: 8.5, maxScore: 10, date: t },
        { type: 'create_routine', title: 'Lỗi', category: null, timeOfDay: '07:00', durationMin: 10, repeat: 'moi-khi-ranh', ownerId: null },
      ],
    })
    assert.equal(res.done.length, 6)
    assert.equal(res.failed.length, 1)
    assert.match(res.failed[0]!.error, /Không hiểu lịch lặp/)

    const routine = await db.routine.findFirst({ where: { familyId, title: 'Học tiếng Anh' } })
    assert.equal(routine?.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE,FR')
    assert.equal(routine?.ownerId, childId)
    const event = await db.event.findFirst({ where: { familyId, title: 'Giỗ ông nội' } })
    assert.equal(event?.calendar, 'LUNAR')
    assert.equal(event?.lunarMonth, 8)
    const note = await db.note.findFirst({ where: { familyId, title: 'Đi chợ' }, include: { items: true } })
    assert.equal(note?.kind, 'CHECKLIST')
    assert.equal(note?.items.length, 2)
    assert.equal(note?.shared, true)
    assert.equal(await db.diaryEntry.count({ where: { userId: parentId, date: t, source: 'MANUAL' } }), 1)
    assert.equal(await db.studyRecord.count({ where: { childId } }), 2)
  })

  it('con không tạo được bài tập cho người khác dù model có bịa id', async () => {
    const child = await callerAs(childId)
    const res = await child.assistant.run({
      actions: [{ type: 'add_homework', childId: parentId, subject: 'Toán', title: 'x', date: vnToday() }],
    })
    assert.equal(res.done.length, 0)
    assert.match(res.failed[0]!.error, /Chỉ xem được/)
  })

  it('parse báo rõ khi chưa có API key', async () => {
    const parent = await callerAs(parentId)
    if (process.env.ANTHROPIC_API_KEY) return // có key thì bỏ qua — test này chỉ cho nhánh chưa cấu hình
    await assert.rejects(parent.assistant.parse({ text: 'nhắc tôi' }), /ANTHROPIC_API_KEY/)
    assert.deepEqual(await parent.assistant.status(), { enabled: false })
  })
})
