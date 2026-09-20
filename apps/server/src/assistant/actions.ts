import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

/**
 * Mỗi "hành động" là một tool cho Claude gọi. Claude KHÔNG thực thi gì —
 * server chỉ gom các tool_use thành bản xem trước, người dùng xác nhận rồi
 * mới áp dụng (assistant.run). Vì thế không cần vòng lặp agent.
 *
 * Schema zod ở đây là nguồn sự thật: vừa validate đầu ra của model, vừa
 * validate payload client gửi lên lúc apply.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^\d{2}:\d{2}$/)

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_routine'),
    title: z.string().min(1).max(120),
    category: z.string().max(40).nullable(),
    timeOfDay: time,
    durationMin: z.number().int().min(1).max(1440),
    /** daily | weekdays | weekend | weekly:MO,WE,FR */
    repeat: z.string().min(1),
    ownerId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('create_event'),
    title: z.string().min(1).max(120),
    kind: z.enum(['BIRTHDAY', 'DEATH_ANNIVERSARY', 'OTHER']),
    calendar: z.enum(['SOLAR', 'LUNAR']),
    lunarDay: z.number().int().min(1).max(30).nullable(),
    lunarMonth: z.number().int().min(1).max(12).nullable(),
    /** SOLAR: "MM-DD" nếu hàng năm, "YYYY-MM-DD" nếu một lần */
    solarDate: z.string().regex(/^(\d{4}-)?\d{2}-\d{2}$/).nullable(),
    yearly: z.boolean(),
    remindBeforeDays: z.array(z.number().int().min(0).max(60)).min(1).max(6),
  }),
  z.object({
    type: z.literal('create_note'),
    title: z.string().max(200),
    body: z.string().max(5000),
    items: z.array(z.string().min(1).max(500)).nullable(),
    remindDate: date.nullable(),
    remindBeforeDays: z.array(z.number().int().min(0).max(60)).nullable(),
    recurIntervalDays: z.number().int().min(1).max(3650).nullable(),
    shared: z.boolean(),
  }),
  z.object({
    type: z.literal('add_diary'),
    date,
    content: z.string().min(1).max(20_000),
    mood: z.number().int().min(1).max(5).nullable(),
  }),
  z.object({
    type: z.literal('mark_routine'),
    routineId: z.string(),
    date,
    status: z.enum(['DONE', 'PARTIAL', 'SKIPPED']),
  }),
  z.object({
    type: z.literal('add_homework'),
    childId: z.string(),
    subject: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    date,
  }),
  z.object({
    type: z.literal('add_score'),
    childId: z.string(),
    subject: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    kind: z.enum(['SCORE', 'EXAM']),
    score: z.number().min(0).max(1000).nullable(),
    maxScore: z.number().min(1).max(1000),
    date,
  }),
])

export type Action = z.infer<typeof actionSchema>

const str = (description: string) => ({ type: 'string' as const, description })
const nstr = (description: string) => ({ type: ['string', 'null'] as const, description })
const int = (description: string) => ({ type: 'integer' as const, description })
const nint = (description: string) => ({ type: ['integer', 'null'] as const, description })

function tool(name: Action['type'], description: string, properties: Record<string, unknown>): Anthropic.Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  }
}

export const TOOLS: Anthropic.Tool[] = [
  tool('create_routine', 'Tạo việc định kỳ (lặp theo lịch, có giờ cố định). Dùng cho "mỗi ngày/mỗi tuần/thứ 2-4-6 lúc 19h".', {
    title: str('Tên việc, ngắn gọn, viết hoa chữ đầu'),
    category: nstr('Nhóm: "Học", "Sức khoẻ", "Nhà cửa", "Việc"… hoặc null nếu không rõ'),
    timeOfDay: str('Giờ bắt đầu HH:mm (24h)'),
    durationMin: int('Thời lượng phút; mặc định 30 nếu không nói'),
    repeat: str('daily | weekdays | weekend | weekly:MO,TU,WE,TH,FR,SA,SU (chọn các thứ, phân cách bằng dấu phẩy)'),
    ownerId: nstr('id thành viên làm việc này (xem danh sách); null = chính người đang nói'),
  }),
  tool('create_event', 'Tạo sự kiện hàng năm: giỗ (âm lịch), sinh nhật, kỷ niệm; hoặc sự kiện một lần theo ngày dương.', {
    title: str('Tên sự kiện, vd "Giỗ ông nội", "Sinh nhật mẹ"'),
    kind: { type: 'string', enum: ['BIRTHDAY', 'DEATH_ANNIVERSARY', 'OTHER'] },
    calendar: { type: 'string', enum: ['SOLAR', 'LUNAR'], description: 'Giỗ ở Việt Nam mặc định là LUNAR' },
    lunarDay: nint('Ngày âm 1-30, chỉ khi LUNAR'),
    lunarMonth: nint('Tháng âm 1-12, chỉ khi LUNAR'),
    solarDate: nstr('Chỉ khi SOLAR: "MM-DD" nếu lặp hàng năm, "YYYY-MM-DD" nếu chỉ một lần'),
    yearly: { type: 'boolean', description: 'Lặp hàng năm? Giỗ/sinh nhật = true' },
    remindBeforeDays: { type: 'array', items: { type: 'integer' }, description: 'Nhắc trước bao nhiêu ngày; mặc định [7,3,1,0]' },
  }),
  tool('create_note', 'Ghi chú hoặc việc một lần có hạn (todo): "thay dầu xe ngày 15 tháng sau", "mua quà", danh sách cần mua.', {
    title: str('Tiêu đề ngắn'),
    body: str('Nội dung, có thể rỗng'),
    items: { type: ['array', 'null'], items: { type: 'string' }, description: 'Các mục checklist nếu là danh sách; null nếu không' },
    remindDate: nstr('Hạn YYYY-MM-DD nếu có, null nếu chỉ là ghi chú'),
    remindBeforeDays: { type: ['array', 'null'], items: { type: 'integer' }, description: 'Nhắc trước N ngày, vd "trước 3 ngày" → [3,0]; null = mặc định [1,0]' },
    recurIntervalDays: nint('Lặp lại sau N ngày kể từ hạn (vd thay dầu mỗi 180 ngày); null nếu không lặp'),
    shared: { type: 'boolean', description: 'Cả nhà cùng thấy? Mặc định false' },
  }),
  tool('add_diary', 'Ghi nhật ký cho một ngày (mặc định hôm nay).', {
    date: str('YYYY-MM-DD'),
    content: str('Nội dung nhật ký, giữ nguyên lời người nói, chỉ sửa chính tả'),
    mood: nint('Tâm trạng 1 (tệ) – 5 (rất vui), null nếu không rõ'),
  }),
  tool('mark_routine', 'Đánh dấu một việc định kỳ ĐÃ CÓ là xong / làm dở / bỏ qua cho một ngày.', {
    routineId: str('id trong danh sách việc định kỳ'),
    date: str('YYYY-MM-DD, mặc định hôm nay'),
    status: { type: 'string', enum: ['DONE', 'PARTIAL', 'SKIPPED'] },
  }),
  tool('add_homework', 'Thêm bài tập về nhà cho một con, có hạn nộp.', {
    childId: str('id của con trong danh sách'),
    subject: str('Môn học'),
    title: str('Bài gì'),
    date: str('Hạn nộp YYYY-MM-DD; "mai" = ngày mai'),
  }),
  tool('add_score', 'Ghi điểm hoặc lịch thi/kiểm tra của một con.', {
    childId: str('id của con'),
    subject: str('Môn học'),
    title: str('Tên bài (vd "Kiểm tra 15 phút", "Thi giữa kỳ")'),
    kind: { type: 'string', enum: ['SCORE', 'EXAM'], description: 'EXAM nếu là kỳ thi/kiểm tra (có thể chưa có điểm)' },
    score: { type: ['number', 'null'], description: 'Điểm, null nếu chưa có' },
    maxScore: { type: 'number', description: 'Thang điểm, mặc định 10' },
    date: str('Ngày có điểm hoặc ngày thi, YYYY-MM-DD'),
  }),
]
