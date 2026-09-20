import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { dropCookie, readCookie, writeCookie } from '../../lib/cookies.js'
import { createSession, invalidateSession, SESSION_COOKIE } from '../../lib/session.js'
import { isProd } from '../../env.js'
import { protectedProcedure, publicProcedure, router } from '../trpc.js'

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  path: '/',
  maxAge: 60 * 60 * 24 * 60,
}

const emailSchema = z.string().trim().toLowerCase().email('Email không hợp lệ')
const passwordSchema = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200)

export const authRouter = router({
  /** Chỉ chạy được khi DB chưa có gia đình nào — tạo gia đình + phụ huynh đầu tiên. */
  bootstrap: publicProcedure
    .input(
      z.object({
        familyName: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(100),
        email: emailSchema,
        password: passwordSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await db.family.count()
      if (existing > 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Hệ thống đã được khởi tạo' })
      }
      const user = await db.$transaction(async (tx) => {
        const family = await tx.family.create({ data: { name: input.familyName } })
        return tx.user.create({
          data: {
            familyId: family.id,
            name: input.name,
            email: input.email,
            passwordHash: await hashPassword(input.password),
            role: 'PARENT',
            diaryPrivate: false,
          },
        })
      })
      const { token } = await createSession(user.id, ctx.req.headers['user-agent'])
      writeCookie(ctx.res, SESSION_COOKIE, token, cookieOptions)
      return { id: user.id, name: user.name }
    }),

  needsBootstrap: publicProcedure.query(async () => {
    return (await db.family.count()) === 0
  }),

  login: publicProcedure
    .input(z.object({ email: emailSchema, password: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = await db.user.findUnique({ where: { email: input.email } })
      // so sánh cả khi không tìm thấy user để tránh lộ email nào tồn tại qua thời gian phản hồi
      const ok = user
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyPassword(
            'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==',
            input.password,
          )
      if (!user || !ok || !user.active) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Email hoặc mật khẩu không đúng' })
      }
      const { token } = await createSession(user.id, ctx.req.headers['user-agent'])
      writeCookie(ctx.res, SESSION_COOKIE, token, cookieOptions)
      return { id: user.id, name: user.name, role: user.role }
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    await invalidateSession(readCookie(ctx.req, SESSION_COOKIE))
    dropCookie(ctx.res, SESSION_COOKIE)
    return { ok: true }
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null
    const { id, name, email, role, avatarColor, birthday, familyId, telegramChatId } = ctx.user
    return {
      id, name, email, role, avatarColor, birthday, familyId,
      familyName: ctx.session!.user.family.name,
      hasTelegram: Boolean(telegramChatId),
    }
  }),

  changePassword: protectedProcedure
    .input(z.object({ current: z.string().min(1), next: passwordSchema }))
    .mutation(async ({ input, ctx }) => {
      const ok = await verifyPassword(ctx.user.passwordHash, input.current)
      if (!ok) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu hiện tại không đúng' })
      await db.user.update({
        where: { id: ctx.user.id },
        data: { passwordHash: await hashPassword(input.next) },
      })
      return { ok: true }
    }),
})
