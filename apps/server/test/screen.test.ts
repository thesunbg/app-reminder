/**
 * Phase 8: agent máy tính báo cáo thời lượng dùng app.
 *
 * Trọng tâm là tính **gửi lại bao nhiêu lần cũng ra một kết quả** — agent chạy
 * trên máy con, mất mạng rồi gửi bù là chuyện thường ngày, và số giờ dùng máy
 * bị cộng đôi thì báo cáo cho phụ huynh thành vô nghĩa.
 */
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { after, before, beforeEach, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { buildDeviceSummary, getDeviceEntry } from '../src/diary/device.js'
import { categoryOf } from '../src/lib/appCategory.js'
import { addDays, vnToday } from '../src/lib/time.js'
import {
  authenticateAgent, buildScreenSummary, hashAgentToken, ingestReport, newAgentToken, recategorize,
} from '../src/screen/report.js'
import { registerAgentRoute } from '../src/screen/route.js'

const MARK = `screen-${Date.now()}`
let familyId = ''
let parentId = ''
let childId = ''
let deviceId = ''
let rawToken = ''

const TODAY = vnToday()

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const parent = await db.user.create({
    data: { familyId, name: 'Bố', email: `${MARK}-bo@test.local`, passwordHash: 'x', role: 'PARENT' },
  })
  parentId = parent.id
  const child = await db.user.create({
    data: { familyId, name: 'Con', email: `${MARK}-con@test.local`, passwordHash: 'x', role: 'CHILD' },
  })
  childId = child.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

beforeEach(async () => {
  await db.agentDevice.deleteMany({ where: { userId: { in: [parentId, childId] } } })
  await db.diaryEntry.deleteMany({ where: { userId: { in: [parentId, childId] } } })
  rawToken = newAgentToken()
  const device = await db.agentDevice.create({
    data: { userId: childId, name: 'MacBook của con', platform: 'darwin', tokenHash: hashAgentToken(rawToken) },
  })
  deviceId = device.id
})

describe('xác thực agent', () => {
  it('token đúng thì tra ra máy và chủ của nó', async () => {
    const device = await authenticateAgent(rawToken)
    assert.equal(device?.id, deviceId)
    assert.equal(device?.userId, childId)
  })

  it('token sai, thiếu, hoặc của người đã bị khoá đều bị từ chối', async () => {
    assert.equal(await authenticateAgent(undefined), null)
    assert.equal(await authenticateAgent('khong-phai-token'), null)

    await db.user.update({ where: { id: childId }, data: { active: false } })
    assert.equal(await authenticateAgent(rawToken), null, 'khoá tài khoản thì agent cũng ngừng gửi được')
    await db.user.update({ where: { id: childId }, data: { active: true } })
  })

  it('DB chỉ giữ hash, không giữ token thô', async () => {
    const row = await db.agentDevice.findUniqueOrThrow({ where: { id: deviceId } })
    assert.notEqual(row.tokenHash, rawToken)
    assert.equal(row.tokenHash, hashAgentToken(rawToken))
  })
})

describe('nhận báo cáo', () => {
  it('gửi lại cùng một báo cáo không làm số bị cộng đôi', async () => {
    const samples = [{ app: 'Visual Studio Code', minutes: 90 }, { app: 'YouTube', minutes: 45 }]

    await ingestReport(deviceId, childId, TODAY, samples)
    await ingestReport(deviceId, childId, TODAY, samples)
    await ingestReport(deviceId, childId, TODAY, samples)

    const rows = await db.screenReport.findMany({ where: { deviceId, date: TODAY } })
    assert.equal(rows.length, 2)
    assert.equal(rows.reduce((s, r) => s + r.minutes, 0), 135)
  })

  it('số mới đè số cũ — agent gửi tổng cả ngày, không gửi phần chênh', async () => {
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 20 }])
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 35 }])

    const row = await db.screenReport.findFirstOrThrow({ where: { deviceId, date: TODAY, app: 'YouTube' } })
    assert.equal(row.minutes, 35)
  })

  it('app biến mất khỏi báo cáo thì bị xoá, không đọng lại số cũ', async () => {
    await ingestReport(deviceId, childId, TODAY, [
      { app: 'YouTube', minutes: 30 },
      { app: 'Nhieu', minutes: 3 },
    ])
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 30 }])

    const apps = (await db.screenReport.findMany({ where: { deviceId, date: TODAY } })).map((r) => r.app)
    assert.deepEqual(apps, ['YouTube'])
  })

  it('gộp các dòng trùng tên trong cùng một lần gửi', async () => {
    await ingestReport(deviceId, childId, TODAY, [
      { app: 'Zalo', minutes: 10 },
      { app: 'Zalo', minutes: 15 },
    ])
    const row = await db.screenReport.findFirstOrThrow({ where: { deviceId, date: TODAY, app: 'Zalo' } })
    assert.equal(row.minutes, 25)
  })

  it('bỏ dòng rác: tên rỗng, 0 phút, quá 24 giờ', async () => {
    await ingestReport(deviceId, childId, TODAY, [
      { app: '   ', minutes: 30 },
      { app: 'Idle', minutes: 0 },
      { app: 'Loi', minutes: 99999 },
    ])
    const rows = await db.screenReport.findMany({ where: { deviceId, date: TODAY } })
    assert.deepEqual(rows.map((r) => [r.app, r.minutes]), [['Loi', 1440]])
  })

  it('ghi nhận lúc agent báo cáo lần cuối', async () => {
    const before_ = await db.agentDevice.findUniqueOrThrow({ where: { id: deviceId } })
    assert.equal(before_.lastReportAt, null)
    await ingestReport(deviceId, childId, TODAY, [{ app: 'Safari', minutes: 5 }])
    const after_ = await db.agentDevice.findUniqueOrThrow({ where: { id: deviceId } })
    assert.notEqual(after_.lastReportAt, null)
  })

  it('hai máy của cùng một người cộng vào nhau, không đè nhau', async () => {
    const second = await db.agentDevice.create({
      data: { userId: childId, name: 'Máy bàn', tokenHash: hashAgentToken(newAgentToken()) },
    })
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 30 }])
    await ingestReport(second.id, childId, TODAY, [{ app: 'YouTube', minutes: 20 }])

    const summary = await buildScreenSummary(childId, TODAY, TODAY)
    assert.equal(summary.totalMinutes, 50)
    assert.deepEqual(summary.byApp, [{ app: 'YouTube', category: 'entertainment', minutes: 50 }])
  })
})

describe('phân loại app', () => {
  it('xếp đúng nhóm quen thuộc', () => {
    assert.equal(categoryOf('Visual Studio Code'), 'work')
    assert.equal(categoryOf('YouTube'), 'entertainment')
    assert.equal(categoryOf('Zalo'), 'social')
    assert.equal(categoryOf('Google Classroom'), 'study')
    assert.equal(categoryOf('Máy tính'), 'other')
  })

  it('không phân biệt hoa thường', () => {
    assert.equal(categoryOf('youtube.exe'), 'entertainment')
    assert.equal(categoryOf('ZALO'), 'social')
  })

  it('học đứng trước giải trí: Classroom là học dù mở trong Chrome', () => {
    assert.equal(categoryOf('Google Classroom — Chrome'), 'study')
  })

  it('sửa bảng phân loại thì dữ liệu cũ tính lại được', async () => {
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 30 }])
    // giả lập dữ liệu xếp sai từ trước
    await db.screenReport.updateMany({ where: { deviceId, date: TODAY }, data: { category: 'other' } })

    assert.equal(await recategorize(), 1)
    const row = await db.screenReport.findFirstOrThrow({ where: { deviceId, date: TODAY } })
    assert.equal(row.category, 'entertainment')
  })
})

describe('tổng hợp báo cáo', () => {
  it('trục ngày liên tục, kể cả ngày không bật máy', async () => {
    await ingestReport(deviceId, childId, TODAY, [{ app: 'Safari', minutes: 60 }])
    const from = addDays(TODAY, -3)

    const s = await buildScreenSummary(childId, from, TODAY)

    assert.equal(s.byDay.length, 4)
    assert.deepEqual(s.byDay.map((d) => d.minutes), [0, 0, 0, 60])
  })

  it('trung bình tính trên ngày CÓ dùng máy, không chia cho cả kỳ', async () => {
    await ingestReport(deviceId, childId, TODAY, [{ app: 'Safari', minutes: 60 }])

    const s = await buildScreenSummary(childId, addDays(TODAY, -9), TODAY)

    assert.equal(s.totalMinutes, 60)
    assert.equal(s.avgPerActiveDay, 60, 'chia cho 1 ngày có dữ liệu, không phải 10')
  })

  it('kỳ không có dữ liệu thì trả 0 chứ không chia cho 0', async () => {
    const s = await buildScreenSummary(childId, addDays(TODAY, -6), TODAY)
    assert.equal(s.totalMinutes, 0)
    assert.equal(s.avgPerActiveDay, 0)
  })

  it('gộp app lẻ thành một dòng "N app khác"', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ app: `App ${i}`, minutes: 15 - i }))
    await ingestReport(deviceId, childId, TODAY, many)

    const s = await buildScreenSummary(childId, TODAY, TODAY)

    assert.equal(s.byApp.length, 13, '12 app đầu + 1 dòng gộp')
    assert.equal(s.byApp.at(-1)!.app, '3 app khác')
    assert.equal(s.byApp.reduce((sum, a) => sum + a.minutes, 0), s.totalMinutes)
  })

  it('chỉ đọc dữ liệu của đúng người đó', async () => {
    const parentDevice = await db.agentDevice.create({
      data: { userId: parentId, name: 'Máy bố', tokenHash: hashAgentToken(newAgentToken()) },
    })
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 30 }])
    await ingestReport(parentDevice.id, parentId, TODAY, [{ app: 'Excel', minutes: 120 }])

    const s = await buildScreenSummary(childId, TODAY, TODAY)
    assert.equal(s.totalMinutes, 30)
    assert.deepEqual(s.byApp.map((a) => a.app), ['YouTube'])
  })
})

describe('nhật ký tự động từ máy tính', () => {
  it('gom theo nhóm và kể tên app nhiều nhất', async () => {
    await ingestReport(deviceId, childId, TODAY, [
      { app: 'Visual Studio Code', minutes: 90 },
      { app: 'YouTube', minutes: 40 },
      { app: 'Zalo', minutes: 20 },
    ])

    const s = await buildDeviceSummary(childId, TODAY)

    assert.equal(s.empty, false)
    assert.equal(s.totalMinutes, 150)
    assert.match(s.text, /Làm việc/)
    assert.match(s.text, /Visual Studio Code/)
    assert.match(s.text, /Giải trí/)
  })

  it('bỏ qua app chỉ bật vài phút', async () => {
    await ingestReport(deviceId, childId, TODAY, [
      { app: 'YouTube', minutes: 60 },
      { app: 'Lo tay bam', minutes: 2 },
    ])
    const s = await buildDeviceSummary(childId, TODAY)
    assert.equal(s.totalMinutes, 60)
    assert.doesNotMatch(s.text, /Lo tay bam/)
  })

  it('ngày không dùng máy thì không đẻ ra entry rỗng', async () => {
    assert.equal((await buildDeviceSummary(childId, TODAY)).empty, true)
    assert.equal(await getDeviceEntry(childId, TODAY), null)
    assert.equal(
      await db.diaryEntry.count({ where: { userId: childId, source: 'AUTO_DEVICE' } }),
      0,
    )
  })

  it('bản AUTO_DEVICE sống song song với bản viết tay, không đè lên', async () => {
    await db.diaryEntry.create({
      data: { userId: childId, date: TODAY, source: 'MANUAL', content: 'Hôm nay con vui' },
    })
    await ingestReport(deviceId, childId, TODAY, [{ app: 'YouTube', minutes: 60 }])

    await getDeviceEntry(childId, TODAY)

    const entries = await db.diaryEntry.findMany({ where: { userId: childId, date: TODAY } })
    assert.equal(entries.length, 2)
    assert.equal(entries.find((e) => e.source === 'MANUAL')?.content, 'Hôm nay con vui')
  })

  it('ngày đã qua giữ nguyên bản đã lưu, không tính lại', async () => {
    const yesterday = addDays(TODAY, -1)
    await ingestReport(deviceId, childId, yesterday, [{ app: 'YouTube', minutes: 60 }])
    const first = await getDeviceEntry(childId, yesterday)
    assert.notEqual(first, null)

    // gỡ agent -> dữ liệu thô biến mất, nhưng lịch sử nhật ký phải còn
    await db.screenReport.deleteMany({ where: { deviceId, date: yesterday } })
    const again = await getDeviceEntry(childId, yesterday)

    assert.equal(again?.content, first?.content)
  })
})

// ---------------------------------------------------------------------------

/**
 * Hợp đồng HTTP với agent. Test qua Fastify thật (`inject`) chứ không gọi hàm
 * trực tiếp: phần dễ sai nhất ở đây là đọc header `Authorization` và trả đúng
 * mã lỗi — gọi hàm thì bỏ qua đúng phần đó.
 */
describe('POST /agent/report', () => {
  const build = async () => {
    const app = Fastify()
    await registerAgentRoute(app)
    await app.ready()
    return app
  }

  const post = (token: string | null, payload: unknown) =>
    build().then(async (app) => {
      const res = await app.inject({
        method: 'POST',
        url: '/agent/report',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as object,
      })
      await app.close()
      return res
    })

  it('token đúng thì nhận và ghi lại', async () => {
    const res = await post(rawToken, { date: TODAY, samples: [{ app: 'Chrome', minutes: 25 }] })

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { ok: true, rows: 1 })
    const row = await db.screenReport.findFirstOrThrow({ where: { deviceId, date: TODAY } })
    assert.equal(row.minutes, 25)
  })

  it('không có header thì 401 và không ghi gì', async () => {
    const res = await post(null, { date: TODAY, samples: [{ app: 'Chrome', minutes: 25 }] })

    assert.equal(res.statusCode, 401)
    assert.equal(await db.screenReport.count({ where: { deviceId } }), 0)
  })

  it('token sai thì 401, và không nói rõ sai chỗ nào', async () => {
    const res = await post('token-bia-ra', { date: TODAY, samples: [] })
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.json(), { error: 'Token không hợp lệ' })
  })

  it('kiểm tra token TRƯỚC khi kiểm tra dữ liệu', async () => {
    // body hỏng + token sai -> phải là 401, không phải 400. Trả 400 là để lộ
    // rằng token đó có thật.
    const res = await post('token-bia-ra', { date: 'hom-nay', samples: 'khong-phai-mang' })
    assert.equal(res.statusCode, 401)
  })

  it('ngày sai định dạng thì 400', async () => {
    const res = await post(rawToken, { date: '21/09/2026', samples: [] })
    assert.equal(res.statusCode, 400)
  })

  it('gửi quá 500 dòng thì từ chối, không để agent hỏng làm phình DB', async () => {
    const samples = Array.from({ length: 501 }, (_, i) => ({ app: `App ${i}`, minutes: 1 }))
    const res = await post(rawToken, { date: TODAY, samples })
    assert.equal(res.statusCode, 400)
  })

  it('/agent/ping cho agent tự kiểm tra token lúc khởi động', async () => {
    const app = await build()
    const ok = await app.inject({ url: '/agent/ping', headers: { authorization: `Bearer ${rawToken}` } })
    const bad = await app.inject({ url: '/agent/ping' })
    await app.close()

    assert.equal(ok.statusCode, 200)
    assert.equal(ok.json().device, 'MacBook của con')
    assert.equal(bad.statusCode, 401)
  })
})
