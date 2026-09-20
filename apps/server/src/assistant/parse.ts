import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env.js'
import { vnTimeOf, vnToday, isoWeekday } from '../lib/time.js'
import { TOOLS, actionSchema, type Action } from './actions.js'

export type AssistantContext = {
  speaker: { id: string; name: string; role: 'PARENT' | 'CHILD' }
  members: { id: string; name: string; role: 'PARENT' | 'CHILD' }[]
  routines: { id: string; title: string; timeOfDay: string; ownerName: string }[]
}

export type ParseResult = {
  reply: string
  actions: Action[]
  /** tool_use bị bỏ vì không qua được validate — để debug, không hiện cho người dùng */
  rejected: { name: string; reason: string }[]
}

const WEEKDAY_VI = ['', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật']

export function assistantEnabled(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

/**
 * Prompt cố định để cache được; phần biến (ngày giờ, danh sách) để cuối.
 * Hướng dẫn cố tình ngắn: model tự hiểu tiếng Việt đời thường tốt hơn là
 * ta liệt kê quy tắc.
 */
const SYSTEM_STATIC = `Bạn là trợ lý nhập liệu của Family Hub — app nhắc việc gia đình Việt Nam.
Người dùng nói/gõ một câu tiếng Việt đời thường; bạn chuyển thành các hành động bằng tool.

Nguyên tắc:
- Chỉ dùng tool khi câu nói là một yêu cầu tạo/ghi/đánh dấu. Câu hỏi hay tán gẫu thì trả lời ngắn bằng văn bản, không gọi tool.
- Một câu có thể sinh nhiều hành động ("nhắc tôi… và ghi nhật ký…").
- Ngày tương đối tính theo NGÀY HIỆN TẠI bên dưới (múi giờ Việt Nam): "mai", "tuần sau", "15 tháng sau", "thứ 6 này". Luôn trả ngày tuyệt đối YYYY-MM-DD.
- Giỗ, cúng, rằm, mùng một → âm lịch (LUNAR). Sinh nhật, kỷ niệm cưới → dương lịch hàng năm ("MM-DD") trừ khi người dùng nói rõ là âm.
- "nhắc tôi X ngày N" một lần → create_note có remindDate. Lặp theo lịch cố định (hàng ngày, thứ 2-4-6, cuối tuần) → create_routine.
- "trước 3 ngày báo tôi" → remindBeforeDays [3, 0].
- Không hỏi lại. Thiếu chi tiết thì chọn mặc định hợp lý (giờ 19:00 cho việc buổi tối, 06:30 buổi sáng, 30 phút).
- Không bịa id: routineId/childId/ownerId phải lấy từ danh sách bên dưới. Nếu người dùng nhắc tên không có trong danh sách, dùng null (ownerId) hoặc trả lời văn bản nói không tìm thấy.
- Giữ nguyên cách gọi của người dùng trong tiêu đề (vd "ông nội", "bé Su").
- Sau khi gọi tool, viết một câu xác nhận ngắn gọn bằng tiếng Việt, không lặp lại toàn bộ chi tiết.`

export function buildSystem(ctx: AssistantContext, now = new Date()): Anthropic.TextBlockParam[] {
  const today = vnToday(now)
  const dynamic = [
    `NGÀY HIỆN TẠI: ${today} (${WEEKDAY_VI[isoWeekday(today)]}), ${vnTimeOf(now)} giờ Việt Nam.`,
    `Người đang nói: ${ctx.speaker.name} (id ${ctx.speaker.id}, ${ctx.speaker.role === 'PARENT' ? 'phụ huynh' : 'con'}).`,
    `Thành viên gia đình:\n${ctx.members.map((m) => `- ${m.name} (id ${m.id}, ${m.role === 'PARENT' ? 'phụ huynh' : 'con'})`).join('\n')}`,
    ctx.routines.length
      ? `Việc định kỳ đang có:\n${ctx.routines.map((r) => `- ${r.title} lúc ${r.timeOfDay}, của ${r.ownerName} (id ${r.id})`).join('\n')}`
      : 'Chưa có việc định kỳ nào.',
  ].join('\n\n')
  return [
    { type: 'text', text: SYSTEM_STATIC, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamic },
  ]
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client
}

/** Gom tool_use trong một phản hồi thành danh sách hành động đã validate. */
export function collectActions(content: Anthropic.ContentBlock[]): Omit<ParseResult, never> {
  const actions: Action[] = []
  const rejected: ParseResult['rejected'] = []
  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text)
    if (block.type !== 'tool_use') continue
    const parsed = actionSchema.safeParse({ type: block.name, ...(block.input as object) })
    if (parsed.success) actions.push(parsed.data)
    else rejected.push({ name: block.name, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
  }
  return { reply: texts.join('\n').trim(), actions, rejected }
}

export async function parseCommand(ctx: AssistantContext, text: string, now = new Date()): Promise<ParseResult> {
  const response = await getClient().messages.create({
    model: env.ASSISTANT_MODEL,
    max_tokens: 4096,
    // nhập liệu ngắn, cần nhanh — hạ effort thay vì tắt thinking
    output_config: { effort: 'low' },
    system: buildSystem(ctx, now),
    tools: TOOLS,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: text }],
  })
  if (response.stop_reason === 'refusal') {
    return { reply: 'Mình không xử lý được câu này.', actions: [], rejected: [] }
  }
  const out = collectActions(response.content)
  if (!out.reply && out.actions.length === 0) out.reply = 'Mình chưa hiểu bạn muốn làm gì — thử nói cụ thể hơn nhé.'
  return out
}
