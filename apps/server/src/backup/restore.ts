/**
 * Nạp một file backup trở lại vào DB.
 *
 * Hai chế độ, khác nhau ở chỗ động vào dữ liệu đang có hay không:
 *
 * - `replace` — *dựng lại từ đầu*. Xoá sạch dữ liệu của gia đình rồi chép
 *   nguyên file vào. Đây là chế độ cho câu "máy chủ mất rồi, làm lại": kết quả
 *   giống hệt lúc bấm tải backup, không thừa không thiếu. Mọi người BỊ ĐĂNG
 *   XUẤT (bảng Session xoá theo) và phải đăng nhập lại bằng mật khẩu ghi trong
 *   file — nên nếu file không có lấy một quản trị nào còn hoạt động thì từ chối
 *   ngay, thà không khôi phục còn hơn khôi phục xong không ai vào quản lý được.
 *
 * - `merge` — *bù lại phần thiếu*. Chỉ chèn những dòng chưa có, không xoá và
 *   không ghi đè dòng nào. Dùng khi lỡ tay xoá mất một mảng dữ liệu và muốn
 *   lấy lại từ bản backup hôm qua mà không mất những gì đã ghi thêm hôm nay.
 *
 * Cả hai chạy trong MỘT transaction: hỏng giữa chừng thì không để lại nửa nạc
 * nửa mỡ. `dryRun` dùng chung đúng đường code đó rồi rollback ở bước cuối —
 * nhờ vậy số liệu xem trước là số thật, không phải số ước lượng bằng code khác.
 *
 * Không nạp lại: Session, PushDevice, NativeDevice, Passkey, Notification —
 * xem `format.ts` để biết vì sao. Hàng đợi nhắc do scheduler sinh lại trong
 * vòng 15 phút, không cần làm gì thêm.
 */
import type { Prisma } from '@prisma/client'
import { db } from '../db.js'
import { decrypt } from '../lib/secrets.js'
import { BACKUP_TABLES, type Backup, type BackupCounts, type BackupTable } from './format.js'

export type RestoreMode = 'replace' | 'merge'

export type RestoreReport = {
  mode: RestoreMode
  /** true = đã ghi vào DB; false = chỉ xem trước rồi rollback. */
  applied: boolean
  /** Số dòng đã chèn (hoặc sẽ chèn) cho từng bảng. */
  restored: BackupCounts
  /** Số dòng trong file bị bỏ qua vì đã có sẵn hoặc vì thiếu chỗ móc vào. */
  skipped: BackupCounts
  /** Email các quản trị trong file — sau `replace` phải đăng nhập lại bằng một trong số này. */
  admins: string[]
  warnings: string[]
}

/** Lỗi người dùng sửa được (file sai, email đụng nhà khác) — route trả 400. */
export class RestoreError extends Error {}

/** Ném ở cuối transaction của `dryRun` để rollback mọi thứ vừa ghi. */
class Rollback extends Error {
  constructor(readonly report: RestoreReport) {
    super('dry run')
  }
}

const zeroCounts = (): BackupCounts =>
  Object.fromEntries(BACKUP_TABLES.map((t) => [t, 0])) as BackupCounts

export async function restoreBackup(
  familyId: string,
  data: Backup,
  opts: { mode: RestoreMode; dryRun: boolean },
): Promise<RestoreReport> {
  try {
    return await db.$transaction(
      async (tx) => {
        const report = await apply(tx, familyId, data, opts.mode)
        if (opts.dryRun) throw new Rollback({ ...report, applied: false })
        return report
      },
      // Nhà đông người, nhiều năm dữ liệu, kèm ảnh đề bài: hai phút là rộng
      // rãi. Mặc định 5 giây của Prisma thì chắc chắn không đủ.
      { timeout: 120_000, maxWait: 15_000 },
    )
  } catch (err) {
    if (err instanceof Rollback) return err.report
    throw err
  }
}

type Tx = Prisma.TransactionClient

async function apply(tx: Tx, familyId: string, data: Backup, mode: RestoreMode): Promise<RestoreReport> {
  const warnings: string[] = []
  const restored = zeroCounts()
  const skipped = zeroCounts()

  if (data.users.length === 0) {
    throw new RestoreError('File không có thành viên nào — không phải bản sao lưu dùng được')
  }
  const admins = data.users.filter((u) => u.isAdmin && u.active).map((u) => u.email)
  if (mode === 'replace' && admins.length === 0) {
    throw new RestoreError(
      'File không có quản trị gia đình nào còn hoạt động. Khôi phục kiểu "dựng lại" xong sẽ không ai quản lý được thành viên nữa.',
    )
  }

  // ---------- 1. dọn chỗ (chỉ ở chế độ replace) ----------
  if (mode === 'replace') {
    // Xoá người là cascade gần hết: routine, ghi chú, nhật ký, thời khoá biểu,
    // bài tập, sổ sức khoẻ, agent, session, thiết bị push, thông báo. Sự kiện
    // treo ở gia đình chứ không ở người nên phải xoá riêng; routine và ghi chú
    // xoá thêm cho chắc, phòng dòng mồ côi.
    await tx.user.deleteMany({ where: { familyId } })
    await tx.event.deleteMany({ where: { familyId } })
    await tx.note.deleteMany({ where: { familyId } })
    await tx.routine.deleteMany({ where: { familyId } })
    await tx.family.update({
      where: { id: familyId },
      data: { name: data.family.name, timezone: data.family.timezone },
    })
  }

  // ---------- 2. thành viên ----------
  // Ánh xạ id trong file -> id thật trong DB. Thường là chính nó; chỉ khác khi
  // `merge` gặp người đã có sẵn cùng email nhưng khác id (file đến từ một lần
  // cài đặt khác). Thiếu ánh xạ này thì toàn bộ dữ liệu của người đó rơi vào
  // hư không.
  const userMap = new Map<string, string>()

  const clashing = await tx.user.findMany({
    where: {
      OR: [
        { id: { in: data.users.map((u) => u.id) } },
        { email: { in: data.users.map((u) => u.email) } },
      ],
    },
    select: { id: true, email: true, familyId: true, icalTokenHash: true },
  })
  const byId = new Map(clashing.map((u) => [u.id, u]))
  const byEmail = new Map(clashing.map((u) => [u.email, u]))
  const takenIcal = new Set(clashing.map((u) => u.icalTokenHash).filter((h): h is string => !!h))

  let totpDropped = 0
  const usersToCreate: Prisma.UserCreateManyInput[] = []

  for (const u of data.users) {
    const hit = byId.get(u.id) ?? byEmail.get(u.email)
    if (hit) {
      if (hit.familyId !== familyId) {
        // Email là khoá duy nhất trên TOÀN BẢNG: một nhà khác trên cùng máy
        // chủ đang giữ nó. Ở chế độ replace thì không im lặng bỏ qua — bỏ một
        // người là bỏ luôn nhật ký, bài tập, sổ sức khoẻ của người đó.
        if (mode === 'replace') {
          throw new RestoreError(
            `Email ${u.email} đang thuộc về một gia đình khác trên máy chủ này. Gỡ tài khoản đó trước rồi khôi phục lại.`,
          )
        }
        warnings.push(`Bỏ qua ${u.name} (${u.email}): email đang thuộc về một gia đình khác`)
        skipped.users++
        continue
      }
      // Đã có sẵn trong nhà -> giữ nguyên, không ghi đè. Dữ liệu của người này
      // trong file vẫn móc được vào đúng tài khoản đang có.
      userMap.set(u.id, hit.id)
      skipped.users++
      continue
    }

    // Bí mật TOTP mã hoá bằng SESSION_SECRET của máy chủ cũ. Sang máy có secret
    // khác thì nó là rác — bật 2 bước với một bí mật không giải mã nổi là khoá
    // chính chủ ở ngoài cửa.
    let totpSecret = u.totpSecret
    let totpEnabled = u.totpEnabled
    let recoveryCodes = u.recoveryCodes
    if (totpSecret) {
      try {
        decrypt(totpSecret)
      } catch {
        totpSecret = null
        totpEnabled = false
        recoveryCodes = []
        totpDropped++
      }
    }

    usersToCreate.push({
      ...u,
      familyId,
      totpSecret,
      totpEnabled,
      recoveryCodes,
      // Người khác đang giữ đúng hash này -> cấp lại link .ics mới sau.
      icalTokenHash: u.icalTokenHash && takenIcal.has(u.icalTokenHash) ? null : u.icalTokenHash,
    })
    userMap.set(u.id, u.id)
  }

  if (totpDropped > 0) {
    warnings.push(
      `${totpDropped} tài khoản bị tắt đăng nhập 2 bước: bí mật TOTP mã hoá bằng SESSION_SECRET của máy chủ cũ, máy này không giải mã được. Bật lại trong Cài đặt.`,
    )
  }

  restored.users = await insert(usersToCreate, (rows) => tx.user.createMany({ data: rows, skipDuplicates: true }))
  skipped.users += usersToCreate.length - restored.users

  const mapUser = (id: string | null | undefined) => (id ? userMap.get(id) : undefined)

  // ---------- 3. việc định kỳ + lượt tick ----------
  const routines = pickByParent(data.routines, (r) => mapUser(r.ownerId), skipped, 'routines')
  const newRoutines = await keepNew(
    routines, familyId, skipped, 'routines', warnings,
    (ids) => tx.routine.findMany({ where: { id: { in: ids } }, select: { id: true, familyId: true } }),
  )
  restored.routines = await insert(
    newRoutines.create.map((r) => ({ ...r, familyId, ownerId: userMap.get(r.ownerId)! })),
    (rows) => tx.routine.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.routines += newRoutines.create.length - restored.routines

  const logs = pickByParent(data.taskLogs, (l) => orUndefined(l.routineId, newRoutines.live), skipped, 'taskLogs')
  restored.taskLogs = await insert(logs, (rows) => tx.taskLog.createMany({ data: rows, skipDuplicates: true }))
  skipped.taskLogs += logs.length - restored.taskLogs

  // ---------- 4. sự kiện + lần xảy ra ----------
  // birthdayUserId là khoá duy nhất: mỗi người đúng một sự kiện sinh nhật tự
  // sinh. Ai đã có sẵn một cái thì bỏ luôn cái trong file, đừng chèn thành cái
  // thứ hai; ai không còn trong nhà thì gỡ liên kết nhưng vẫn giữ sự kiện lại
  // như một ngày kỷ niệm thường.
  const hasBirthday = new Set(
    (await tx.event.findMany({
      where: { familyId, birthdayUserId: { not: null } },
      select: { birthdayUserId: true },
    })).map((e) => e.birthdayUserId!),
  )
  const eventRows: Backup['events'] = []
  for (const e of data.events) {
    const owner = mapUser(e.birthdayUserId)
    if (e.birthdayUserId && owner && hasBirthday.has(owner)) {
      skipped.events++
      continue
    }
    if (owner) hasBirthday.add(owner)
    eventRows.push({ ...e, birthdayUserId: owner ?? null })
  }
  const newEvents = await keepNew(
    eventRows, familyId, skipped, 'events', warnings,
    (ids) => tx.event.findMany({ where: { id: { in: ids } }, select: { id: true, familyId: true } }),
  )
  restored.events = await insert(
    newEvents.create.map((e) => ({ ...e, familyId })),
    (rows) => tx.event.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.events += newEvents.create.length - restored.events

  const occ = pickByParent(data.eventOccurrences, (o) => orUndefined(o.eventId, newEvents.live), skipped, 'eventOccurrences')
  restored.eventOccurrences = await insert(occ, (rows) => tx.eventOccurrence.createMany({ data: rows, skipDuplicates: true }))
  skipped.eventOccurrences += occ.length - restored.eventOccurrences

  // ---------- 5. ghi chú + mục trong ghi chú ----------
  const notes = pickByParent(data.notes, (n) => mapUser(n.ownerId), skipped, 'notes')
  const newNotes = await keepNew(
    notes, familyId, skipped, 'notes', warnings,
    (ids) => tx.note.findMany({ where: { id: { in: ids } }, select: { id: true, familyId: true } }),
  )
  restored.notes = await insert(
    newNotes.create.map((n) => ({ ...n, familyId, ownerId: userMap.get(n.ownerId)! })),
    (rows) => tx.note.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.notes += newNotes.create.length - restored.notes

  const items = pickByParent(data.noteItems, (i) => orUndefined(i.noteId, newNotes.live), skipped, 'noteItems')
  restored.noteItems = await insert(items, (rows) => tx.noteItem.createMany({ data: rows, skipDuplicates: true }))
  skipped.noteItems += items.length - restored.noteItems

  // ---------- 6. nhật ký, thời khoá biểu, học tập, sức khoẻ ----------
  const diary = pickByParent(data.diary, (d) => mapUser(d.userId), skipped, 'diary')
  restored.diary = await insert(
    diary.map((d) => ({ ...d, userId: userMap.get(d.userId)! })),
    (rows) => tx.diaryEntry.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.diary += diary.length - restored.diary

  const classes = pickByParent(data.classSchedule, (c) => mapUser(c.childId), skipped, 'classSchedule')
  restored.classSchedule = await insert(
    classes.map((c) => ({ ...c, childId: userMap.get(c.childId)! })),
    (rows) => tx.classSchedule.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.classSchedule += classes.length - restored.classSchedule

  const study = pickByParent(data.studyRecords, (s) => mapUser(s.childId), skipped, 'studyRecords')
  restored.studyRecords = await insert(
    study.map((s) => ({ ...s, childId: userMap.get(s.childId)! })),
    (rows) => tx.studyRecord.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.studyRecords += study.length - restored.studyRecords

  const liveStudy = new Set(study.map((s) => s.id))
  const files = pickByParent(data.studyAttachments, (a) => orUndefined(a.recordId, liveStudy), skipped, 'studyAttachments')
  restored.studyAttachments = await insert(
    files.map((a) => ({ ...a, data: Buffer.from(a.data, 'base64') })),
    (rows) => tx.studyAttachment.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.studyAttachments += files.length - restored.studyAttachments

  const health = pickByParent(data.healthRecords, (h) => mapUser(h.userId), skipped, 'healthRecords')
  restored.healthRecords = await insert(
    health.map((h) => ({ ...h, userId: userMap.get(h.userId)! })),
    (rows) => tx.healthRecord.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.healthRecords += health.length - restored.healthRecords

  // ---------- 7. agent máy tính + thời lượng dùng máy ----------
  const devices = pickByParent(data.agentDevices, (d) => mapUser(d.userId), skipped, 'agentDevices')
  restored.agentDevices = await insert(
    devices.map((d) => ({ ...d, userId: userMap.get(d.userId)! })),
    (rows) => tx.agentDevice.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.agentDevices += devices.length - restored.agentDevices

  const liveDevices = new Set(devices.map((d) => d.id))
  const reports = pickByParent(
    data.screenReports,
    (r) => (mapUser(r.userId) ? orUndefined(r.deviceId, liveDevices) : undefined),
    skipped,
    'screenReports',
  )
  restored.screenReports = await insert(
    reports.map((r) => ({ ...r, userId: userMap.get(r.userId)! })),
    (rows) => tx.screenReport.createMany({ data: rows, skipDuplicates: true }),
  )
  skipped.screenReports += reports.length - restored.screenReports

  return { mode, applied: true, restored, skipped, admins, warnings }
}

// ---------- phụ trợ ----------

const orUndefined = (id: string, live: Set<string>) => (live.has(id) ? id : undefined)

/**
 * Bỏ những dòng không còn chỗ móc vào (chủ nhân bị bỏ qua, ghi chú cha không
 * được chèn...). Chèn chúng vào thì khoá ngoại nổ và cả transaction đổ, nên
 * thà mất vài dòng mồ côi còn hơn mất cả lần khôi phục.
 */
function pickByParent<T>(
  rows: T[],
  parent: (row: T) => string | undefined,
  skipped: BackupCounts,
  table: BackupTable,
): T[] {
  const kept = rows.filter((r) => parent(r) !== undefined)
  skipped[table] += rows.length - kept.length
  return kept
}

/**
 * Tách "đã có rồi" khỏi "cần chèn" cho các bảng gắn thẳng vào gia đình.
 *
 * Dòng đã có trong nhà thì giữ nguyên và vẫn tính là *live* — con cháu của nó
 * trong file móc được vào. Dòng trùng mã nhưng thuộc nhà khác thì bỏ hẳn: ghi
 * đè là hỏng dữ liệu nhà người ta, mà móc con cháu vào cũng sai.
 *
 * Ở chế độ replace bảng của nhà mình đã trống từ bước 1, nên nhánh "đã có sẵn"
 * tự nhiên không bao giờ chạy — không cần rẽ theo `mode` ở đây.
 */
async function keepNew<T extends { id: string }>(
  rows: T[],
  familyId: string,
  skipped: BackupCounts,
  table: BackupTable,
  warnings: string[],
  lookup: (ids: string[]) => Promise<{ id: string; familyId: string }[]>,
): Promise<{ create: T[]; live: Set<string> }> {
  const live = new Set<string>()
  if (rows.length === 0) return { create: [], live }

  const existing = new Map((await lookup(rows.map((r) => r.id))).map((r) => [r.id, r.familyId]))

  const create: T[] = []
  let foreign = 0
  for (const row of rows) {
    const owner = existing.get(row.id)
    if (owner === undefined) {
      create.push(row)
      live.add(row.id)
    } else if (owner === familyId) {
      live.add(row.id)
      skipped[table]++
    } else {
      foreign++
      skipped[table]++
    }
  }
  if (foreign > 0) warnings.push(`${foreign} dòng "${table}" trùng mã với dữ liệu của gia đình khác nên bị bỏ qua`)
  return { create, live }
}

/**
 * `skipDuplicates` gánh nốt các khoá duy nhất KHÔNG phải id — (routineId, date)
 * của lượt tick, (userId, date, source) của nhật ký, (deviceId, date, app) của
 * thời lượng dùng máy. Ở chế độ merge đó đúng là hành vi mong muốn: dòng nào
 * đã có thì để yên. Trả về số dòng thật sự chèn được.
 */
async function insert<R>(rows: R[], run: (rows: R[]) => Promise<{ count: number }>): Promise<number> {
  if (rows.length === 0) return 0
  const { count } = await run(rows)
  return count
}
