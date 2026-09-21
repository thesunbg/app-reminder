/**
 * Kênh push native (Phase 7). Kiểm tra phần mình viết trong lib/fcm: fan-out
 * theo thiết bị, dọn token chết, và phần ký JWT service account.
 *
 * Không gọi FCM thật: sender được thay bằng hàm giả qua __setNativeSender,
 * và việc xin access token được thử riêng bằng một HTTP server cục bộ. Làm
 * ngược lại thì test sẽ phụ thuộc mạng và một project Firebase có thật.
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import {
  __setNativeSender, __setServiceAccount, accessToken, fcmConfigError, fcmEnabled,
  sendNativeToUser, type SendOutcome,
} from '../src/lib/fcm.js'

const MARK = `fcm-${Date.now()}`
let familyId = ''
let userId = ''
let restore: () => void

/** token -> kết quả mà "FCM" trả về; không có trong map nghĩa là gửi thành công */
const outcomes = new Map<string, SendOutcome>()
const sent: Array<{ token: string; title: string }> = []

async function addDevice(token: string, platform: 'ios' | 'android' = 'android') {
  return db.nativeDevice.create({ data: { userId, token, platform } })
}

before(async () => {
  restore = __setNativeSender(async (token, payload) => {
    const forced = outcomes.get(token)
    if (forced) return forced
    sent.push({ token, title: payload.title })
    return { ok: true }
  })

  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const user = await db.user.create({
    data: { familyId, name: 'Native', email: `${MARK}@test.local`, passwordHash: 'x', role: 'PARENT' },
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
  outcomes.clear()
  await db.nativeDevice.deleteMany({ where: { userId } })
})

describe('push native (FCM)', () => {
  it('gửi tới mọi thiết bị của user', async () => {
    await addDevice('tok-iphone', 'ios')
    await addDevice('tok-android', 'android')

    const n = await sendNativeToUser(userId, { title: 'Học tiếng Anh', body: '20:00' })

    assert.equal(n, 2)
    assert.deepEqual(sent.map((s) => s.token).sort(), ['tok-android', 'tok-iphone'])
  })

  it('chưa có thiết bị nào thì báo lỗi rõ ràng', async () => {
    await assert.rejects(
      () => sendNativeToUser(userId, { title: 'x', body: 'y' }),
      /Chưa có thiết bị nào cài app/,
    )
  })

  it('token chết (UNREGISTERED) bị xoá khỏi DB', async () => {
    await addDevice('tok-go-cai-lai')
    await addDevice('tok-con-song')
    outcomes.set('tok-go-cai-lai', { ok: false, dead: true, message: 'UNREGISTERED: token không còn' })

    const n = await sendNativeToUser(userId, { title: 'x', body: 'y' })

    assert.equal(n, 1)
    const left = await db.nativeDevice.findMany({ where: { userId } })
    assert.deepEqual(left.map((d) => d.token), ['tok-con-song'])
  })

  it('lỗi tạm thời KHÔNG xoá thiết bị — mai gửi lại còn được', async () => {
    await addDevice('tok-mang-hong')
    outcomes.set('tok-mang-hong', { ok: false, dead: false, message: 'UNAVAILABLE: thử lại sau' })

    await assert.rejects(() => sendNativeToUser(userId, { title: 'x', body: 'y' }), /UNAVAILABLE/)

    assert.equal(await db.nativeDevice.count({ where: { userId } }), 1)
  })

  it('một máy chết không làm hỏng các máy còn lại', async () => {
    await addDevice('tok-a')
    await addDevice('tok-b')
    await addDevice('tok-c')
    outcomes.set('tok-b', { ok: false, dead: false, message: 'INTERNAL' })

    const n = await sendNativeToUser(userId, { title: 'x', body: 'y' })

    assert.equal(n, 2)
  })

  it('một thiết bị chỉ thuộc về một người — đăng ký lại thì đổi chủ', async () => {
    const other = await db.user.create({
      data: { familyId, name: 'Con', email: `${MARK}-con@test.local`, passwordHash: 'x', role: 'CHILD' },
    })
    await addDevice('tok-may-dung-chung')

    // cùng token, người khác đăng nhập -> upsert theo token (giống registerNative)
    await db.nativeDevice.upsert({
      where: { token: 'tok-may-dung-chung' },
      create: { token: 'tok-may-dung-chung', platform: 'ios', userId: other.id },
      update: { userId: other.id, platform: 'ios' },
    })

    assert.equal(await db.nativeDevice.count({ where: { userId } }), 0)
    assert.equal(await db.nativeDevice.count({ where: { userId: other.id } }), 1)
    await db.user.delete({ where: { id: other.id } })
  })
})

// ---------------------------------------------------------------------------

describe('service account JWT', () => {
  let server: Server
  let port = 0
  let received: { assertion: string; grant: string } | null = null

  // Khoá sinh tại chỗ: không có bí mật thật nào nằm trong repo.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  before(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const params = new URLSearchParams(body)
        received = { assertion: params.get('assertion') ?? '', grant: params.get('grant_type') ?? '' }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ access_token: 'ya29.gia-lap', expires_in: 3600 }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as { port: number }).port
  })

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('ký RS256 đúng chuẩn và cache lại token', async () => {
    const back = __setServiceAccount(
      JSON.stringify({
        project_id: 'gia-dinh-test',
        client_email: 'bot@gia-dinh-test.iam.gserviceaccount.com',
        private_key: pem,
      }),
      `http://127.0.0.1:${port}/token`,
    )

    assert.equal(fcmEnabled(), true)
    const token = await accessToken()
    assert.equal(token, 'ya29.gia-lap')
    assert.equal(received?.grant, 'urn:ietf:params:oauth:grant-type:jwt-bearer')

    const [header, claims, signature] = received!.assertion.split('.')
    const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString())
    assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' })

    const payload = decode(claims)
    assert.equal(payload.iss, 'bot@gia-dinh-test.iam.gserviceaccount.com')
    assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging')
    assert.equal(payload.exp - payload.iat, 3600)

    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'))
    assert.equal(verified, true, 'chữ ký phải verify được bằng public key tương ứng')

    // lần hai không gọi lại Google
    received = null
    assert.equal(await accessToken(), 'ya29.gia-lap')
    assert.equal(received, null, 'token còn hạn thì phải lấy từ cache')

    back()
  })

  it('service account hỏng thì nói rõ chứ không ném JSON.parse', () => {
    const back = __setServiceAccount('{ khong-phai-json')
    assert.equal(fcmEnabled(), false)
    assert.match(fcmConfigError()!, /không phải JSON hợp lệ/)
    back()
  })

  it('thiếu trường bắt buộc cũng báo lỗi đọc được', () => {
    const back = __setServiceAccount(JSON.stringify({ project_id: 'x' }))
    assert.equal(fcmEnabled(), false)
    assert.match(fcmConfigError()!, /thiếu project_id\/client_email\/private_key/)
    back()
  })

  it('để rỗng thì kênh tắt hẳn, không phải lỗi', () => {
    const back = __setServiceAccount('')
    assert.equal(fcmEnabled(), false)
    assert.equal(fcmConfigError(), null)
    back()
  })
})
