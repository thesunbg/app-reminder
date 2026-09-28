/**
 * Tick / bỏ tick một việc định kỳ — luật dùng chung cho MỌI đường vào.
 *
 * Trước đây logic này nằm trong `trpc/routers/routine.ts`. Từ khi tin nhắn
 * Telegram có nút "✓ Xong", nó có hai đường vào; để hai nơi tự viết lấy thì
 * sớm muộn cũng lệch nhau ở chỗ quan trọng nhất (ai được tick việc của ai, và
 * tick rồi thì có huỷ nhắc không).
 */
import { TRPCError } from '@trpc/server'
import type { TaskStatus } from '@prisma/client'
import { db } from '../db.js'
import { occursOn } from '../lib/recurrence.js'
import { cancelRoutineNotifications, restoreRoutineNotifications } from '../notifications/materialize.js'

/**
 * Ai được sửa / tick một việc định kỳ.
 *
 * - việc của chính mình: luôn được;
 * - việc của CON: phụ huynh được — bố mẹ giao việc, theo dõi và tick hộ khi con
 *   còn nhỏ hoặc chưa cầm máy;
 * - việc của một PHỤ HUYNH khác: KHÔNG ai được, kể cả phụ huynh còn lại. Việc
 *   tập thể dục của người này mà người kia tick hộ thì con số chẳng còn nghĩa
 *   gì, và đó cũng không phải việc của họ.
 *
 * Nhìn thì vẫn nhìn được cả nhà — đây chỉ là quyền ghi.
 */
export function canEditRoutine(userId: string, role: string, owner: { id: string; role: string }): boolean {
  if (owner.id === userId) return true
  return role === 'PARENT' && owner.role === 'CHILD'
}

export type Actor = { id: string; role: string; familyId: string }

export async function assertCanEditRoutine(actor: Actor, routineId: string) {
  const routine = await db.routine.findUnique({
    where: { id: routineId },
    include: { owner: { select: { id: true, name: true, role: true } } },
  })
  if (!routine || routine.familyId !== actor.familyId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy công việc' })
  }
  if (!canEditRoutine(actor.id, actor.role, routine.owner)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Đây là việc của ${routine.owner.name} — chỉ người đó mới tick hay sửa được`,
    })
  }
  return routine
}

export type MarkInput = {
  routineId: string
  date: string
  status: TaskStatus
  actualMin?: number | null
  note?: string | null
}

/**
 * Trả về bản ghi mới, hoặc null nếu lần gọi này là **bỏ tick** (tick lại đúng
 * trạng thái đang có). Kèm theo `routine` để người gọi soạn câu trả lời.
 */
export async function markTask(actor: Actor, input: MarkInput) {
  const routine = await assertCanEditRoutine(actor, input.routineId)
  if (!occursOn(routine.rrule, routine.startDate, input.date)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Công việc này không rơi vào ngày đó' })
  }

  const existing = await db.taskLog.findUnique({
    where: { routineId_date: { routineId: input.routineId, date: input.date } },
  })

  // tick lại đúng trạng thái đang có -> bỏ tick
  if (existing && existing.status === input.status && input.actualMin == null && input.note == null) {
    await db.taskLog.delete({ where: { id: existing.id } })
    // bỏ tick -> việc lại còn nợ, bật lại các nhắc nhở chưa tới giờ
    await restoreRoutineNotifications(input.routineId, input.date)
    return { log: null, routine }
  }

  const log = await db.taskLog.upsert({
    where: { routineId_date: { routineId: input.routineId, date: input.date } },
    create: {
      routineId: input.routineId,
      date: input.date,
      status: input.status,
      actualMin: input.actualMin ?? (input.status === 'DONE' ? routine.durationMin : null),
      note: input.note ?? null,
    },
    update: {
      status: input.status,
      actualMin: input.actualMin ?? undefined,
      note: input.note ?? undefined,
      doneAt: new Date(),
    },
  })
  // đã tick rồi thì đừng nhắc nữa — nhắc tiếp làm người ta mất tin vào app
  await cancelRoutineNotifications(input.routineId, input.date)
  return { log, routine }
}
