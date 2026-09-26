import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify from 'fastify'
import { db } from './db.js'
import { env, isProd } from './env.js'
import { registerExportRoute } from './export.js'
import { registerAgentRoute } from './screen/route.js'
import { registerStudyAttachmentRoute } from './study/attachment.js'
import { startScheduler } from './notifications/scheduler.js'
import { appRouter } from './trpc/router.js'
import { createContext } from './trpc/trpc.js'

const app = Fastify({
  logger: isProd
    ? true
    : { transport: undefined, level: 'info' },
  // Fastify 5 đã chuyển các tuỳ chọn router vào routerOptions
  routerOptions: { maxParamLength: 5000 },
  // ảnh bài tập đi qua tRPC dưới dạng base64 (+33% so với nhị phân); mặc định
  // 1MB của Fastify chặn cả ảnh đã nén, nên nới lên vừa đủ cho giới hạn 3MB/ảnh
  bodyLimit: 6 * 1024 * 1024,
})

await app.register(cors, {
  origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
  credentials: true,
})
await app.register(cookie, { secret: env.SESSION_SECRET })

await app.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ path, error }: { path?: string; error: Error }) {
      app.log.error({ path, err: error }, 'tRPC error')
    },
  },
})

await registerExportRoute(app)
await registerAgentRoute(app)
await registerStudyAttachmentRoute(app)

app.get('/health', async () => {
  await db.$queryRaw`SELECT 1`
  return { ok: true, ts: new Date().toISOString() }
})

const stopScheduler = startScheduler(app.log)

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'đang tắt server')
  stopScheduler()
  await app.close()
  await db.$disconnect()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ port: env.PORT, host: '0.0.0.0' })
console.log(`\n  🏠 Family Hub API  →  http://localhost:${env.PORT}`)
console.log(`     health           →  http://localhost:${env.PORT}/health\n`)
