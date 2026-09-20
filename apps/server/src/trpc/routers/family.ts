import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { hashPassword } from '../../lib/password.js'
import { invalidateAllSessions } from '../../lib/session.js'
import { parentProcedure, protectedProcedure, router } from '../trpc.js'

export const familyRouter = router({
  members: protectedProcedure.query(async ({ ctx }) => {
    return db.user.findMany({
      where: { familyId: ctx.user.familyId },
      select: {
        id: true, name: true, email: true, role: true, avatarColor: true,
        birthday: true, active: true, telegramChatId: true, createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  /** Phụ huynh tạo tài khoản cho con hoặc cho phụ huynh còn lại. */
  addMember: parentProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(8).max(200),
        role: z.enum(['PARENT', 'CHILD']),
        birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const taken = await db.user.findUnique({ where: { email: input.email } })
      if (taken) throw new TRPCError({ code: 'CONFLICT', message: 'Email đã được dùng' })
      const { password, ...rest } = input
      return db.user.create({
        data: {
          ...rest,
          familyId: ctx.user.familyId,
          passwordHash: await hashPassword(password),
          // nhật ký của con để riêng tư theo mặc định — xem docs/PLAN.md mục 5.4
          diaryPrivate: input.role === 'CHILD',
        },
        select: { id: true, name: true, role: true },
      })
    }),

  updateMember: parentProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(100).optional(),
        birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input
      const target = await db.user.findUnique({ where: { id } })
      if (!target || target.familyId !== ctx.user.familyId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
      }
      if (data.active === false && id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể tự vô hiệu hoá tài khoản của mình' })
      }
      const updated = await db.user.update({ where: { id }, data, select: { id: true, name: true, active: true } })
      if (data.active === false) await invalidateAllSessions(id)
      return updated
    }),

  resetMemberPassword: parentProcedure
    .input(z.object({ id: z.string(), password: z.string().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const target = await db.user.findUnique({ where: { id: input.id } })
      if (!target || target.familyId !== ctx.user.familyId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
      }
      await db.user.update({
        where: { id: input.id },
        data: { passwordHash: await hashPassword(input.password) },
      })
      await invalidateAllSessions(input.id)
      return { ok: true }
    }),
})
