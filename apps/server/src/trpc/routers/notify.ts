import { TRPCError } from '@trpc/server'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { sendMessage, telegramEnabled, escapeHtml } from '../../lib/telegram.js'
import { sendPushToUser, webPushEnabled } from '../../lib/webpush.js'
import { materializeRoutines } from '../../notifications/materialize.js'
import { protectedProcedure, router } from '../trpc.js'

// bỏ 0/O/1/I/L để người dùng không đọc nhầm khi gõ vào Telegram
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 6
const CODE_TTL_MIN = 15

function makeCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const notifyRouter = router({
  /** Trạng thái kênh gửi + cấu hình của tôi. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const me = await db.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: {
        telegramChatId: true, notifyTelegram: true, notifyWebPush: true,
        quietFrom: true, quietTo: true,
        _count: { select: { pushDevices: true } },
      },
    })
    return {
      serverTelegramReady: telegramEnabled(),
      serverWebPushReady: webPushEnabled(),
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
      telegramLinked: Boolean(me.telegramChatId),
      notifyTelegram: me.notifyTelegram,
      notifyWebPush: me.notifyWebPush,
      pushDevices: me._count.pushDevices,
      quietFrom: me.quietFrom,
      quietTo: me.quietTo,
    }
  }),

  /** Sinh mã để gõ `/start <mã>` vào bot. */
  createTelegramCode: protectedProcedure.mutation(async ({ ctx }) => {
    if (!telegramEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Server chưa cấu hình TELEGRAM_BOT_TOKEN' })
    }
    // thử lại nếu trùng mã (xác suất rất thấp nhưng unique index sẽ chặn)
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode()
      try {
        await db.user.update({
          where: { id: ctx.user.id },
          data: { telegramLinkCode: code, telegramLinkExpires: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
        })
        return { code, expiresInMin: CODE_TTL_MIN }
      } catch {
        // trùng -> thử mã khác
      }
    }
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Không sinh được mã, thử lại' })
  }),

  unlinkTelegram: protectedProcedure.mutation(async ({ ctx }) => {
    await db.user.update({
      where: { id: ctx.user.id },
      data: { telegramChatId: null, telegramLinkCode: null, telegramLinkExpires: null },
    })
    return { ok: true }
  }),

  /** Lưu đăng ký Web Push của trình duyệt hiện tại. */
  subscribePush: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
        platform: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db.pushDevice.upsert({
        where: { endpoint: input.endpoint },
        create: { ...input, userId: ctx.user.id },
        // endpoint có thể được trình duyệt cấp lại cho user khác trên máy dùng chung
        update: { ...input, userId: ctx.user.id },
      })
      return { ok: true }
    }),

  unsubscribePush: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ input }) => {
      await db.pushDevice.deleteMany({ where: { endpoint: input.endpoint } })
      return { ok: true }
    }),

  updatePreferences: protectedProcedure
    .input(
      z.object({
        notifyTelegram: z.boolean().optional(),
        notifyWebPush: z.boolean().optional(),
        quietFrom: timeSchema.nullish(),
        quietTo: timeSchema.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // đặt giờ yên lặng thì phải đủ cả hai đầu, nếu không khoảng là vô nghĩa
      const touchesQuiet = input.quietFrom !== undefined || input.quietTo !== undefined
      const hasFrom = Boolean(input.quietFrom)
      const hasTo = Boolean(input.quietTo)
      if (touchesQuiet && hasFrom !== hasTo) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Giờ yên lặng cần cả giờ bắt đầu và giờ kết thúc' })
      }
      await db.user.update({ where: { id: ctx.user.id }, data: input })
      // đổi giờ yên lặng / bật kênh -> lịch thông báo phải sinh lại
      await materializeRoutines()
      return { ok: true }
    }),

  /** Gửi thử ngay lập tức để kiểm tra kênh có hoạt động không. */
  sendTest: protectedProcedure
    .input(z.object({ channel: z.enum(['telegram', 'webpush']) }))
    .mutation(async ({ ctx, input }) => {
      const me = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } })
      if (input.channel === 'telegram') {
        if (!telegramEnabled()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Server chưa cấu hình bot Telegram' })
        if (!me.telegramChatId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Bạn chưa liên kết Telegram' })
        await sendMessage(me.telegramChatId, `🔔 <b>Thử nhắc nhở</b>\nNếu bạn đọc được tin này, ${escapeHtml(me.name)} sẽ nhận được nhắc việc qua Telegram.`)
        return { ok: true, detail: 'Đã gửi vào Telegram' }
      }
      if (!webPushEnabled()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Server chưa cấu hình VAPID' })
      try {
        const n = await sendPushToUser(me.id, { title: '🔔 Thử nhắc nhở', body: 'Web Push đang hoạt động.', url: '/' })
        return { ok: true, detail: `Đã gửi tới ${n} thiết bị` }
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message })
      }
    }),

  /** Nhật ký thông báo gần đây — để biết cái gì đã gửi, cái gì hỏng. */
  recent: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).default({}))
    .query(async ({ ctx, input }) => {
      return db.notification.findMany({
        where: { userId: ctx.user.id },
        orderBy: { fireAt: 'desc' },
        take: input.limit,
        select: {
          id: true, kind: true, title: true, body: true, fireAt: true,
          status: true, sentAt: true, channels: true, error: true, attempts: true,
        },
      })
    }),

  /** Đếm nhanh cho badge ở Cài đặt. */
  upcomingCount: protectedProcedure.query(async ({ ctx }) => {
    return db.notification.count({
      where: { userId: ctx.user.id, status: 'PENDING', fireAt: { gte: new Date() } },
    })
  }),
})
