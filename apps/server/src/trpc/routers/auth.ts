import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { TRPCError } from '@trpc/server'
import QRCode from 'qrcode'
import { z } from 'zod'
import { db } from '../../db.js'
import { clearFailures, isBlocked, registerFailure } from '../../lib/attempts.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { dropCookie, readCookie, writeCookie } from '../../lib/cookies.js'
import { decrypt, encrypt, generateRecoveryCodes, hashRecoveryCode, signTicket, verifyTicket } from '../../lib/secrets.js'
import { createSession, invalidateAllSessions, invalidateSession, SESSION_COOKIE } from '../../lib/session.js'
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp.js'
import { CHALLENGE_TTL_MS, EXPECTED_ORIGINS, RP_ID, RP_NAME } from '../../lib/webauthn.js'
import { isProd } from '../../env.js'
import type { Context } from '../trpc.js'
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
const codeSchema = z.string().trim().min(6).max(20)

// bước 2: sau khi đúng mật khẩu, client cầm ticket này 5 phút để nộp mã
const MFA_TICKET_TTL_MS = 5 * 60_000
const MFA_MAX_FAILURES = 5
const MFA_FAILURE_WINDOW_MS = 15 * 60_000

async function startSession(ctx: Context, user: { id: string; name: string; role: 'PARENT' | 'CHILD' }) {
  const { token } = await createSession(user.id, ctx.req.headers['user-agent'])
  writeCookie(ctx.res, SESSION_COOKIE, token, cookieOptions)
  return { mfaRequired: false as const, id: user.id, name: user.name, role: user.role }
}

/** Nhận cả mã TOTP lẫn mã khôi phục; mã khôi phục dùng xong là bỏ. */
async function consumeSecondFactor(user: { id: string; totpSecret: string | null; recoveryCodes: string[] }, code: string) {
  const key = `mfa:${user.id}`
  if (isBlocked(key, MFA_MAX_FAILURES)) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Sai quá nhiều lần, thử lại sau 15 phút' })
  }
  if (user.totpSecret && verifyTotp(decrypt(user.totpSecret), code)) {
    clearFailures(key)
    return
  }
  const hashed = hashRecoveryCode(code)
  if (user.recoveryCodes.includes(hashed)) {
    await db.user.update({
      where: { id: user.id },
      data: { recoveryCodes: user.recoveryCodes.filter((c) => c !== hashed) },
    })
    clearFailures(key)
    return
  }
  const { left } = registerFailure(key, MFA_MAX_FAILURES, MFA_FAILURE_WINDOW_MS)
  throw new TRPCError({ code: 'UNAUTHORIZED', message: left > 0 ? `Mã không đúng (còn ${left} lần)` : 'Sai quá nhiều lần, thử lại sau 15 phút' })
}

const webauthnResponse = <T,>() => z.custom<T>((v) => typeof v === 'object' && v !== null && 'id' in v, 'Phản hồi WebAuthn không hợp lệ')

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

  /**
   * Bước 1. Đúng mật khẩu mà tài khoản bật 2 bước thì CHƯA tạo session —
   * trả ticket để client sang bước nhập mã (loginTotp).
   */
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
      if (user.totpEnabled) {
        return { mfaRequired: true as const, ticket: signTicket('mfa', { uid: user.id }, MFA_TICKET_TTL_MS) }
      }
      return startSession(ctx, user)
    }),

  /** Bước 2: mã TOTP hoặc mã khôi phục. */
  loginTotp: publicProcedure
    .input(z.object({ ticket: z.string(), code: codeSchema }))
    .mutation(async ({ input, ctx }) => {
      const t = verifyTicket<{ uid: string }>('mfa', input.ticket)
      if (!t) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Phiên đăng nhập đã hết hạn, đăng nhập lại' })
      const user = await db.user.findUnique({ where: { id: t.uid } })
      if (!user || !user.active || !user.totpEnabled) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ' })
      }
      await consumeSecondFactor(user, input.code)
      return startSession(ctx, user)
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    await invalidateSession(readCookie(ctx.req, SESSION_COOKIE))
    dropCookie(ctx.res, SESSION_COOKIE)
    return { ok: true }
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null
    const { id, name, email, role, avatarColor, birthday, familyId, telegramChatId, totpEnabled } = ctx.user
    return {
      id, name, email, role, avatarColor, birthday, familyId,
      familyName: ctx.session!.user.family.name,
      hasTelegram: Boolean(telegramChatId),
      totpEnabled,
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

  // ---------- bảo mật: tổng quan ----------

  security: protectedProcedure.query(async ({ ctx }) => {
    const passkeys = await db.passkey.findMany({
      where: { userId: ctx.user.id },
      select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'asc' },
    })
    const sessions = await db.session.count({ where: { userId: ctx.user.id } })
    return {
      totpEnabled: ctx.user.totpEnabled,
      recoveryCodesLeft: ctx.user.recoveryCodes.length,
      passkeys,
      sessions,
      rpId: RP_ID,
    }
  }),

  // ---------- đăng nhập 2 bước (TOTP) ----------

  /** Sinh bí mật mới, lưu ở trạng thái chưa bật; xác nhận bằng totpSetupConfirm. */
  totpSetupStart: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.totpEnabled) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Đã bật 2 bước rồi' })
    const secret = generateTotpSecret()
    await db.user.update({ where: { id: ctx.user.id }, data: { totpSecret: encrypt(secret) } })
    const uri = otpauthUri(secret, ctx.user.email)
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
    return { secret, uri, qrDataUrl }
  }),

  totpSetupConfirm: protectedProcedure
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ input, ctx }) => {
      // đọc lại thay vì tin ctx.user: bí mật vừa ghi ở bước trước
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } })
      if (user.totpEnabled) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Đã bật 2 bước rồi' })
      if (!user.totpSecret) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chưa bắt đầu thiết lập' })
      if (!verifyTotp(decrypt(user.totpSecret), input.code)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mã không đúng — kiểm tra lại ứng dụng xác thực' })
      }
      const codes = generateRecoveryCodes()
      await db.user.update({
        where: { id: ctx.user.id },
        data: { totpEnabled: true, recoveryCodes: codes.map(hashRecoveryCode) },
      })
      // trả mã gốc đúng một lần — DB chỉ giữ hash
      return { recoveryCodes: codes }
    }),

  /** Tắt cần cả mật khẩu lẫn mã hiện tại: ai cầm được máy đang đăng nhập cũng không tắt trộm được. */
  totpDisable: protectedProcedure
    .input(z.object({ password: z.string().min(1), code: codeSchema }))
    .mutation(async ({ input, ctx }) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } })
      if (!user.totpEnabled) return { ok: true }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu không đúng' })
      }
      await consumeSecondFactor(user, input.code)
      await db.user.update({
        where: { id: ctx.user.id },
        data: { totpEnabled: false, totpSecret: null, recoveryCodes: [] },
      })
      return { ok: true }
    }),

  recoveryCodesRegenerate: protectedProcedure
    .input(z.object({ password: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } })
      if (!user.totpEnabled) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chưa bật 2 bước' })
      if (!(await verifyPassword(ctx.user.passwordHash, input.password))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu không đúng' })
      }
      const codes = generateRecoveryCodes()
      await db.user.update({ where: { id: ctx.user.id }, data: { recoveryCodes: codes.map(hashRecoveryCode) } })
      return { recoveryCodes: codes }
    }),

  // ---------- passkey (WebAuthn) ----------

  passkeyRegisterOptions: protectedProcedure.mutation(async ({ ctx }) => {
    const existing = await db.passkey.findMany({ where: { userId: ctx.user.id }, select: { id: true, transports: true } })
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: ctx.user.email,
      userDisplayName: ctx.user.name,
      userID: new TextEncoder().encode(ctx.user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
      // residentKey: passkey lưu trên thiết bị → đăng nhập không cần gõ email
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    })
    const ticket = signTicket('wa-reg', { uid: ctx.user.id, challenge: options.challenge }, CHALLENGE_TTL_MS)
    return { options, ticket }
  }),

  passkeyRegister: protectedProcedure
    .input(
      z.object({
        ticket: z.string(),
        name: z.string().trim().min(1).max(60),
        response: webauthnResponse<RegistrationResponseJSON>(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const t = verifyTicket<{ uid: string; challenge: string }>('wa-reg', input.ticket)
      if (!t || t.uid !== ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Yêu cầu đã hết hạn, thử lại' })
      let verified
      try {
        verified = await verifyRegistrationResponse({
          response: input.response,
          expectedChallenge: t.challenge,
          expectedOrigin: EXPECTED_ORIGINS,
          expectedRPID: RP_ID,
        })
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Không xác minh được passkey: ${(err as Error).message}` })
      }
      if (!verified.verified) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không xác minh được passkey' })
      const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo
      const passkey = await db.passkey.create({
        data: {
          id: credential.id,
          userId: ctx.user.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          name: input.name,
        },
        select: { id: true, name: true },
      })
      return passkey
    }),

  passkeyRemove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.passkey.deleteMany({ where: { id: input.id, userId: ctx.user.id } })
      return { ok: true }
    }),

  passkeyRename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(60) }))
    .mutation(async ({ input, ctx }) => {
      await db.passkey.updateMany({ where: { id: input.id, userId: ctx.user.id }, data: { name: input.name } })
      return { ok: true }
    }),

  /** Không cần email: passkey là discoverable, trình duyệt tự liệt kê. */
  passkeyLoginOptions: publicProcedure.mutation(async () => {
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' })
    const ticket = signTicket('wa-auth', { challenge: options.challenge }, CHALLENGE_TTL_MS)
    return { options, ticket }
  }),

  passkeyLogin: publicProcedure
    .input(z.object({ ticket: z.string(), response: webauthnResponse<AuthenticationResponseJSON>() }))
    .mutation(async ({ input, ctx }) => {
      const t = verifyTicket<{ challenge: string }>('wa-auth', input.ticket)
      if (!t) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Yêu cầu đã hết hạn, thử lại' })
      const passkey = await db.passkey.findUnique({ where: { id: input.response.id }, include: { user: true } })
      if (!passkey || !passkey.user.active) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Passkey này không còn được đăng ký' })
      }
      let verified
      try {
        verified = await verifyAuthenticationResponse({
          response: input.response,
          expectedChallenge: t.challenge,
          expectedOrigin: EXPECTED_ORIGINS,
          expectedRPID: RP_ID,
          credential: {
            id: passkey.id,
            publicKey: new Uint8Array(passkey.publicKey),
            counter: Number(passkey.counter),
            transports: passkey.transports,
          },
        })
      } catch (err) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: `Không xác minh được passkey: ${(err as Error).message}` })
      }
      if (!verified.verified) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Không xác minh được passkey' })
      await db.passkey.update({
        where: { id: passkey.id },
        data: { counter: BigInt(verified.authenticationInfo.newCounter), lastUsedAt: new Date() },
      })
      return startSession(ctx, passkey.user)
    }),

  // ---------- phiên ----------

  /** Đăng xuất mọi thiết bị khác (giữ phiên hiện tại). */
  logoutOthers: protectedProcedure.mutation(async ({ ctx }) => {
    const current = readCookie(ctx.req, SESSION_COOKIE)
    await invalidateAllSessions(ctx.user.id)
    if (current) {
      const { token } = await createSession(ctx.user.id, ctx.req.headers['user-agent'])
      writeCookie(ctx.res, SESSION_COOKIE, token, cookieOptions)
    }
    return { ok: true }
  }),
})
