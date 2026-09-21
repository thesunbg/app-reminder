import { TRPCError } from '@trpc/server'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { sendMessage, telegramEnabled, escapeHtml } from '../../lib/telegram.js'
import { sendPushToUser, webPushEnabled } from '../../lib/webpush.js'
import { fcmConfigError, fcmEnabled, sendNativeToUser } from '../../lib/fcm.js'
import { materializeRoutines } from '../../notifications/materialize.js'
import { notificationUrl } from '../../notifications/messages.js'
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
        notifyNative: true, quietFrom: true, quietTo: true,
        _count: { select: { pushDevices: true, nativeDevices: true } },
      },
    })
    return {
      serverTelegramReady: telegramEnabled(),
      serverWebPushReady: webPushEnabled(),
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
      telegramLinked: Boolean(me.telegramChatId),
      notifyTelegram: me.notifyTelegram,
      notifyWebPush: me.notifyWebPush,
      notifyNative: me.notifyNative,
      pushDevices: me._count.pushDevices,
      serverNativeReady: fcmEnabled(),
      nativeConfigError: fcmConfigError(),
      nativeDevices: me._count.nativeDevices,
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

  /**
   * App Capacitor báo token FCM của máy này. Gọi lại mỗi lần mở app: FCM có
   * thể đổi token bất cứ lúc nào, và `lastSeenAt` cho biết máy nào còn dùng.
   */
  registerNative: protectedProcedure
    .input(
      z.object({
        token: z.string().min(10).max(500),
        platform: z.enum(['ios', 'android']),
        model: z.string().max(80).optional(),
        appVersion: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db.nativeDevice.upsert({
        where: { token: input.token },
        create: { ...input, userId: ctx.user.id },
        // cùng một máy có thể đổi người đăng nhập -> token phải theo chủ mới,
        // nếu không nhắc của bố sẽ hiện trên máy con.
        update: { ...input, userId: ctx.user.id, lastSeenAt: new Date() },
      })
      return { ok: true }
    }),

  unregisterNative: protectedProcedure
    .input(z.object({ token: z.string().min(10).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await db.nativeDevice.deleteMany({ where: { token: input.token, userId: ctx.user.id } })
      return { ok: true }
    }),

  /**
   * Danh sách nhắc sắp tới để app native tự đặt local notification.
   *
   * Lý do tồn tại: push chỉ tới khi máy có mạng và Apple/Google chịu chuyển.
   * Local notification thì hệ điều hành tự bắn đúng giờ kể cả máy bay chế độ.
   * App đặt lịch cục bộ, push đến thì trùng nội dung — cả hai dùng chung `tag`
   * nên hệ điều hành gộp lại, người dùng không thấy hai lần.
   *
   * KHÔNG trả về DAILY_DIGEST: nội dung của nó (`body`) chỉ là chỗ giữ chỗ cho
   * tới lúc dispatch tính lại — ngày chưa xảy ra thì chưa biết bạn làm được gì.
   * Đặt lịch cục bộ cho nó nghĩa là tối nào cũng nhận một thông báo rỗng.
   */
  upcoming: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(14).default(3) }).default({}))
    .query(async ({ ctx, input }) => {
      const until = new Date(Date.now() + input.days * 86_400_000)
      const rows = await db.notification.findMany({
        where: {
          userId: ctx.user.id,
          status: 'PENDING',
          fireAt: { gte: new Date(), lte: until },
          kind: { not: 'DAILY_DIGEST' },
        },
        orderBy: { fireAt: 'asc' },
        // iOS chỉ giữ 64 local notification đang chờ cho mỗi app; xin nhiều hơn
        // thì hệ điều hành lặng lẽ bỏ phần thừa, mà bỏ phần nào thì không nói.
        take: 60,
        select: { id: true, kind: true, refTable: true, refId: true, title: true, body: true, fireAt: true },
      })
      // url tính bằng đúng hàm dispatch dùng cho push, để bấm vào local
      // notification và bấm vào push mở cùng một màn hình. `tag` cũng phải là
      // refId y như dispatch gửi kèm push — khác một chữ là hệ điều hành coi
      // chúng là hai thông báo và hiện cả hai.
      return rows.map(({ refTable, refId, ...r }) => ({
        ...r,
        tag: refId,
        url: notificationUrl({ kind: r.kind, refTable }),
      }))
    }),

  updatePreferences: protectedProcedure
    .input(
      z.object({
        notifyTelegram: z.boolean().optional(),
        notifyWebPush: z.boolean().optional(),
        notifyNative: z.boolean().optional(),
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
    .input(z.object({ channel: z.enum(['telegram', 'webpush', 'native']) }))
    .mutation(async ({ ctx, input }) => {
      const me = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } })
      if (input.channel === 'telegram') {
        if (!telegramEnabled()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Server chưa cấu hình bot Telegram' })
        if (!me.telegramChatId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Bạn chưa liên kết Telegram' })
        await sendMessage(me.telegramChatId, `🔔 <b>Thử nhắc nhở</b>\nNếu bạn đọc được tin này, ${escapeHtml(me.name)} sẽ nhận được nhắc việc qua Telegram.`)
        return { ok: true, detail: 'Đã gửi vào Telegram' }
      }
      if (input.channel === 'native') {
        if (!fcmEnabled()) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: fcmConfigError() ?? 'Server chưa cấu hình FCM' })
        }
        try {
          const n = await sendNativeToUser(me.id, { title: '🔔 Thử nhắc nhở', body: 'Push native đang hoạt động.', url: '/' })
          return { ok: true, detail: `Đã gửi tới ${n} thiết bị` }
        } catch (err) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message })
        }
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
