/**
 * Định dạng file sao lưu — chỗ DUY NHẤT mô tả "một file backup gồm những gì".
 *
 * Khác `GET /export` (bản tải dữ liệu để đọc, lọc theo quyền xem trong app):
 * file này là bản sao đầy đủ của MỘT gia đình, đủ để dựng lại từ đầu trên một
 * máy chủ trắng. Vì vậy nó có cả `passwordHash` — không có thì khôi phục xong
 * chẳng ai đăng nhập được và phải đặt lại mật khẩu cho từng người.
 *
 * Mảng phẳng chứ không lồng nhau: chèn lại bằng `createMany` theo đúng thứ tự
 * khoá ngoại, và đếm số dòng từng bảng để báo cáo cho người dùng dễ hơn nhiều
 * so với việc đi xuyên cây lồng nhau.
 *
 * KHÔNG nằm trong file (cố ý):
 * - `Session`, `PushDevice`, `NativeDevice`, `Passkey`: gắn với một trình duyệt
 *   hoặc một thiết bị cụ thể, chép sang máy khác cũng vô dụng. Đăng nhập lại là
 *   chúng tự sinh ra.
 * - `Notification`: hàng đợi nhắc, scheduler sinh lại trong 15 phút.
 * - `AppState`: trạng thái hạ tầng chung (offset Telegram), không thuộc nhà nào.
 * - `telegramLinkCode`: mã ghép máy dùng một lần, hết hạn sau ít phút.
 */
import { z } from 'zod'

export const BACKUP_APP = 'family-hub'
export const BACKUP_KIND = 'backup'
export const BACKUP_VERSION = 2

const dt = z.coerce.date()
const dtn = z.coerce.date().nullable().default(null)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const dayN = day.nullable().default(null)
const hhmm = z.string().regex(/^\d{2}:\d{2}$/)
const hhmmN = hhmm.nullable().default(null)
const str = z.string()
const strN = z.string().nullable().default(null)

const userSchema = z.object({
  id: str,
  email: str,
  /** Hash argon2/scrypt, không phải mật khẩu thô — nhưng vẫn phải giữ như giữ mật khẩu. */
  passwordHash: str,
  name: str,
  role: z.enum(['PARENT', 'CHILD']),
  isAdmin: z.boolean().default(false),
  birthday: dayN,
  avatarColor: str.default('#6366f1'),
  telegramChatId: strN,
  notifyTelegram: z.boolean().default(true),
  notifyWebPush: z.boolean().default(true),
  notifyHolidays: z.boolean().default(true),
  notifyNative: z.boolean().default(true),
  dailyDigestAt: hhmmN,
  weeklyDigestAt: hhmmN,
  classReminderAt: hhmmN,
  quietFrom: hhmmN,
  quietTo: hhmmN,
  diaryPrivate: z.boolean().default(true),
  active: z.boolean().default(true),
  createdAt: dt,
  icalTokenHash: strN,
  icalCreatedAt: dtn,
  icalLastUsedAt: dtn,
  /**
   * Bí mật TOTP mã hoá bằng SESSION_SECRET. Khôi phục sang máy chủ có secret
   * khác thì giải mã không ra — lúc nạp sẽ thử giải mã và tự tắt 2 bước nếu
   * hỏng, thà bắt bật lại còn hơn khoá người ta ở ngoài cửa.
   */
  totpSecret: strN,
  totpEnabled: z.boolean().default(false),
  recoveryCodes: z.array(str).default([]),
})

const routineSchema = z.object({
  id: str,
  ownerId: str,
  title: str,
  category: str.default('general'),
  color: str.default('#6366f1'),
  durationMin: z.number().int().default(30),
  timeOfDay: hhmm,
  rrule: str,
  startDate: day,
  targetPerWeek: z.number().int().nullable().default(null),
  remindBeforeMin: z.number().int().default(10),
  nagAfterMin: z.number().int().nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  createdAt: dt,
  archivedAt: dtn,
})

const taskLogSchema = z.object({
  id: str,
  routineId: str,
  date: day,
  status: z.enum(['DONE', 'PARTIAL', 'SKIPPED']),
  actualMin: z.number().int().nullable().default(null),
  note: strN,
  doneAt: dt,
})

const eventSchema = z.object({
  id: str,
  title: str,
  type: z.enum(['DEATH_ANNIVERSARY', 'BIRTHDAY', 'OTHER']).default('OTHER'),
  calendar: z.enum(['SOLAR', 'LUNAR', 'LUNAR_MONTHLY']).default('SOLAR'),
  lunarDay: z.number().int().nullable().default(null),
  lunarMonth: z.number().int().nullable().default(null),
  lunarLeap: z.boolean().default(false),
  solarDate: strN,
  yearly: z.boolean().default(true),
  endDate: strN,
  startTime: hhmmN,
  endTime: hhmmN,
  remindBeforeDays: z.array(z.number().int()).default([7, 3, 1, 0]),
  remindAtTime: hhmm.default('08:00'),
  note: strN,
  createdAt: dt,
  birthdayUserId: strN,
})

const occurrenceSchema = z.object({
  id: str,
  eventId: str,
  year: z.number().int(),
  solarDate: day,
  endDate: dayN,
})

const noteSchema = z.object({
  id: str,
  ownerId: str,
  title: str.default(''),
  body: str.default(''),
  kind: z.enum(['TEXT', 'CHECKLIST']).default('TEXT'),
  color: str.default('default'),
  labels: z.array(str).default([]),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  shared: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  remindDate: dayN,
  remindAtTime: hhmm.default('08:00'),
  remindBeforeDays: z.array(z.number().int()).default([1, 0]),
  recurIntervalDays: z.number().int().nullable().default(null),
  doneAt: dtn,
  createdAt: dt,
  updatedAt: dt,
})

const noteItemSchema = z.object({
  id: str,
  noteId: str,
  text: str,
  checked: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
})

const diarySchema = z.object({
  id: str,
  userId: str,
  date: day,
  content: str,
  mood: z.number().int().nullable().default(null),
  source: z.enum(['MANUAL', 'AUTO_TASK', 'AUTO_DEVICE']).default('MANUAL'),
  refId: strN,
  createdAt: dt,
  updatedAt: dt,
})

const classScheduleSchema = z.object({
  id: str,
  childId: str,
  weekday: z.number().int().min(1).max(7),
  period: z.number().int(),
  subject: str,
  room: strN,
  teacher: strN,
  startTime: hhmm,
  endTime: hhmm,
  effectiveFrom: day,
  effectiveTo: dayN,
})

const studyRecordSchema = z.object({
  id: str,
  childId: str,
  subject: strN,
  kind: str,
  title: str,
  score: z.number().nullable().default(null),
  maxScore: z.number().nullable().default(null),
  date: dayN,
  note: strN,
  doneAt: dtn,
  createdAt: dt,
})

const studyAttachmentSchema = z.object({
  id: str,
  recordId: str,
  mime: str,
  size: z.number().int(),
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
  /** Ảnh dạng base64 — JSON không chở được nhị phân. */
  data: str,
  createdAt: dt,
})

const healthRecordSchema = z.object({
  id: str,
  userId: str,
  kind: z.enum(['GROWTH', 'VACCINE', 'CHECKUP', 'MEDICINE']),
  date: day,
  title: str.default(''),
  heightCm: z.number().nullable().default(null),
  weightKg: z.number().nullable().default(null),
  note: strN,
  nextDate: dayN,
  createdAt: dt,
  updatedAt: dt,
})

const agentDeviceSchema = z.object({
  id: str,
  userId: str,
  /** SHA-256 của token agent. Giữ lại thì agent đang chạy không phải cài lại. */
  tokenHash: str,
  name: str,
  platform: strN,
  createdAt: dt,
  lastSeenAt: dtn,
  lastReportAt: dtn,
})

const screenReportSchema = z.object({
  id: str,
  userId: str,
  deviceId: str,
  date: day,
  app: str,
  category: str.default('other'),
  minutes: z.number().int().default(0),
  updatedAt: dt,
})

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP),
  kind: z.literal(BACKUP_KIND),
  /** Mới chỉ có version 2. Version 1 là `GET /export`, không nạp lại được. */
  version: z.literal(BACKUP_VERSION),
  createdAt: dt,
  createdBy: z.object({ id: str, name: str, email: str }),
  family: z.object({
    id: str,
    name: str,
    timezone: str.default('Asia/Ho_Chi_Minh'),
    createdAt: dt,
  }),
  users: z.array(userSchema),
  routines: z.array(routineSchema),
  taskLogs: z.array(taskLogSchema),
  events: z.array(eventSchema),
  eventOccurrences: z.array(occurrenceSchema),
  notes: z.array(noteSchema),
  noteItems: z.array(noteItemSchema),
  diary: z.array(diarySchema),
  classSchedule: z.array(classScheduleSchema),
  studyRecords: z.array(studyRecordSchema),
  studyAttachments: z.array(studyAttachmentSchema),
  healthRecords: z.array(healthRecordSchema),
  agentDevices: z.array(agentDeviceSchema),
  screenReports: z.array(screenReportSchema),
})

export type Backup = z.infer<typeof backupSchema>

/** Tên các mảng dữ liệu, dùng để đếm và báo cáo. Không gồm phần đầu file. */
export const BACKUP_TABLES = [
  'users', 'routines', 'taskLogs', 'events', 'eventOccurrences',
  'notes', 'noteItems', 'diary', 'classSchedule', 'studyRecords',
  'studyAttachments', 'healthRecords', 'agentDevices', 'screenReports',
] as const

export type BackupTable = (typeof BACKUP_TABLES)[number]

export type BackupCounts = Record<BackupTable, number>

export function countRows(data: Pick<Backup, BackupTable>): BackupCounts {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, data[t].length])) as BackupCounts
}

/** Nhãn tiếng Việt cho từng bảng — server và web dùng chung một bộ chữ. */
export const TABLE_LABELS: Record<BackupTable, string> = {
  users: 'thành viên',
  routines: 'việc định kỳ',
  taskLogs: 'lượt tick',
  events: 'sự kiện',
  eventOccurrences: 'lần xảy ra',
  notes: 'ghi chú',
  noteItems: 'mục trong ghi chú',
  diary: 'nhật ký',
  classSchedule: 'tiết học',
  studyRecords: 'bài tập & điểm',
  studyAttachments: 'ảnh đính kèm',
  healthRecords: 'sổ sức khoẻ',
  agentDevices: 'máy có agent',
  screenReports: 'dòng thời lượng dùng máy',
}
