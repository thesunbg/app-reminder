/**
 * GET /calendar.ics — lịch để ĐĂNG KÝ (subscribe) trong Lịch iPhone, Google
 * Calendar, Outlook…
 *
 * Vì sao cần: trong nhà luôn có người không chịu cài thêm app. Dán một URL vào
 * lịch sẵn có của họ là ngày giỗ, Tết, sinh nhật, chuyến đi hiện thẳng ở chỗ
 * họ vẫn nhìn mỗi ngày.
 *
 * Cố ý KHÔNG xuất việc định kỳ: chúng có nhắc trước, nhắc lại, tick xong — cả
 * một vòng đời mà lịch hệ thống không hiểu. Đổ 6 việc mỗi ngày vào Lịch iPhone
 * chỉ làm hỏng cái lịch đó.
 *
 * Là route thường (không qua tRPC) vì bên kia là phần mềm lịch, không phải
 * trình duyệt đã đăng nhập: nó chỉ biết gọi GET một URL công khai.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { db } from './db.js'
import { holidaysBetween } from './lib/holidays.js'
import { lunarOf } from './lib/lunar.js'
import { addDays, VN_TZ, vnToday } from './lib/time.js'

/** Xuất bao nhiêu lâu về trước và về sau. */
const PAST_DAYS = 400
const FUTURE_DAYS = 400

export const hashIcalToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export const newIcalToken = (): string => randomBytes(24).toString('base64url')

// ---------- soạn file iCalendar (RFC 5545) ----------

/** Escape theo RFC 5545: dấu \ , ; và xuống dòng đều phải thoát. */
function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Gấp dòng ở 75 octet theo RFC 5545. Phải đếm THEO BYTE chứ không theo ký tự —
 * tiếng Việt có dấu chiếm 2–3 byte, cắt theo ký tự là vỡ ở giữa một chữ và
 * phần mềm lịch bên kia hiện ra ký tự rác.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const out: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // lùi về đầu ký tự UTF-8 gần nhất (byte nối tiếp có dạng 10xxxxxx)
    while (end > start && end < bytes.length && (bytes[end]! & 0b1100_0000) === 0b1000_0000) end--
    out.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74 // các dòng sau có thêm một khoảng trắng ở đầu
  }
  return out.join('\r\n ')
}

const pad = (n: number) => String(n).padStart(2, '0')
/** "2026-02-17" → "20260217" */
const dateOnly = (d: string) => d.replace(/-/g, '')
/** "2026-02-17" + "07:30" → "20260217T073000" (giờ địa phương VN) */
const dateTime = (d: string, t: string) => `${dateOnly(d)}T${t.replace(':', '')}00`

function stamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  )
}

type Vevent = {
  uid: string
  summary: string
  description?: string
  /** ngày bắt đầu "YYYY-MM-DD" */
  start: string
  /** ngày kết thúc (đã bao gồm), null = một ngày */
  end?: string | null
  startTime?: string | null
  endTime?: string | null
}

function vevent(e: Vevent, dtstamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstamp}`]

  if (e.startTime) {
    const endDay = e.end ?? e.start
    lines.push(`DTSTART;TZID=${VN_TZ}:${dateTime(e.start, e.startTime)}`)
    // không ghi giờ kết thúc thì coi như dài 1 tiếng — để trống, nhiều phần mềm
    // lịch tự nhét 24 tiếng và sự kiện nuốt trọn cả ngày
    lines.push(`DTEND;TZID=${VN_TZ}:${dateTime(endDay, e.endTime ?? addHour(e.startTime))}`)
  } else {
    // sự kiện cả ngày: DTEND là ngày SAU ngày cuối (RFC 5545 dùng biên mở)
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`)
    lines.push(`DTEND;VALUE=DATE:${dateOnly(addDays(e.end ?? e.start, 1))}`)
  }

  lines.push(`SUMMARY:${esc(e.summary)}`)
  if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`)
  lines.push('TRANSP:TRANSPARENT') // ngày giỗ không làm người ta "bận" trong lịch rảnh/bận
  lines.push('END:VEVENT')
  return lines
}

function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return `${pad(Math.min(h + 1, 23))}:${pad(m)}`
}

const TYPE_ICON: Record<string, string> = {
  DEATH_ANNIVERSARY: '🕯',
  BIRTHDAY: '🎂',
  OTHER: '📌',
}

const HOLIDAY_ICON: Record<string, string> = {
  PUBLIC: '🎉',
  TRADITIONAL: '🏮',
  OBSERVANCE: '⭐',
}

/** Toàn bộ nội dung file .ics cho một gia đình. */
export async function buildFamilyCalendar(
  familyId: string,
  familyName: string,
  now: Date = new Date(),
): Promise<string> {
  const today = vnToday(now)
  const from = addDays(today, -PAST_DAYS)
  const to = addDays(today, FUTURE_DAYS)
  const dtstamp = stamp(now)

  const occurrences = await db.eventOccurrence.findMany({
    where: { event: { familyId }, solarDate: { gte: from, lte: to } },
    include: { event: true },
    orderBy: { solarDate: 'asc' },
  })

  const events: string[] = []

  for (const o of occurrences) {
    const e = o.event
    const lunar = e.calendar === 'SOLAR' ? null : lunarOf(o.solarDate)
    const detail = [
      lunar ? `${lunar.day}/${lunar.month}${lunar.leap ? ' nhuận' : ''} âm lịch` : null,
      e.note,
    ]
      .filter(Boolean)
      .join('\n')
    events.push(
      ...vevent(
        {
          uid: `fh-event-${o.id}@family-hub`,
          summary: `${TYPE_ICON[e.type] ?? '📌'} ${e.title}`,
          description: detail || undefined,
          start: o.solarDate,
          end: o.endDate,
          startTime: e.startTime,
          endTime: e.endTime,
        },
        dtstamp,
      ),
    )
  }

  for (const h of holidaysBetween(from, to)) {
    const detail = [
      h.holiday.dayOff ? 'Được nghỉ' : null,
      h.holiday.calendar === 'LUNAR' ? `${h.lunar.day}/${h.lunar.month} âm lịch` : null,
      h.holiday.note,
    ]
      .filter(Boolean)
      .join('\n')
    events.push(
      ...vevent(
        {
          uid: `fh-holiday-${h.holiday.id}-${h.startDate}@family-hub`,
          summary: `${HOLIDAY_ICON[h.holiday.category] ?? '⭐'} ${h.holiday.title}`,
          description: detail || undefined,
          start: h.startDate,
          end: h.endDate,
        },
        dtstamp,
      ),
    )
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Hub//VI//VN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`Family Hub — ${familyName}`)}`,
    `X-WR-TIMEZONE:${VN_TZ}`,
    // Việt Nam UTC+7 cố định, không DST — VTIMEZONE vì thế chỉ có một luật
    'BEGIN:VTIMEZONE',
    `TZID:${VN_TZ}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0700',
    'TZOFFSETTO:+0700',
    'TZNAME:+07',
    'END:STANDARD',
    'END:VTIMEZONE',
    // gợi ý phần mềm lịch tải lại sau 12 tiếng; phần lớn vẫn tự quyết
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...events,
    'END:VCALENDAR',
  ]

  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** So sánh hash theo kiểu chống đo thời gian. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function registerIcalRoute(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>('/calendar.ics', async (req, reply) => {
    const token = req.query.token
    if (!token) return reply.code(401).type('text/plain').send('Thiếu token')

    const hash = hashIcalToken(token)
    const user = await db.user.findUnique({
      where: { icalTokenHash: hash },
      include: { family: true },
    })
    // findUnique đã khớp chính xác; so sánh lại chỉ để không rẽ nhánh theo thời gian
    if (!user || !user.active || !user.icalTokenHash || !sameHash(user.icalTokenHash, hash)) {
      return reply.code(403).type('text/plain').send('Link không còn hiệu lực')
    }

    await db.user.update({ where: { id: user.id }, data: { icalLastUsedAt: new Date() } })

    const body = await buildFamilyCalendar(user.familyId, user.family.name)
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="family-hub.ics"')
      // link là bí mật: đừng để proxy nào giữ lại bản sao
      .header('Cache-Control', 'private, max-age=0, no-store')
      .send(body)
  })
}
