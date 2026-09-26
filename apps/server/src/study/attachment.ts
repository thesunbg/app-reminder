/**
 * GET /study/anh/:id — trả ảnh đính kèm của một bài tập.
 *
 * Là route thường chứ không qua tRPC vì trình duyệt phải lấy được nó bằng
 * <img src>. Ảnh nằm trong Postgres (xem ghi chú ở model StudyAttachment), nên
 * ở đây chỉ đọc bytea rồi trả ra.
 *
 * Quyền giống trong app: con chỉ xem ảnh của mình, phụ huynh xem được của mọi
 * con trong nhà. Ảnh bài tập có thể chụp cả trang vở nên không để lộ ra ngoài
 * gia đình.
 */
import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { readCookie } from '../lib/cookies.js'
import { SESSION_COOKIE, validateSession } from '../lib/session.js'

export async function registerStudyAttachmentRoute(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/study/anh/:id', async (req, reply) => {
    const session = await validateSession(readCookie(req, SESSION_COOKIE))
    if (!session) return reply.code(401).send({ error: 'Cần đăng nhập' })

    const row = await db.studyAttachment.findUnique({
      where: { id: req.params.id },
      include: { record: { include: { child: true } } },
    })
    // không phân biệt "không có" với "không được xem": ai dò id cũng không
    // học được gì từ câu trả lời
    if (!row) return reply.code(404).send({ error: 'Không tìm thấy' })

    const me = session.user
    const child = row.record.child
    const allowed = child.id === me.id || (me.role === 'PARENT' && child.familyId === me.familyId)
    if (!allowed) return reply.code(404).send({ error: 'Không tìm thấy' })

    return reply
      .header('Content-Type', row.mime)
      .header('Content-Length', String(row.size))
      // ảnh không bao giờ đổi nội dung (sửa là tạo id mới), nhưng là dữ liệu
      // riêng tư nên chỉ cho cache trong máy người xem
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(row.data))
  })
}
