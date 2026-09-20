import { initTRPC, TRPCError } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import superjson from 'superjson'
import { readCookie } from '../lib/cookies.js'
import { SESSION_COOKIE, validateSession } from '../lib/session.js'

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  const token = readCookie(req, SESSION_COOKIE)
  const session = await validateSession(token)
  return { req, res, session, user: session?.user ?? null }
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zod: error.cause instanceof Error && 'issues' in error.cause ? error.cause : undefined,
      },
    }
  },
})

export const router = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Cần đăng nhập' })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

export const parentProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'PARENT') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ phụ huynh mới thực hiện được' })
  }
  return next({ ctx })
})
