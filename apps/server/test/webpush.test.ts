/**
 * Kiểm tra phần mình viết trong lib/webpush: tra thiết bị của user, fan-out,
 * và dọn endpoint đã chết. Tầng mã hoá + TLS là việc của web-push nên được
 * thay bằng sender giả qua __setPushSender.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { __setPushSender, sendPushToUser, webPushEnabled, type PushTarget } from '../src/lib/webpush.js'

type Sent = { endpoint: string; body: string }
const sent: Sent[] = []
/** endpoint -> mã lỗi HTTP mà "push service" trả về */
const failures = new Map<string, number>()
let restore: () => void

const MARK = `wp-${Date.now()}`
let familyId = ''
let userId = ''

const endpoint = (id: string) => `https://push.example/${id}`

async function addDevice(id: string) {
  return db.pushDevice.create({
    data: { userId, endpoint: endpoint(id), p256dh: `p-${id}`, auth: `a-${id}` },
  })
}

before(async () => {
  restore = __setPushSender(async (target: PushTarget, body: string) => {
    const status = failures.get(target.endpoint)
    if (status) {
      const err = new Error(`push service trả ${status}`) as Error & { statusCode: number }
      err.statusCode = status
      throw err
    }
    sent.push({ endpoint: target.endpoint, body })
  })

  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const user = await db.user.create({
    data: { familyId, name: 'WP', email: `${MARK}@test.local`, passwordHash: 'x', role: 'PARENT' },
  })
  userId = user.id
})

after(async () => {
  restore()
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  sent.length = 0
  failures.clear()
  await db.pushDevice.deleteMany({ where: { userId } })
})

describe('web push', () => {
  it('VAPID đã được cấu hình', () => {
    assert.equal(webPushEnabled(), true)
  })

  it('gửi tới mọi thiết bị của user với đúng payload', async () => {
    await addDevice('a')
    await addDevice('b')

    const n = await sendPushToUser(userId, { title: 'Đến giờ', body: 'Học tiếng Anh', url: '/', tag: 'r1:2026-09-21' })
    assert.equal(n, 2)
    assert.deepEqual(sent.map((s) => s.endpoint).sort(), [endpoint('a'), endpoint('b')])

    const payload = JSON.parse(sent[0]!.body)
    assert.equal(payload.title, 'Đến giờ')
    assert.equal(payload.body, 'Học tiếng Anh')
    assert.equal(payload.tag, 'r1:2026-09-21')
  })

  it('chưa có thiết bị nào thì báo lỗi rõ ràng', async () => {
    await assert.rejects(() => sendPushToUser(userId, { title: 'x', body: 'y' }), /Chưa có thiết bị nào/)
  })

  it('endpoint chết (404/410) thì bị xoá khỏi DB', async () => {
    await addDevice('gone')
    await addDevice('missing')
    failures.set(endpoint('gone'), 410)
    failures.set(endpoint('missing'), 404)

    await assert.rejects(() => sendPushToUser(userId, { title: 'x', body: 'y' }))
    assert.equal(await db.pushDevice.count({ where: { userId } }), 0, 'endpoint chết phải bị dọn')
  })

  it('lỗi tạm thời (500) thì GIỮ lại thiết bị', async () => {
    await addDevice('flaky')
    failures.set(endpoint('flaky'), 500)

    await assert.rejects(() => sendPushToUser(userId, { title: 'x', body: 'y' }))
    assert.equal(await db.pushDevice.count({ where: { userId } }), 1, '500 là lỗi tạm, không được xoá thiết bị')
  })

  it('một thiết bị chết không làm hỏng các thiết bị còn lại', async () => {
    await addDevice('ok1')
    await addDevice('dead')
    await addDevice('ok2')
    failures.set(endpoint('dead'), 410)

    const n = await sendPushToUser(userId, { title: 'x', body: 'y' })
    assert.equal(n, 2, 'hai thiết bị sống vẫn phải nhận được')
    assert.equal(await db.pushDevice.count({ where: { userId } }), 2)
  })
})
