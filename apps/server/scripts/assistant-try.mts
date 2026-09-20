/**
 * Thử trợ lý với các câu đời thường — KHÔNG ghi gì vào DB, chỉ in bản xem trước.
 *
 *   cd apps/server && node --env-file=.env --import tsx scripts/assistant-try.mts
 *   node --env-file=.env --import tsx scripts/assistant-try.mts "câu của bạn"
 *
 * Cần ANTHROPIC_API_KEY trong .env. Context giả lập: bố (phụ huynh), mẹ, bé Su
 * (con), và 3 việc định kỳ có sẵn.
 */
import { parseCommand, type AssistantContext } from '../src/assistant/parse.js'
import { vnToday } from '../src/lib/time.js'

const ctx: AssistantContext = {
  speaker: { id: 'u-bo', name: 'Bố', role: 'PARENT' },
  members: [
    { id: 'u-bo', name: 'Bố', role: 'PARENT' },
    { id: 'u-me', name: 'Mẹ', role: 'PARENT' },
    { id: 'u-su', name: 'Bé Su', role: 'CHILD' },
  ],
  routines: [
    { id: 'r-anh', title: 'Học tiếng Anh', timeOfDay: '19:00', ownerName: 'Bé Su' },
    { id: 'r-chay', title: 'Chạy bộ', timeOfDay: '06:00', ownerName: 'Bố' },
    { id: 'r-doc', title: 'Đọc sách', timeOfDay: '21:00', ownerName: 'Bố' },
  ],
}

const SAMPLES = [
  'Nhắc tôi thay dầu xe ngày 15 tháng sau, trước 3 ngày báo tôi',
  'Giỗ ông nội mùng 12 tháng 8 âm',
  'Sinh nhật mẹ 23 tháng 11',
  'Bé Su có bài tập Toán bài 5 trang 32, mai nộp',
  'Tối nay tôi chạy bộ xong rồi',
  'Hôm nay mệt quá, làm việc cả ngày, tối đưa con đi ăn kem',
  'Mỗi sáng 6 rưỡi nhắc bé Su tập thể dục 20 phút',
  'Thứ 3 với thứ 5 lúc 8 giờ tối con học đàn 45 phút',
  'Đi chợ: rau muống, thịt ba chỉ, trứng, nước mắm',
  'Bé Su thi giữa kỳ môn Văn ngày 3 tháng 10',
  'Su được 9 điểm kiểm tra 15 phút Toán hôm nay',
  'Cuối tuần nhớ gọi điện cho bà nội',
  'Mấy giờ rồi?',
]

const inputs = process.argv.slice(2).length ? process.argv.slice(2) : SAMPLES
console.log(`Hôm nay: ${vnToday()}\n`)
for (const text of inputs) {
  const t0 = Date.now()
  try {
    const r = await parseCommand(ctx, text)
    console.log(`▶ ${text}`)
    console.log(`  ↳ ${r.reply || '(không có lời đáp)'}  [${Date.now() - t0} ms]`)
    for (const a of r.actions) {
      const { type, ...rest } = a
      console.log(`  • ${type} ${JSON.stringify(rest)}`)
    }
    for (const rej of r.rejected) console.log(`  ✗ bị loại ${rej.name}: ${rej.reason}`)
    console.log()
  } catch (err) {
    console.log(`▶ ${text}\n  ‼ ${(err as Error).message}\n`)
  }
}
