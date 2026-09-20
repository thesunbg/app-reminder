import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { actionSchema, type Action } from '../../assistant/actions.js'
import { assistantEnabled, parseCommand, type AssistantContext } from '../../assistant/parse.js'
import { db } from '../../db.js'
import { RRULE_PRESETS } from '../../lib/recurrence.js'
import { vnToday } from '../../lib/time.js'
import type { Context } from '../trpc.js'
import { protectedProcedure, router } from '../trpc.js'

async function contextFor(ctx: Context & { user: NonNullable<Context['user']> }): Promise<AssistantContext> {
  const [members, routines] = await Promise.all([
    db.user.findMany({
      where: { familyId: ctx.user.familyId, active: true },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
    db.routine.findMany({
      where: { familyId: ctx.user.familyId, active: true, archivedAt: null, ...(ctx.user.role === 'PARENT' ? {} : { ownerId: ctx.user.id }) },
      select: { id: true, title: true, timeOfDay: true, owner: { select: { name: true } } },
      orderBy: { timeOfDay: 'asc' },
    }),
  ])
  return {
    speaker: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
    members,
    routines: routines.map((r) => ({ id: r.id, title: r.title, timeOfDay: r.timeOfDay, ownerName: r.owner.name })),
  }
}

function toRRule(repeat: string): string {
  const r = repeat.trim().toLowerCase()
  if (r === 'daily') return RRULE_PRESETS.daily
  if (r === 'weekdays') return RRULE_PRESETS.weekdays
  if (r === 'weekend') return RRULE_PRESETS.weekend
  const m = /^weekly:([a-z,\s]+)$/i.exec(repeat.trim())
  if (m) {
    const days = m[1]!.toUpperCase().split(',').map((d) => d.trim()).filter((d) => /^(MO|TU|WE|TH|FR|SA|SU)$/.test(d))
    if (days.length) return RRULE_PRESETS.weekly(days.join(','))
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message: `Không hiểu lịch lặp "${repeat}"` })
}

/**
 * Áp dụng bằng cách gọi lại đúng procedure hiện có — validate, quyền, sinh
 * thông báo đều đi qua một đường. Import động để tránh vòng import với router.ts.
 */
async function applyOne(ctx: Context & { user: NonNullable<Context['user']> }, a: Action): Promise<{ type: Action['type']; label: string }> {
  const { appRouter } = await import('../router.js')
  const caller = appRouter.createCaller(ctx)
  switch (a.type) {
    case 'create_routine': {
      const r = await caller.routine.create({
        title: a.title, category: a.category ?? 'general', timeOfDay: a.timeOfDay, durationMin: a.durationMin,
        rrule: toRRule(a.repeat), ownerId: a.ownerId ?? undefined,
      })
      return { type: a.type, label: `Việc định kỳ: ${r.title}` }
    }
    case 'create_event': {
      const common = { title: a.title, type: a.kind, remindBeforeDays: a.remindBeforeDays }
      if (a.calendar === 'LUNAR') {
        if (!a.lunarDay || !a.lunarMonth) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Thiếu ngày/tháng âm' })
        await caller.event.create({ ...common, calendar: 'LUNAR', lunarDay: a.lunarDay, lunarMonth: a.lunarMonth })
      } else {
        if (!a.solarDate) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Thiếu ngày dương' })
        await caller.event.create({ ...common, calendar: 'SOLAR', solarDate: a.solarDate, yearly: a.yearly })
      }
      return { type: a.type, label: `Sự kiện: ${a.title}` }
    }
    case 'create_note': {
      await caller.note.create({
        title: a.title, body: a.body, shared: a.shared,
        kind: a.items?.length ? 'CHECKLIST' : 'TEXT',
        items: a.items?.map((text) => ({ text, checked: false })),
        remindDate: a.remindDate, remindBeforeDays: a.remindBeforeDays ?? undefined,
        recurIntervalDays: a.recurIntervalDays,
      })
      return { type: a.type, label: `Ghi chú: ${a.title || a.body.slice(0, 40)}` }
    }
    case 'add_diary': {
      await caller.diary.save({ date: a.date, content: a.content, mood: a.mood })
      return { type: a.type, label: `Nhật ký ${a.date}` }
    }
    case 'mark_routine': {
      await caller.routine.mark({ routineId: a.routineId, date: a.date, status: a.status })
      return { type: a.type, label: `Đã đánh dấu ${a.status === 'DONE' ? 'xong' : a.status === 'PARTIAL' ? 'làm dở' : 'bỏ qua'}` }
    }
    case 'add_homework': {
      await caller.study.recordCreate({ childId: a.childId, kind: 'HOMEWORK', subject: a.subject, title: a.title, date: a.date })
      return { type: a.type, label: `Bài tập ${a.subject}: ${a.title}` }
    }
    case 'add_score': {
      await caller.study.recordCreate({ childId: a.childId, kind: a.kind, subject: a.subject, title: a.title, date: a.date, score: a.score, maxScore: a.maxScore })
      return { type: a.type, label: `${a.kind === 'EXAM' ? 'Bài thi' : 'Điểm'} ${a.subject}: ${a.title}` }
    }
  }
}

export const assistantRouter = router({
  status: protectedProcedure.query(() => ({ enabled: assistantEnabled() })),

  /** Bước 1: câu nói → bản xem trước. Chưa ghi gì vào DB. */
  parse: protectedProcedure
    .input(z.object({ text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (!assistantEnabled()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Server chưa cấu hình ANTHROPIC_API_KEY' })
      const c = await contextFor(ctx)
      const result = await parseCommand(c, input.text)
      return { reply: result.reply, actions: result.actions, today: vnToday() }
    }),

  /** Bước 2: người dùng đã xác nhận → thực hiện từng hành động, báo cái nào hỏng. */
  run: protectedProcedure
    .input(z.object({ actions: z.array(actionSchema).min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const done: { type: Action['type']; label: string }[] = []
      const failed: { type: Action['type']; error: string }[] = []
      for (const a of input.actions) {
        try {
          done.push(await applyOne(ctx, a))
        } catch (err) {
          failed.push({ type: a.type, error: (err as Error).message })
        }
      }
      return { done, failed }
    }),
})
