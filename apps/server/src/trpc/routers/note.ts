import { TRPCError } from '@trpc/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '../../db.js'
import { vnToday } from '../../lib/time.js'
import {
  clearNoteNotifications,
  completeNote,
  materializeNotes,
} from '../../notifications/notes.js'
import { protectedProcedure, router } from '../trpc.js'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const COLORS = [
  'default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray',
] as const

const itemSchema = z.object({
  text: z.string().trim().max(500),
  checked: z.boolean().default(false),
})

const noteBody = z.object({
  title: z.string().trim().max(200).default(''),
  body: z.string().max(20_000).default(''),
  kind: z.enum(['TEXT', 'CHECKLIST']).default('TEXT'),
  color: z.enum(COLORS).default('default'),
  labels: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  shared: z.boolean().default(false),
  remindDate: dateSchema.nullish(),
  remindAtTime: timeSchema.default('08:00'),
  remindBeforeDays: z.array(z.number().int().min(0).max(60)).min(1).max(6).default([1, 0]),
  recurIntervalDays: z.number().int().min(1).max(3650).nullish(),
  items: z.array(itemSchema).max(200).optional(),
})

/**
 * Ghi chú riêng tư chỉ chủ nhân đọc/sửa được; ghi chú đã chia sẻ thì cả nhà
 * đọc được nhưng chỉ chủ nhân sửa. Phụ huynh KHÔNG được đọc ghi chú riêng của
 * con — cùng lý do với nhật ký, xem docs/PLAN.md mục 5.4.
 */
async function loadOwned(userId: string, familyId: string, noteId: string) {
  const note = await db.note.findUnique({ where: { id: noteId } })
  if (!note || note.familyId !== familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy ghi chú' })
  }
  if (note.ownerId !== userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Chỉ người tạo mới sửa được ghi chú này' })
  }
  return note
}

const visibleTo = (userId: string, familyId: string): Prisma.NoteWhereInput => ({
  familyId,
  OR: [{ ownerId: userId }, { shared: true }],
})

async function replaceItems(noteId: string, items: z.infer<typeof itemSchema>[]) {
  await db.noteItem.deleteMany({ where: { noteId } })
  if (items.length === 0) return
  await db.noteItem.createMany({
    data: items
      .filter((i) => i.text.length > 0)
      .map((i, idx) => ({ noteId, text: i.text, checked: i.checked, sortOrder: idx })),
  })
}

export const noteRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        archived: z.boolean().default(false),
        label: z.string().trim().max(40).optional(),
        search: z.string().trim().max(200).optional(),
        withReminder: z.boolean().optional(),
      }).default({}),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.NoteWhereInput = {
        ...visibleTo(ctx.user.id, ctx.user.familyId),
        archived: input.archived,
        ...(input.label ? { labels: { has: input.label } } : {}),
        ...(input.withReminder ? { remindDate: { not: null } } : {}),
      }
      if (input.search) {
        // tìm trong tiêu đề, nội dung và cả các dòng checklist
        where.AND = [
          {
            OR: [
              { title: { contains: input.search, mode: 'insensitive' } },
              { body: { contains: input.search, mode: 'insensitive' } },
              { items: { some: { text: { contains: input.search, mode: 'insensitive' } } } },
            ],
          },
        ]
      }
      return db.note.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { sortOrder: 'asc' }, { updatedAt: 'desc' }],
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          owner: { select: { id: true, name: true, avatarColor: true } },
        },
      })
    }),

  /** Danh sách nhãn đang dùng, kèm số lượng — cho thanh lọc bên trái. */
  labels: protectedProcedure.query(async ({ ctx }) => {
    const notes = await db.note.findMany({
      where: { ...visibleTo(ctx.user.id, ctx.user.familyId), archived: false },
      select: { labels: true },
    })
    const count = new Map<string, number>()
    for (const n of notes) for (const l of n.labels) count.set(l, (count.get(l) ?? 0) + 1)
    return [...count.entries()]
      .map(([label, n]) => ({ label, count: n }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi'))
  }),

  create: protectedProcedure.input(noteBody).mutation(async ({ ctx, input }) => {
    const { items, ...rest } = input
    const note = await db.note.create({
      data: {
        ...rest,
        familyId: ctx.user.familyId,
        ownerId: ctx.user.id,
        items: items?.length
          ? {
              create: items
                .filter((i) => i.text.length > 0)
                .map((i, idx) => ({ text: i.text, checked: i.checked, sortOrder: idx })),
            }
          : undefined,
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (note.remindDate) await materializeNotes()
    return note
  }),

  update: protectedProcedure
    .input(z.object({ id: z.string() }).merge(noteBody.partial()))
    .mutation(async ({ ctx, input }) => {
      const { id, items, ...data } = input
      const before = await loadOwned(ctx.user.id, ctx.user.familyId, id)

      const updated = await db.note.update({ where: { id }, data })
      if (items) await replaceItems(id, items)

      // hạn hoặc cấu hình nhắc đổi -> lịch cũ không còn đúng
      const remindChanged =
        (data.remindDate !== undefined && data.remindDate !== before.remindDate) ||
        (data.remindAtTime !== undefined && data.remindAtTime !== before.remindAtTime) ||
        data.remindBeforeDays !== undefined ||
        (data.shared !== undefined && data.shared !== before.shared)
      if (remindChanged) {
        await clearNoteNotifications(id)
        await materializeNotes()
      }

      return db.note.findUniqueOrThrow({
        where: { id: updated.id },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      })
    }),

  /** Tick một dòng checklist — tách riêng để bấm là lưu ngay, không cần mở form. */
  toggleItem: protectedProcedure
    .input(z.object({ itemId: z.string(), checked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.noteItem.findUnique({ where: { id: input.itemId }, include: { note: true } })
      if (!item || item.note.familyId !== ctx.user.familyId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy dòng' })
      }
      // ghi chú đã chia sẻ thì ai trong nhà cũng tick được, đó là điểm của việc chia sẻ
      if (!item.note.shared && item.note.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền' })
      }
      return db.noteItem.update({ where: { id: input.itemId }, data: { checked: input.checked } })
    }),

  setPinned: protectedProcedure
    .input(z.object({ id: z.string(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx.user.id, ctx.user.familyId, input.id)
      return db.note.update({ where: { id: input.id }, data: { pinned: input.pinned } })
    }),

  setArchived: protectedProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx.user.id, ctx.user.familyId, input.id)
      const note = await db.note.update({
        where: { id: input.id },
        data: { archived: input.archived, pinned: input.archived ? false : undefined },
      })
      if (input.archived) await clearNoteNotifications(input.id)
      else await materializeNotes()
      return note
    }),

  /** Xong việc. Có chu kỳ lặp thì tự đẻ ghi chú cho lần tới. */
  complete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx.user.id, ctx.user.familyId, input.id)
      const { next } = await completeNote(input.id)
      return { nextDate: next?.remindDate ?? null }
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadOwned(ctx.user.id, ctx.user.familyId, input.id)
      await clearNoteNotifications(input.id)
      await db.note.delete({ where: { id: input.id } })
      return { ok: true }
    }),

  /** Ghi chú có hạn sắp tới — dùng cho màn hình Hôm nay. */
  dueSoon: protectedProcedure
    .input(z.object({ days: z.number().int().min(0).max(365).default(14) }).default({}))
    .query(async ({ ctx, input }) => {
      const today = vnToday()
      const until = new Date(`${today}T00:00:00Z`)
      until.setUTCDate(until.getUTCDate() + input.days)
      return db.note.findMany({
        where: {
          ...visibleTo(ctx.user.id, ctx.user.familyId),
          archived: false,
          doneAt: null,
          remindDate: { not: null, lte: until.toISOString().slice(0, 10) },
        },
        orderBy: { remindDate: 'asc' },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      })
    }),
})
