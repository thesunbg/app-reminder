import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { db } from '../../db.js'
import { hashPassword } from '../../lib/password.js'
import { invalidateAllSessions } from '../../lib/session.js'
import { syncBirthdayEvent } from '../../notifications/birthday.js'
import { adminProcedure, protectedProcedure, router } from '../trpc.js'

/** Thành viên phải thuộc đúng gia đình của người đang thao tác. */
async function assertMember(familyId: string, id: string) {
  const target = await db.user.findUnique({ where: { id } })
  if (!target || target.familyId !== familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
  }
  return target
}

export const familyRouter = router({
  members: protectedProcedure.query(async ({ ctx }) => {
    return db.user.findMany({
      where: { familyId: ctx.user.familyId },
      select: {
        id: true, name: true, email: true, role: true, avatarColor: true,
        birthday: true, active: true, telegramChatId: true, createdAt: true,
        isAdmin: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
  }),

  /** Quản trị tạo tài khoản cho con hoặc cho phụ huynh còn lại. */
  addMember: adminProcedure
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
      const created = await db.user.create({
        data: {
          ...rest,
          familyId: ctx.user.familyId,
          passwordHash: await hashPassword(password),
          // nhật ký của con để riêng tư theo mặc định — xem docs/PLAN.md mục 5.4
          diaryPrivate: input.role === 'CHILD',
        },
        select: { id: true, name: true, role: true },
      })
      // khai ngày sinh lúc tạo là sinh nhật lên lịch ngay
      await syncBirthdayEvent(created.id)
      return created
    }),

  updateMember: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(100).optional(),
        email: z.string().trim().toLowerCase().email().optional(),
        role: z.enum(['PARENT', 'CHILD']).optional(),
        birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input
      const target = await assertMember(ctx.user.familyId, id)
      if (id === ctx.user.id) {
        // admin tự hạ vai trò hoặc tự tắt tài khoản mình thì không còn ai quản lý được nữa
        if (data.active === false) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể tự vô hiệu hoá tài khoản của mình' })
        }
        if (data.role === 'CHILD') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể tự chuyển mình thành tài khoản con' })
        }
      }
      if (data.email && data.email !== target.email) {
        const taken = await db.user.findUnique({ where: { email: data.email } })
        if (taken) throw new TRPCError({ code: 'CONFLICT', message: 'Email đã được dùng' })
      }
      const updated = await db.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, active: true },
      })
      // đổi email hoặc tắt tài khoản thì phiên đang mở phải bị cắt
      if (data.active === false || (data.email && data.email !== target.email)) {
        await invalidateAllSessions(id)
      }
      // ngày sinh, tên hay trạng thái đổi -> sự kiện sinh nhật phải theo kịp
      if (data.birthday !== undefined || data.name !== undefined || data.active !== undefined) {
        await syncBirthdayEvent(id)
      }
      return updated
    }),

  /**
   * Những gì sẽ mất nếu xoá hẳn thành viên này. Giao diện phải hiện con số thật
   * trước khi hỏi xác nhận — dữ liệu gia đình không có bản sao nào ngoài backup
   * hằng đêm, nên đừng để ai bấm xoá mà không biết mình mất gì.
   */
  memberData: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const target = await assertMember(ctx.user.familyId, input.id)
      const [routines, taskLogs, notes, diaryEntries, studyRecords, screenReports] = await Promise.all([
        db.routine.count({ where: { ownerId: target.id } }),
        db.taskLog.count({ where: { routine: { ownerId: target.id } } }),
        db.note.count({ where: { ownerId: target.id } }),
        db.diaryEntry.count({ where: { userId: target.id } }),
        db.studyRecord.count({ where: { childId: target.id } }),
        db.screenReport.count({ where: { userId: target.id } }),
      ])
      return { name: target.name, routines, taskLogs, notes, diaryEntries, studyRecords, screenReports }
    }),

  /**
   * Xoá hẳn một thành viên và toàn bộ dữ liệu của họ (cascade theo schema).
   * KHÔNG khôi phục được trừ khi restore backup — vì vậy phải gõ đúng tên để
   * xác nhận, và kiểm tra ở server chứ không chỉ ở giao diện.
   *
   * Muốn giữ dữ liệu thì dùng updateMember({ active: false }): người đó không
   * đăng nhập được nữa nhưng nhật ký, ghi chú, lịch sử vẫn còn.
   */
  removeMember: adminProcedure
    .input(z.object({ id: z.string(), confirmName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const target = await assertMember(ctx.user.familyId, input.id)
      if (target.id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể tự xoá tài khoản của mình' })
      }
      if (input.confirmName.trim() !== target.name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tên xác nhận không khớp' })
      }
      await invalidateAllSessions(target.id)
      await db.user.delete({ where: { id: target.id } })
      return { ok: true, name: target.name }
    }),

  resetMemberPassword: adminProcedure
    .input(z.object({ id: z.string(), password: z.string().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx.user.familyId, input.id)
      await db.user.update({
        where: { id: input.id },
        data: { passwordHash: await hashPassword(input.password) },
      })
      await invalidateAllSessions(input.id)
      return { ok: true }
    }),
})
