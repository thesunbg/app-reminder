/**
 * Đọc toàn bộ dữ liệu của một gia đình ra thành object đúng định dạng backup.
 *
 * Tách khỏi route để test gọi thẳng được, và để phần "lấy gì trong DB" nằm
 * cạnh phần "nạp lại vào DB" (`restore.ts`) — hai file này phải đi cùng nhau,
 * thêm bảng mới mà chỉ sửa một bên là file backup thiếu dữ liệu âm thầm.
 */
import { db } from '../db.js'
import { BACKUP_APP, BACKUP_KIND, BACKUP_VERSION, type Backup } from './format.js'

export type BuildOptions = {
  /** Kèm ảnh đề bài (Bytes trong Postgres). Tắt thì file nhẹ đi rất nhiều. */
  attachments: boolean
}

export async function buildBackup(
  familyId: string,
  by: { id: string; name: string; email: string },
  opts: BuildOptions,
): Promise<Backup> {
  const family = await db.family.findUniqueOrThrow({ where: { id: familyId } })

  const users = await db.user.findMany({
    where: { familyId },
    orderBy: { createdAt: 'asc' },
  })
  const userIds = users.map((u) => u.id)

  const [routines, events, notes, diary, classSchedule, studyRecords, healthRecords, agentDevices] =
    await Promise.all([
      db.routine.findMany({ where: { familyId }, orderBy: { createdAt: 'asc' } }),
      db.event.findMany({ where: { familyId }, orderBy: { createdAt: 'asc' } }),
      db.note.findMany({ where: { familyId }, orderBy: { createdAt: 'asc' } }),
      db.diaryEntry.findMany({ where: { userId: { in: userIds } }, orderBy: [{ userId: 'asc' }, { date: 'asc' }] }),
      db.classSchedule.findMany({ where: { childId: { in: userIds } }, orderBy: [{ childId: 'asc' }, { weekday: 'asc' }, { period: 'asc' }] }),
      db.studyRecord.findMany({ where: { childId: { in: userIds } }, orderBy: { createdAt: 'asc' } }),
      db.healthRecord.findMany({ where: { userId: { in: userIds } }, orderBy: [{ userId: 'asc' }, { date: 'asc' }] }),
      db.agentDevice.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'asc' } }),
    ])

  const [taskLogs, eventOccurrences, noteItems, attachments, screenReports] = await Promise.all([
    db.taskLog.findMany({ where: { routineId: { in: routines.map((r) => r.id) } }, orderBy: { date: 'asc' } }),
    db.eventOccurrence.findMany({ where: { eventId: { in: events.map((e) => e.id) } }, orderBy: { solarDate: 'asc' } }),
    db.noteItem.findMany({ where: { noteId: { in: notes.map((n) => n.id) } }, orderBy: { sortOrder: 'asc' } }),
    opts.attachments
      ? db.studyAttachment.findMany({ where: { recordId: { in: studyRecords.map((s) => s.id) } }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([]),
    db.screenReport.findMany({ where: { deviceId: { in: agentDevices.map((d) => d.id) } }, orderBy: [{ date: 'asc' }, { app: 'asc' }] }),
  ])

  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    createdAt: new Date(),
    createdBy: by,
    family: { id: family.id, name: family.name, timezone: family.timezone, createdAt: family.createdAt },
    // Bỏ familyId khỏi từng dòng: cả file đã là của một nhà, và lúc nạp lại
    // mọi dòng đều bị gán vào gia đình của người bấm khôi phục.
    users: users.map(({ familyId: _f, telegramLinkCode: _c, telegramLinkExpires: _e, ...u }) => u),
    routines: routines.map(({ familyId: _f, ...r }) => r),
    taskLogs,
    events: events.map(({ familyId: _f, ...e }) => e),
    eventOccurrences,
    notes: notes.map(({ familyId: _f, ...n }) => n),
    noteItems,
    diary,
    classSchedule,
    studyRecords,
    studyAttachments: attachments.map(({ data, ...a }) => ({ ...a, data: Buffer.from(data).toString('base64') })),
    healthRecords,
    agentDevices,
    screenReports,
  }
}
