/**
 * Sao lưu & khôi phục — `GET /backup` và `POST /backup/restore`.
 *
 * Là route REST chứ không phải thủ tục tRPC vì hai lý do:
 *  - Tải về phải là một cú `<a href download>` để trình duyệt tự đặt tên file;
 *    tRPC trả JSON qua fetch, muốn thành file lại phải dựng Blob bằng tay.
 *  - File có kèm ảnh đề bài nên có thể vài chục MB. `bodyLimit` của Fastify
 *    đặt được theo từng route, còn plugin tRPC thì ăn theo giới hạn chung
 *    (6MB) — nới giới hạn chung chỉ vì một đường này là mở rộng bề mặt tấn
 *    công cho tất cả các thủ tục còn lại.
 *
 * Quyền: CHỈ quản trị gia đình. File chứa hash mật khẩu của cả nhà, và khôi
 * phục kiểu "dựng lại" thì xoá sạch dữ liệu — đây đúng là loại việc mà
 * `adminProcedure` sinh ra để canh.
 *
 * LƯU Ý: thêm route REST mới thì phải thêm một `handle` trong deploy/Caddyfile,
 * không thì nó rơi xuống nhánh SPA và trả index.html kèm mã 200.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { readCookie } from '../lib/cookies.js'
import { SESSION_COOKIE, validateSession } from '../lib/session.js'
import { vnToday } from '../lib/time.js'
import { buildBackup } from './build.js'
import { backupSchema, countRows } from './format.js'
import { RestoreError, restoreBackup } from './restore.js'

/** Ảnh đề bài cộng lại có thể nặng; 100MB là trần rộng rãi cho một nhà. */
const MAX_UPLOAD = 100 * 1024 * 1024

const restoreBody = z.object({
  mode: z.enum(['replace', 'merge']),
  /**
   * Bấm nhầm nút "dựng lại" là mất sạch. Bắt gõ đúng chữ, KIỂM Ở SERVER chứ
   * không chỉ chặn ở giao diện — đúng cách `removeMember` đang làm.
   */
  confirm: z.string().optional(),
  dryRun: z.boolean().default(false),
  data: z.unknown(),
})

export const RESTORE_CONFIRM = 'DUNG LAI'

export async function registerBackupRoute(app: FastifyInstance) {
  /** Tải file sao lưu đầy đủ. `?anh=0` để bỏ ảnh đề bài cho file nhẹ. */
  app.get('/backup', async (req, reply) => {
    const session = await validateSession(readCookie(req, SESSION_COOKIE))
    if (!session) return reply.code(401).send({ error: 'Cần đăng nhập' })
    const me = session.user
    if (!me.isAdmin) return reply.code(403).send({ error: 'Chỉ quản trị gia đình mới tải được bản sao lưu' })

    const attachments = (req.query as { anh?: string }).anh !== '0'
    const data = await buildBackup(me.familyId, { id: me.id, name: me.name, email: me.email }, { attachments })

    const file = `family-hub-backup-${vnToday()}.json`
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .header('Cache-Control', 'no-store')
      .send(JSON.stringify(data))
  })

  app.post('/backup/restore', { bodyLimit: MAX_UPLOAD }, async (req, reply) => {
    const session = await validateSession(readCookie(req, SESSION_COOKIE))
    if (!session) return reply.code(401).send({ error: 'Cần đăng nhập' })
    const me = session.user
    if (!me.isAdmin) return reply.code(403).send({ error: 'Chỉ quản trị gia đình mới khôi phục được dữ liệu' })

    const body = restoreBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'Yêu cầu không hợp lệ' })
    const { mode, confirm, dryRun } = body.data

    const parsed = backupSchema.safeParse(body.data.data)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return reply.code(400).send({
        error: 'File sao lưu không đọc được',
        detail: first ? `${first.path.join('.') || 'file'}: ${first.message}` : undefined,
      })
    }

    if (mode === 'replace' && !dryRun && confirm?.trim().toUpperCase() !== RESTORE_CONFIRM) {
      return reply.code(400).send({ error: `Gõ "${RESTORE_CONFIRM}" để xác nhận xoá dữ liệu hiện tại` })
    }

    try {
      const report = await restoreBackup(me.familyId, parsed.data, { mode, dryRun })
      return { ok: true, file: countRows(parsed.data), ...report }
    } catch (err) {
      if (err instanceof RestoreError) return reply.code(400).send({ error: err.message })
      req.log.error({ err }, 'khôi phục backup lỗi')
      return reply.code(500).send({ error: 'Khôi phục thất bại, dữ liệu giữ nguyên như trước' })
    }
  })
}
