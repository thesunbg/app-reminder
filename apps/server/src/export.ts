import type { FastifyInstance } from 'fastify'
import { db } from './db.js'
import { readCookie } from './lib/cookies.js'
import { SESSION_COOKIE, validateSession } from './lib/session.js'
import { vnToday } from './lib/time.js'

/**
 * GET /export — tải toàn bộ dữ liệu dạng JSON.
 *
 * Là route thường (không qua tRPC) để trình duyệt tải file bằng <a href>.
 * Quyền xem giống trong app: phụ huynh thấy cả nhà, con chỉ thấy của mình;
 * ghi chú riêng của người khác và nhật ký riêng tư của con không lọt ra.
 */
export async function registerExportRoute(app: FastifyInstance) {
  app.get('/export', async (req, reply) => {
    const session = await validateSession(readCookie(req, SESSION_COOKIE))
    if (!session) return reply.code(401).send({ error: 'Cần đăng nhập' })

    const me = session.user
    const isParent = me.role === 'PARENT'
    const familyId = me.familyId

    const members = await db.user.findMany({
      where: isParent ? { familyId } : { id: me.id },
      select: {
        id: true, name: true, email: true, role: true, birthday: true, avatarColor: true,
        diaryPrivate: true, active: true, createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
    const memberIds = members.map((m) => m.id)
    // nhật ký: của mình luôn có; của người khác chỉ khi họ không để riêng tư
    const diaryUserIds = members.filter((m) => m.id === me.id || !m.diaryPrivate).map((m) => m.id)

    const [routines, events, notes, diary, classSchedule, studyRecords, screenReports] = await Promise.all([
      db.routine.findMany({
        where: isParent ? { familyId } : { ownerId: me.id },
        include: { logs: { orderBy: { date: 'asc' } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      db.event.findMany({
        where: { familyId },
        include: { occurrences: { orderBy: { year: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.note.findMany({
        where: { familyId, OR: [{ ownerId: me.id }, { shared: true }] },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.diaryEntry.findMany({
        where: { userId: { in: diaryUserIds } },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }],
      }),
      db.classSchedule.findMany({ where: { childId: { in: memberIds } }, orderBy: [{ childId: 'asc' }, { weekday: 'asc' }, { period: 'asc' }] }),
      db.studyRecord.findMany({ where: { childId: { in: memberIds } }, orderBy: [{ childId: 'asc' }, { date: 'asc' }] }),
      // Thời lượng dùng máy (phase 8). Không kèm tokenHash của agent — token
      // trong file tải về là token đọc được của cả nhà.
      db.screenReport.findMany({
        where: { userId: { in: memberIds } },
        select: { userId: true, date: true, app: true, category: true, minutes: true },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }, { app: 'asc' }],
      }),
    ])

    const payload = {
      app: 'family-hub',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: { id: me.id, name: me.name, role: me.role },
      family: { id: me.family.id, name: me.family.name, timezone: me.family.timezone },
      members: members.map(({ diaryPrivate: _p, ...m }) => m),
      routines,
      events,
      notes,
      diary,
      classSchedule,
      studyRecords,
      screenReports,
    }

    const file = `family-hub-${vnToday()}.json`
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .header('Cache-Control', 'no-store')
      .send(JSON.stringify(payload, null, 2))
  })
}
