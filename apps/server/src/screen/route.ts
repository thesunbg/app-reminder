/**
 * POST /agent/report — đường agent máy tính gửi báo cáo về (Phase 8).
 *
 * Là route REST thường chứ không qua tRPC: agent là một script Node nhỏ chạy
 * nền trên máy con, nó chỉ cần `fetch` một lần mỗi vài phút. Bắt nó nói tRPC
 * (superjson, đường dẫn thủ tục, kiểu chia sẻ) là thêm phụ thuộc vào một thứ
 * nó không cần. Xác thực bằng Bearer token dài hạn, không phải session cookie.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticateAgent, ingestReport } from './report.js'

const bodySchema = z.object({
  /** "YYYY-MM-DD" theo giờ VN — agent tự tính, server không đoán hộ. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Tổng cộng dồn của cả ngày, KHÔNG phải phần chênh lệch. */
  samples: z
    .array(z.object({ app: z.string().min(1).max(200), minutes: z.number().min(0).max(1440) }))
    .max(500),
})

export async function registerAgentRoute(app: FastifyInstance) {
  app.post('/agent/report', async (req, reply) => {
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined

    const device = await authenticateAgent(token)
    // Không phân biệt "thiếu token" với "token sai": ai dò token cũng không
    // học được gì từ câu trả lời.
    if (!device) return reply.code(401).send({ error: 'Token không hợp lệ' })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dữ liệu không hợp lệ', detail: parsed.error.flatten() })
    }

    const rows = await ingestReport(device.id, device.userId, parsed.data.date, parsed.data.samples)
    return { ok: true, rows }
  })

  /** Agent gọi lúc khởi động để biết token còn sống và mình đang báo cho ai. */
  app.get('/agent/ping', async (req, reply) => {
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
    const device = await authenticateAgent(token)
    if (!device) return reply.code(401).send({ error: 'Token không hợp lệ' })
    return { ok: true, device: device.name }
  })
}
