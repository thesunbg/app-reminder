import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/db.js'
import { hashPassword } from '../src/lib/password.js'
import { decrypt, encrypt, generateRecoveryCodes, hashRecoveryCode, signTicket, verifyTicket } from '../src/lib/secrets.js'
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpCode, verifyTotp } from '../src/lib/totp.js'
import { appRouter } from '../src/trpc/router.js'
import type { Context } from '../src/trpc/trpc.js'

// ---------- unit: TOTP ----------

describe('totp — RFC 6238', () => {
  it('base32 đi và về', () => {
    const buf = Buffer.from('Hello, Family Hub!')
    assert.equal(base32Decode(base32Encode(buf)).toString(), buf.toString())
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI') // RFC 4648 (không padding)
  })

  it('khớp vector chuẩn trong RFC 6238 (SHA1, 8 số → lấy 6 số cuối)', () => {
    // secret "12345678901234567890"; T=59 → 94287082
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    assert.equal(totpCode(secret, 59_000), '287082')
    // T=1111111109 → 07081804
    assert.equal(totpCode(secret, 1_111_111_109_000), '081804')
  })

  it('chấp nhận lệch ±1 bước, từ chối xa hơn', () => {
    const secret = generateTotpSecret()
    const now = 1_700_000_000_000
    assert.equal(verifyTotp(secret, totpCode(secret, now), now), true)
    assert.equal(verifyTotp(secret, totpCode(secret, now - 30_000), now), true)
    assert.equal(verifyTotp(secret, totpCode(secret, now + 30_000), now), true)
    assert.equal(verifyTotp(secret, totpCode(secret, now - 60_000), now), false)
    assert.equal(verifyTotp(secret, 'abc', now), false)
    assert.equal(verifyTotp(secret, '12 34 56', now), verifyTotp(secret, '123456', now)) // bỏ khoảng trắng
  })

  it('otpauth URI có issuer, secret, account', () => {
    const uri = otpauthUri('ABCD', 'bo@giadinh.local')
    assert.match(uri, /^otpauth:\/\/totp\/Family%20Hub%3Abo%40giadinh\.local\?/)
    assert.match(uri, /secret=ABCD/)
    assert.match(uri, /issuer=Family\+Hub/)
  })
})

describe('secrets — mã hoá, ticket, mã khôi phục', () => {
  it('encrypt/decrypt đi và về, mỗi lần một bản mã khác nhau', () => {
    const a = encrypt('bí mật')
    const b = encrypt('bí mật')
    assert.notEqual(a, b)
    assert.equal(decrypt(a), 'bí mật')
    assert.equal(decrypt(b), 'bí mật')
  })

  it('ticket: đúng loại + chưa hết hạn mới hợp lệ; sửa 1 ký tự là hỏng', () => {
    const t = signTicket('mfa', { uid: 'u1' }, 60_000)
    assert.equal(verifyTicket<{ uid: string }>('mfa', t)?.uid, 'u1')
    assert.equal(verifyTicket('wa-auth', t), null)
    const expired = signTicket('mfa', { uid: 'u1' }, -1)
    assert.equal(verifyTicket('mfa', expired), null)
    const tampered = t.slice(0, -2) + (t.endsWith('A') ? 'B' : 'A') + t.slice(-1)
    assert.equal(verifyTicket('mfa', tampered), null)
    assert.equal(verifyTicket('mfa', undefined), null)
  })

  it('mã khôi phục: 8 mã xxxx-xxxx, hash không phân biệt hoa/thường và dấu gạch', () => {
    const codes = generateRecoveryCodes()
    assert.equal(codes.length, 8)
    for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/)
    assert.equal(hashRecoveryCode(codes[0]!), hashRecoveryCode(codes[0]!.toUpperCase().replace('-', ' ')))
  })
})

// ---------- tích hợp: luồng đăng nhập ----------

const MARK = `auth-${Date.now()}`
const EMAIL = `${MARK}@test.local`
const PASSWORD = 'matkhau-rat-manh'
let familyId = ''
let userId = ''

/** Context giả: đủ cho router đọc/ghi cookie, không cần Fastify thật. */
function fakeCtx(cookies: Record<string, string> = {}): Context & { jar: Record<string, string> } {
  const jar = { ...cookies }
  const req = { headers: { 'user-agent': 'test' }, cookies: jar }
  const res = {
    setCookie: (name: string, value: string) => { jar[name] = value },
    clearCookie: (name: string) => { delete jar[name] },
  }
  return { req, res, session: null, user: null, jar } as unknown as Context & { jar: Record<string, string> }
}

async function callerFor(cookies: Record<string, string> = {}) {
  const ctx = fakeCtx(cookies)
  const { validateSession, SESSION_COOKIE } = await import('../src/lib/session.js')
  const session = await validateSession(cookies[SESSION_COOKIE])
  ctx.session = session
  ctx.user = session?.user ?? null
  return { caller: appRouter.createCaller(ctx), ctx }
}

before(async () => {
  const family = await db.family.create({ data: { name: `Test ${MARK}` } })
  familyId = family.id
  const user = await db.user.create({
    data: { familyId, name: 'Bố', email: EMAIL, passwordHash: await hashPassword(PASSWORD), role: 'PARENT', diaryPrivate: false },
  })
  userId = user.id
})

after(async () => {
  await db.family.delete({ where: { id: familyId } }).catch(() => {})
  await db.$disconnect()
})

describe('đăng nhập 2 bước', () => {
  it('chưa bật: đúng mật khẩu là có session ngay', async () => {
    const { caller, ctx } = await callerFor()
    const r = await caller.auth.login({ email: EMAIL, password: PASSWORD })
    assert.equal(r.mfaRequired, false)
    assert.ok(ctx.jar['fh_session'])
  })

  it('bật: setup → confirm sai bị từ chối, confirm đúng trả 8 mã khôi phục', async () => {
    const { caller: anon, ctx } = await callerFor()
    await anon.auth.login({ email: EMAIL, password: PASSWORD })
    const { caller } = await callerFor(ctx.jar)

    const setup = await caller.auth.totpSetupStart()
    assert.match(setup.secret, /^[A-Z2-7]{32}$/)
    assert.match(setup.qrDataUrl, /^data:image\/png;base64,/)

    await assert.rejects(caller.auth.totpSetupConfirm({ code: '000000' }), /Mã không đúng/)
    const me1 = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(me1.totpEnabled, false) // sai thì chưa bật

    const ok = await caller.auth.totpSetupConfirm({ code: totpCode(setup.secret) })
    assert.equal(ok.recoveryCodes.length, 8)
    const me2 = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(me2.totpEnabled, true)
    assert.equal(me2.recoveryCodes.length, 8)
    assert.notEqual(me2.totpSecret, setup.secret) // DB giữ bản mã hoá, không giữ secret thô
  })

  it('đã bật: mật khẩu đúng chỉ trả ticket, chưa có cookie', async () => {
    const { caller, ctx } = await callerFor()
    const r = await caller.auth.login({ email: EMAIL, password: PASSWORD })
    assert.equal(r.mfaRequired, true)
    assert.equal(ctx.jar['fh_session'], undefined)
  })

  it('bước 2: mã sai bị từ chối, mã đúng tạo session', async () => {
    const { caller, ctx } = await callerFor()
    const r = await caller.auth.login({ email: EMAIL, password: PASSWORD })
    assert.equal(r.mfaRequired, true)
    const ticket = r.mfaRequired ? r.ticket : ''
    await assert.rejects(caller.auth.loginTotp({ ticket, code: '000000' }), /Mã không đúng/)
    assert.equal(ctx.jar['fh_session'], undefined)

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
    const secret = decrypt(user.totpSecret!)
    const ok = await caller.auth.loginTotp({ ticket, code: totpCode(secret) })
    assert.equal(ok.mfaRequired, false)
    assert.ok(ctx.jar['fh_session'])
  })

  it('mã khôi phục dùng được một lần rồi thôi', async () => {
    // tạo lại để có mã gốc trong tay
    const { caller: anon, ctx: c0 } = await callerFor()
    const r0 = await anon.auth.login({ email: EMAIL, password: PASSWORD })
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
    await anon.auth.loginTotp({ ticket: r0.mfaRequired ? r0.ticket : '', code: totpCode(decrypt(user.totpSecret!)) })
    const { caller: authed } = await callerFor(c0.jar)
    const { recoveryCodes } = await authed.auth.recoveryCodesRegenerate({ password: PASSWORD })
    const code = recoveryCodes[0]!

    const { caller, ctx } = await callerFor()
    const r = await caller.auth.login({ email: EMAIL, password: PASSWORD })
    const ticket = r.mfaRequired ? r.ticket : ''
    await caller.auth.loginTotp({ ticket, code })
    assert.ok(ctx.jar['fh_session'])
    const after1 = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(after1.recoveryCodes.length, 7)

    const { caller: again } = await callerFor()
    const r2 = await again.auth.login({ email: EMAIL, password: PASSWORD })
    await assert.rejects(again.auth.loginTotp({ ticket: r2.mfaRequired ? r2.ticket : '', code }), /Mã không đúng/)
  })

  it('ticket giả hoặc hết hạn bị từ chối', async () => {
    const { caller } = await callerFor()
    await assert.rejects(caller.auth.loginTotp({ ticket: 'abc.def', code: '123456' }), /hết hạn/)
    const expired = signTicket('mfa', { uid: userId }, -1)
    await assert.rejects(caller.auth.loginTotp({ ticket: expired, code: '123456' }), /hết hạn/)
  })

  it('tắt: cần cả mật khẩu và mã; sau đó login lại không cần bước 2', async () => {
    const { caller: anon, ctx } = await callerFor()
    const r = await anon.auth.login({ email: EMAIL, password: PASSWORD })
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
    const secret = decrypt(user.totpSecret!)
    await anon.auth.loginTotp({ ticket: r.mfaRequired ? r.ticket : '', code: totpCode(secret) })
    const { caller } = await callerFor(ctx.jar)

    await assert.rejects(caller.auth.totpDisable({ password: 'sai', code: totpCode(secret) }), /Mật khẩu không đúng/)
    await caller.auth.totpDisable({ password: PASSWORD, code: totpCode(secret) })
    const after2 = await db.user.findUniqueOrThrow({ where: { id: userId } })
    assert.equal(after2.totpEnabled, false)
    assert.equal(after2.totpSecret, null)
    assert.equal(after2.recoveryCodes.length, 0)

    const { caller: fresh } = await callerFor()
    const r2 = await fresh.auth.login({ email: EMAIL, password: PASSWORD })
    assert.equal(r2.mfaRequired, false)
  })
})

describe('passkey', () => {
  it('options đăng ký gắn đúng rpID, loại trừ passkey đã có; options đăng nhập không cần email', async () => {
    const { caller: anon, ctx } = await callerFor()
    await anon.auth.login({ email: EMAIL, password: PASSWORD })
    const { caller } = await callerFor(ctx.jar)

    await db.passkey.create({
      data: { id: 'cred-1', userId, publicKey: Buffer.from([1, 2, 3]), counter: 0n, name: 'Thử', transports: ['internal'] },
    })
    const reg = await caller.auth.passkeyRegisterOptions()
    assert.equal(reg.options.rp.id, 'localhost')
    assert.equal(reg.options.user.name, EMAIL)
    assert.deepEqual(reg.options.excludeCredentials?.map((c) => c.id), ['cred-1'])
    assert.equal(reg.options.authenticatorSelection?.residentKey, 'required')
    assert.equal(verifyTicket<{ uid: string; challenge: string }>('wa-reg', reg.ticket)?.challenge, reg.options.challenge)

    const login = await anon.auth.passkeyLoginOptions()
    assert.equal(login.options.rpId, 'localhost')
    assert.equal(login.options.allowCredentials?.length ?? 0, 0)

    // phản hồi giả (chữ ký sai) phải bị từ chối, không tạo session
    const { caller: fresh, ctx: c2 } = await callerFor()
    await assert.rejects(
      fresh.auth.passkeyLogin({
        ticket: login.ticket,
        response: {
          id: 'cred-1', rawId: 'cred-1', type: 'public-key', clientExtensionResults: {},
          response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
        },
      }),
      /Không xác minh được passkey/,
    )
    assert.equal(c2.jar['fh_session'], undefined)

    // xoá và liệt kê
    const sec = await caller.auth.security()
    assert.equal(sec.passkeys.length, 1)
    await caller.auth.passkeyRemove({ id: 'cred-1' })
    assert.equal((await caller.auth.security()).passkeys.length, 0)
  })
})

// ---------- passkey: authenticator phần mềm để đi hết đường đăng ký → đăng nhập ----------
// Mô phỏng đúng cấu trúc WebAuthn (attestation 'none', ES256), đủ để
// verifyRegistrationResponse/verifyAuthenticationResponse của server chạy thật.

import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'

function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n])
    if (n < 256) return Buffer.from([(major << 5) | 24, n])
    return Buffer.from([(major << 5) | 25, n >> 8, n & 255])
  }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v])
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]) }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, val]) => [cbor(k), cbor(val)])])
  throw new Error('cbor: kiểu không hỗ trợ')
}
const b64u = (b: Buffer) => b.toString('base64url')

function softAuthenticator(origin = 'http://localhost:5173', rpId = 'localhost') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credId = randomBytes(16)
  const rpIdHash = createHash('sha256').update(rpId).digest()
  let counter = 0

  return {
    id: b64u(credId),
    register(challenge: string) {
      const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]))
      const credLen = Buffer.alloc(2); credLen.writeUInt16BE(credId.length)
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), credLen, credId, cose])
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }))
      const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key' as const, clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
      }
    },
    authenticate(challenge: string) {
      counter += 1
      const ctr = Buffer.alloc(4); ctr.writeUInt32BE(counter)
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), ctr])
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }))
      const signature = createSign('SHA256').update(Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()])).sign(privateKey)
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key' as const, clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature) },
      }
    },
  }
}

describe('passkey — đăng ký rồi đăng nhập bằng authenticator phần mềm', () => {
  it('đăng ký lưu đúng khoá; đăng nhập không cần mật khẩu, không cần bước 2; counter tăng', async () => {
    const auth = softAuthenticator()
    const { caller: anon, ctx } = await callerFor()
    await anon.auth.login({ email: EMAIL, password: PASSWORD })
    const { caller } = await callerFor(ctx.jar)

    const reg = await caller.auth.passkeyRegisterOptions()
    const created = await caller.auth.passkeyRegister({ ticket: reg.ticket, name: 'Mac test', response: auth.register(reg.options.challenge) })
    assert.equal(created.id, auth.id)
    const row = await db.passkey.findUniqueOrThrow({ where: { id: auth.id } })
    assert.equal(row.userId, userId)
    assert.equal(row.counter, 0n)
    assert.deepEqual(row.transports, ['internal'])

    // ticket đăng ký không dùng lại được với challenge khác
    await assert.rejects(caller.auth.passkeyRegister({ ticket: reg.ticket, name: 'x', response: auth.register('khac') }), /Không xác minh/)

    // đăng nhập: tài khoản đang bật 2 bước? bật lại để chắc passkey bỏ qua TOTP
    const setup = await caller.auth.totpSetupStart()
    await caller.auth.totpSetupConfirm({ code: totpCode(setup.secret) })

    const { caller: fresh, ctx: c2 } = await callerFor()
    const opts = await fresh.auth.passkeyLoginOptions()
    const r = await fresh.auth.passkeyLogin({ ticket: opts.ticket, response: auth.authenticate(opts.options.challenge) })
    assert.equal(r.mfaRequired, false)
    assert.equal(r.id, userId)
    assert.ok(c2.jar['fh_session'])
    const after = await db.passkey.findUniqueOrThrow({ where: { id: auth.id } })
    assert.equal(after.counter, 1n)
    assert.ok(after.lastUsedAt)

    // phát lại cùng phản hồi (counter không tăng) phải bị từ chối — chống clone
    const { caller: replay, ctx: c3 } = await callerFor()
    const opts2 = await replay.auth.passkeyLoginOptions()
    const resp = auth.authenticate(opts2.options.challenge)
    await replay.auth.passkeyLogin({ ticket: opts2.ticket, response: resp })
    const { caller: replay2, ctx: c4 } = await callerFor()
    const opts3 = await replay2.auth.passkeyLoginOptions()
    // chữ ký cũ ký challenge cũ → challenge mới không khớp
    await assert.rejects(replay2.auth.passkeyLogin({ ticket: opts3.ticket, response: resp }), /Không xác minh/)
    assert.ok(c3.jar['fh_session'])
    assert.equal(c4.jar['fh_session'], undefined)

    // dọn: tắt 2 bước để các test khác (nếu chạy lại) không bị ảnh hưởng
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } })
    const { caller: authed } = await callerFor(c2.jar)
    await authed.auth.totpDisable({ password: PASSWORD, code: totpCode(decrypt(u.totpSecret!)) })
  })
})
