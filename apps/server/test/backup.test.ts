/**
 * Sao lưu & khôi phục.
 *
 * Đây là thứ chỉ được dùng đúng vào ngày tệ nhất, nên nó phải đúng từ trước
 * ngày đó. Ba câu hỏi test này trả lời:
 *  1. Tải xuống có LẤY ĐỦ không — thiếu một bảng thì đến lúc cần mới biết.
 *  2. Nạp lại có RA ĐÚNG như cũ không, kể cả ảnh nhị phân và mật khẩu.
 *  3. Nạp lại có LÀM HỎNG dữ liệu đang có không (chế độ bù), và có từ chối
 *     đúng lúc cần từ chối không (file thiếu quản trị, người không phải admin).
 */
import assert from 'node:assert/strict'
import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { after, before, beforeEach, describe, it } from 'node:test'
import { buildBackup } from '../src/backup/build.js'
import { BACKUP_TABLES, backupSchema, countRows, type Backup } from '../src/backup/format.js'
import { registerBackupRoute } from '../src/backup/route.js'
import { restoreBackup } from '../src/backup/restore.js'
import { db } from '../src/db.js'
import { createSession, SESSION_COOKIE } from '../src/lib/session.js'

const MARK = `bk-${Date.now()}`
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

let familyId = ''
let adminId = ''
let childId = ''

/** Dựng lại từ đầu một gia đình có dữ liệu ở MỌI bảng mà backup phải chở. */
async function seedFamily() {
  const family = await db.family.create({ data: { name: `Nhà ${MARK}`, timezone: 'Asia/Ho_Chi_Minh' } })
  familyId = family.id

  const admin = await db.user.create({
    data: {
      familyId, name: 'Bố', email: `${MARK}-bo@test.local`, passwordHash: 'hash-cua-bo',
      role: 'PARENT', isAdmin: true, diaryPrivate: false, quietFrom: '22:30', quietTo: '06:00',
      dailyDigestAt: '21:00',
    },
  })
  adminId = admin.id

  const child = await db.user.create({
    data: {
      familyId, name: 'Con', email: `${MARK}-con@test.local`, passwordHash: 'hash-cua-con',
      role: 'CHILD', birthday: '2014-03-05', diaryPrivate: true,
    },
  })
  childId = child.id

  const routine = await db.routine.create({
    data: {
      familyId, ownerId: childId, title: 'Học bài', timeOfDay: '19:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', startDate: '2026-01-01', nagAfterMin: 20,
    },
  })
  await db.taskLog.createMany({
    data: [
      { routineId: routine.id, date: '2026-09-01', status: 'DONE', actualMin: 40 },
      { routineId: routine.id, date: '2026-09-02', status: 'SKIPPED', note: 'ốm' },
    ],
  })

  const event = await db.event.create({
    data: {
      familyId, title: 'Giỗ ông nội', type: 'DEATH_ANNIVERSARY', calendar: 'LUNAR',
      lunarDay: 10, lunarMonth: 3, note: 'làm ở nhà bác cả',
    },
  })
  await db.eventOccurrence.createMany({
    data: [
      { eventId: event.id, year: 2026, solarDate: '2026-04-26' },
      { eventId: event.id, year: 2027, solarDate: '2027-04-15' },
    ],
  })
  // sự kiện sinh nhật tự sinh: birthdayUserId là khoá duy nhất, chỗ dễ vỡ nhất
  // khi nạp lại nên phải có mặt trong bộ dữ liệu test.
  await db.event.create({
    data: { familyId, title: 'Sinh nhật Con', type: 'BIRTHDAY', solarDate: '03-05', birthdayUserId: childId },
  })

  const note = await db.note.create({
    data: {
      familyId, ownerId: adminId, title: 'Thay dầu xe', kind: 'CHECKLIST',
      labels: ['xe', 'bảo dưỡng'], remindDate: '2026-12-01', recurIntervalDays: 180, shared: true,
    },
  })
  await db.noteItem.createMany({
    data: [
      { noteId: note.id, text: 'Gọi garage', sortOrder: 0 },
      { noteId: note.id, text: 'Kiểm tra lốp', checked: true, sortOrder: 1 },
    ],
  })

  await db.diaryEntry.createMany({
    data: [
      { userId: adminId, date: '2026-09-01', content: 'Hôm nay cả nhà đi ăn', mood: 5 },
      { userId: childId, date: '2026-09-01', content: 'Riêng tư của con', mood: 3 },
    ],
  })

  await db.classSchedule.create({
    data: {
      childId, weekday: 2, period: 1, subject: 'Toán', room: 'A1',
      startTime: '07:15', endTime: '08:00', effectiveFrom: '2026-09-01',
    },
  })

  const study = await db.studyRecord.create({
    data: { childId, kind: 'HOMEWORK', title: 'Làm nốt bài hình', subject: 'Toán', date: '2026-09-10' },
  })
  await db.studyAttachment.create({
    data: { recordId: study.id, mime: 'image/png', size: PNG.length, width: 16, height: 16, data: PNG },
  })

  await db.healthRecord.createMany({
    data: [
      { userId: childId, kind: 'GROWTH', date: '2026-09-01', heightCm: 150.5, weightKg: 41.2 },
      { userId: childId, kind: 'VACCINE', date: '2026-08-01', title: 'Cúm mùa', nextDate: '2027-08-01' },
    ],
  })

  const device = await db.agentDevice.create({
    data: { userId: childId, tokenHash: `${MARK}-token`, name: 'MacBook của con', platform: 'darwin' },
  })
  await db.screenReport.createMany({
    data: [
      { userId: childId, deviceId: device.id, date: '2026-09-01', app: 'Chrome', category: 'other', minutes: 45 },
      { userId: childId, deviceId: device.id, date: '2026-09-01', app: 'Code', category: 'work', minutes: 90 },
    ],
  })
}

const backupNow = () =>
  buildBackup(familyId, { id: adminId, name: 'Bố', email: `${MARK}-bo@test.local` }, { attachments: true })

/** Đi qua zod y như khi nạp file thật: bắt được cả lỗi định dạng lúc ghi ra. */
function reparse(data: Backup): Backup {
  return backupSchema.parse(JSON.parse(JSON.stringify(data)))
}

beforeEach(async () => {
  await db.family.deleteMany({ where: { name: { startsWith: `Nhà ${MARK}` } } })
  await seedFamily()
})

after(async () => {
  await db.family.deleteMany({ where: { name: { startsWith: `Nhà ${MARK}` } } })
  await db.$disconnect()
})

describe('tải bản sao lưu', () => {
  it('lấy đủ mọi bảng, không bảng nào rỗng', async () => {
    const counts = countRows(await backupNow())
    for (const table of BACKUP_TABLES) {
      assert.ok(counts[table] > 0, `bảng "${table}" rỗng — backup thiếu dữ liệu`)
    }
  })

  it('có hash mật khẩu, nếu không thì khôi phục xong không ai đăng nhập được', async () => {
    const data = await backupNow()
    assert.equal(data.users.find((u) => u.role === 'CHILD')?.passwordHash, 'hash-cua-con')
  })

  it('giữ nhật ký riêng tư của con — đây là bản sao lưu, không phải bản chia sẻ', async () => {
    const data = await backupNow()
    assert.ok(data.diary.some((d) => d.content === 'Riêng tư của con'))
  })

  it('không chở theo thứ gắn với thiết bị hay hàng đợi nhắc', async () => {
    const data = await backupNow() as unknown as Record<string, unknown>
    for (const key of ['sessions', 'pushDevices', 'nativeDevices', 'passkeys', 'notifications']) {
      assert.equal(data[key], undefined, `backup không được chứa "${key}"`)
    }
  })

  it('bỏ ảnh được để file nhẹ', async () => {
    const data = await buildBackup(familyId, { id: adminId, name: 'Bố', email: 'x@test.local' }, { attachments: false })
    assert.equal(data.studyAttachments.length, 0)
    assert.ok(data.studyRecords.length > 0, 'bỏ ảnh không được làm mất bài tập')
  })

  it('serialize được sang JSON và đọc lại đúng định dạng', async () => {
    const parsed = reparse(await backupNow())
    assert.equal(parsed.family.name, `Nhà ${MARK}`)
    assert.equal(Buffer.from(parsed.studyAttachments[0]!.data, 'base64').toString('hex'), PNG.toString('hex'))
  })
})

describe('khôi phục kiểu "dựng lại"', () => {
  it('đưa gia đình về đúng trạng thái trong file', async () => {
    const file = reparse(await backupNow())

    // phá hoại: xoá người, xoá việc, đổi tên nhà, thêm ghi chú mới
    await db.user.delete({ where: { id: childId } })
    await db.family.update({ where: { id: familyId }, data: { name: 'Tên bị đổi' } })
    await db.note.create({ data: { familyId, ownerId: adminId, title: 'Ghi chú thêm sau khi backup' } })

    const report = await restoreBackup(familyId, file, { mode: 'replace', dryRun: false })
    assert.equal(report.applied, true)

    const after = countRows(await backupNow())
    assert.deepEqual(after, countRows(file), 'sau khi dựng lại phải giống hệt file')

    const family = await db.family.findUniqueOrThrow({ where: { id: familyId } })
    assert.equal(family.name, `Nhà ${MARK}`)
    assert.equal(await db.note.count({ where: { familyId, title: 'Ghi chú thêm sau khi backup' } }), 0,
      'dữ liệu thêm sau bản backup phải biến mất — đó là ý nghĩa của "dựng lại"')
  })

  it('giữ nguyên nội dung, kể cả ảnh nhị phân và mật khẩu', async () => {
    const file = reparse(await backupNow())
    await restoreBackup(familyId, file, { mode: 'replace', dryRun: false })

    const child = await db.user.findUniqueOrThrow({ where: { id: childId } })
    assert.equal(child.passwordHash, 'hash-cua-con')
    assert.equal(child.birthday, '2014-03-05')

    const attachment = await db.studyAttachment.findFirstOrThrow({})
    assert.equal(Buffer.from(attachment.data).toString('hex'), PNG.toString('hex'))

    const note = await db.note.findFirstOrThrow({ where: { title: 'Thay dầu xe' }, include: { items: true } })
    assert.deepEqual(note.labels, ['xe', 'bảo dưỡng'])
    assert.equal(note.items.length, 2)
    assert.equal(note.items.find((i) => i.text === 'Kiểm tra lốp')?.checked, true)

    const birthday = await db.event.findFirstOrThrow({ where: { birthdayUserId: childId } })
    assert.equal(birthday.title, 'Sinh nhật Con')
  })

  it('chạy lại lần nữa vẫn ra đúng chừng đó, không đẻ thêm bản sao', async () => {
    const file = reparse(await backupNow())
    await restoreBackup(familyId, file, { mode: 'replace', dryRun: false })
    await restoreBackup(familyId, file, { mode: 'replace', dryRun: false })
    assert.deepEqual(countRows(await backupNow()), countRows(file))
  })

  it('xem trước không đụng vào dữ liệu nhưng vẫn đếm đúng số thật', async () => {
    const file = reparse(await backupNow())
    await db.note.create({ data: { familyId, ownerId: adminId, title: 'Vẫn phải còn đây' } })
    const before = countRows(await backupNow())

    const report = await restoreBackup(familyId, file, { mode: 'replace', dryRun: true })

    assert.equal(report.applied, false)
    assert.equal(report.restored.users, file.users.length)
    assert.equal(report.restored.studyAttachments, file.studyAttachments.length)
    assert.deepEqual(countRows(await backupNow()), before, 'xem trước mà ghi vào DB là hỏng')
    assert.equal(await db.note.count({ where: { familyId, title: 'Vẫn phải còn đây' } }), 1)
  })

  it('từ chối file không có quản trị nào — khôi phục xong không ai quản lý được nhà', async () => {
    const file = reparse(await backupNow())
    file.users = file.users.map((u) => ({ ...u, isAdmin: false }))

    await assert.rejects(
      () => restoreBackup(familyId, file, { mode: 'replace', dryRun: false }),
      /quản trị gia đình/,
    )
    assert.ok(await db.user.findUnique({ where: { id: childId } }), 'từ chối rồi thì không được xoá gì')
  })

  it('từ chối khi email trong file đang thuộc về gia đình khác', async () => {
    const file = reparse(await backupNow())
    // email là khoá duy nhất trên toàn bảng, nên con trong nhà mình phải nhường
    // email đi thì nhà hàng xóm mới giữ được nó
    await db.user.delete({ where: { id: childId } })
    const other = await db.family.create({ data: { name: `Nhà ${MARK} hàng xóm` } })
    await db.user.create({
      data: { familyId: other.id, name: 'Người lạ', email: `${MARK}-con@test.local`, passwordHash: 'x' },
    })

    await assert.rejects(
      () => restoreBackup(familyId, file, { mode: 'replace', dryRun: false }),
      /gia đình khác/,
    )
    assert.equal(await db.user.count({ where: { familyId } }), 1, 'hỏng giữa chừng thì phải rollback sạch')
  })
})

describe('sổ sách báo cáo', () => {
  /**
   * Bảng số liệu trong giao diện có ba cột: trong file / đã chèn / bỏ qua. Hai
   * cột sau phải cộng lại bằng cột đầu, nếu không là có dòng biến mất mà không
   * ai đếm — đúng kiểu lỗi làm người ta tin nhầm rằng đã khôi phục đủ.
   */
  const balanced = (report: { restored: Record<string, number>; skipped: Record<string, number> }, file: Backup) => {
    for (const t of BACKUP_TABLES) {
      assert.equal(
        report.restored[t]! + report.skipped[t]!,
        file[t].length,
        `bảng "${t}": ${report.restored[t]} chèn + ${report.skipped[t]} bỏ qua ≠ ${file[t].length} trong file`,
      )
    }
  }

  it('đã chèn + bỏ qua = số dòng trong file, ở cả hai chế độ', async () => {
    const file = reparse(await backupNow())
    balanced(await restoreBackup(familyId, file, { mode: 'merge', dryRun: true }), file)
    balanced(await restoreBackup(familyId, file, { mode: 'replace', dryRun: true }), file)
  })

  it('vẫn cân cả khi một phần dữ liệu đã bị xoá mất', async () => {
    const file = reparse(await backupNow())
    await db.user.delete({ where: { id: childId } })
    await db.note.deleteMany({ where: { familyId } })

    balanced(await restoreBackup(familyId, file, { mode: 'merge', dryRun: false }), file)
  })
})

describe('khôi phục kiểu "bù phần thiếu"', () => {
  it('lấy lại thứ đã xoá mà không đụng vào thứ ghi thêm sau đó', async () => {
    const file = reparse(await backupNow())

    await db.note.deleteMany({ where: { familyId, title: 'Thay dầu xe' } })
    await db.diaryEntry.deleteMany({ where: { userId: adminId } })
    const added = await db.note.create({ data: { familyId, ownerId: adminId, title: 'Ghi sau khi backup' } })

    const report = await restoreBackup(familyId, file, { mode: 'merge', dryRun: false })

    assert.equal(report.restored.notes, 1, 'chỉ ghi chú bị xoá được chèn lại')
    assert.equal(report.restored.noteItems, 2)
    assert.equal(report.restored.diary, 1)
    assert.equal(report.restored.users, 0, 'người đang có thì để yên')
    assert.ok(await db.note.findUnique({ where: { id: added.id } }), 'ghi chú mới không được biến mất')
    assert.ok(await db.note.findFirst({ where: { familyId, title: 'Thay dầu xe' } }))
  })

  it('không ghi đè nội dung đã sửa sau bản backup', async () => {
    const file = reparse(await backupNow())
    await db.note.updateMany({ where: { familyId, title: 'Thay dầu xe' }, data: { title: 'Thay dầu xe (đã sửa)' } })

    await restoreBackup(familyId, file, { mode: 'merge', dryRun: false })

    assert.ok(await db.note.findFirst({ where: { familyId, title: 'Thay dầu xe (đã sửa)' } }))
    assert.equal(await db.note.count({ where: { familyId } }), 1, 'không được đẻ thêm bản sao')
  })

  it('chạy trên dữ liệu y nguyên thì không chèn gì cả', async () => {
    const file = reparse(await backupNow())
    const report = await restoreBackup(familyId, file, { mode: 'merge', dryRun: false })

    for (const table of BACKUP_TABLES) {
      assert.equal(report.restored[table], 0, `bảng "${table}" bị chèn trùng`)
    }
    assert.deepEqual(countRows(await backupNow()), countRows(file))
  })

  it('người trùng email nhưng khác mã vẫn nhận lại được dữ liệu của mình', async () => {
    // Ca này xảy ra khi nạp backup vào một lần cài đặt mới: tài khoản đã được
    // tạo lại bằng tay nên mã khác, chỉ có email là còn khớp.
    const file = reparse(await backupNow())
    await db.user.delete({ where: { id: childId } })
    const again = await db.user.create({
      data: { familyId, name: 'Con', email: `${MARK}-con@test.local`, passwordHash: 'x', role: 'CHILD' },
    })

    const report = await restoreBackup(familyId, file, { mode: 'merge', dryRun: false })

    assert.equal(report.restored.users, 0, 'không tạo thêm tài khoản thứ hai cho cùng một người')
    assert.equal(await db.diaryEntry.count({ where: { userId: again.id } }), 1)
    assert.equal(await db.healthRecord.count({ where: { userId: again.id } }), 2)
    assert.equal(await db.routine.count({ where: { ownerId: again.id } }), 1)
  })

  it('bỏ qua sự kiện sinh nhật thứ hai của cùng một người', async () => {
    const file = reparse(await backupNow())
    await db.event.deleteMany({ where: { familyId, birthdayUserId: null } })

    await restoreBackup(familyId, file, { mode: 'merge', dryRun: false })

    assert.equal(await db.event.count({ where: { birthdayUserId: childId } }), 1)
  })
})

describe('HTTP', () => {
  const build = async () => {
    const app = Fastify({ bodyLimit: 6 * 1024 * 1024 })
    await app.register(cookie)
    await registerBackupRoute(app)
    await app.ready()
    return app
  }

  const as = async (userId: string) => {
    const { token } = await createSession(userId)
    return { cookie: `${SESSION_COOKIE}=${token}` }
  }

  it('quản trị tải được file, tên file gợi ý sẵn', async () => {
    const app = await build()
    const res = await app.inject({ url: '/backup', headers: await as(adminId) })
    await app.close()

    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-disposition'] as string, /attachment; filename="family-hub-backup-\d{4}-\d{2}-\d{2}\.json"/)
    assert.equal(backupSchema.parse(res.json()).family.name, `Nhà ${MARK}`)
  })

  it('không phải quản trị thì 403 — file có hash mật khẩu của cả nhà', async () => {
    const app = await build()
    const res = await app.inject({ url: '/backup', headers: await as(childId) })
    const guest = await app.inject({ url: '/backup' })
    await app.close()

    assert.equal(res.statusCode, 403)
    assert.equal(guest.statusCode, 401)
  })

  it('khôi phục cũng chỉ dành cho quản trị', async () => {
    const file = reparse(await backupNow())
    const app = await build()
    const res = await app.inject({
      method: 'POST', url: '/backup/restore', headers: await as(childId),
      payload: { mode: 'merge', data: file },
    })
    await app.close()

    assert.equal(res.statusCode, 403)
  })

  it('"dựng lại" mà không gõ đúng chữ xác nhận thì từ chối', async () => {
    const file = reparse(await backupNow())
    const app = await build()
    const headers = await as(adminId)

    const bad = await app.inject({
      method: 'POST', url: '/backup/restore', headers,
      payload: { mode: 'replace', confirm: 'ok', data: file },
    })
    const good = await app.inject({
      method: 'POST', url: '/backup/restore', headers,
      payload: { mode: 'replace', confirm: 'dung lai', data: file },
    })
    await app.close()

    assert.equal(bad.statusCode, 400)
    assert.equal(good.statusCode, 200, 'chữ xác nhận không phân biệt hoa thường')
    assert.equal(good.json().applied, true)
  })

  it('xem trước không cần chữ xác nhận và không ghi gì', async () => {
    const file = reparse(await backupNow())
    const app = await build()
    const res = await app.inject({
      method: 'POST', url: '/backup/restore', headers: await as(adminId),
      payload: { mode: 'replace', dryRun: true, data: file },
    })
    await app.close()

    assert.equal(res.statusCode, 200)
    assert.equal(res.json().applied, false)
    assert.deepEqual(res.json().file, countRows(file))
  })

  it('file lạ thì 400 kèm chỗ sai, không phải 500', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST', url: '/backup/restore', headers: await as(adminId),
      payload: { mode: 'merge', data: { app: 'gi-do', version: 9 } },
    })
    await app.close()

    assert.equal(res.statusCode, 400)
    assert.match(res.json().error, /không đọc được/)
    assert.ok(res.json().detail, 'phải nói rõ hỏng ở đâu')
  })
})
