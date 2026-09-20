import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SESSION_SECRET: z.string().min(16),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  // chỉ đổi trong test để trỏ sang mock server
  TELEGRAM_API_BASE: z.string().default('https://api.telegram.org/bot'),
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().optional().default(''),
  // trợ lý giọng nói/LLM — không có key thì nút mic ẩn, app vẫn chạy bình thường
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ASSISTANT_MODEL: z.string().default('claude-opus-5'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Biến môi trường không hợp lệ:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export const isProd = env.NODE_ENV === 'production'
