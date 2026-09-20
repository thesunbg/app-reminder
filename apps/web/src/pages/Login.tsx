import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useState } from 'react'
import { ErrorNote, Spinner } from '@/components/ui'
import { trpc } from '@/lib/trpc'

export default function Login() {
  const utils = trpc.useUtils()
  const needsBootstrap = trpc.auth.needsBootstrap.useQuery()
  const onDone = () => { void utils.auth.me.invalidate(); void utils.auth.needsBootstrap.invalidate() }

  // bước 2: có ticket nghĩa là đúng mật khẩu, đang chờ mã
  const [mfaTicket, setMfaTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const login = trpc.auth.login.useMutation({
    onSuccess: (r) => { if (r.mfaRequired) setMfaTicket(r.ticket); else onDone() },
  })
  const loginTotp = trpc.auth.loginTotp.useMutation({ onSuccess: onDone })
  const bootstrap = trpc.auth.bootstrap.useMutation({ onSuccess: onDone })
  const passkeyOptions = trpc.auth.passkeyLoginOptions.useMutation()
  const passkeyLogin = trpc.auth.passkeyLogin.useMutation({ onSuccess: onDone })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')

  if (needsBootstrap.isLoading) return <Spinner />
  const first = needsBootstrap.data === true
  const busy = login.isPending || bootstrap.isPending || loginTotp.isPending
  const error = login.error?.message ?? bootstrap.error?.message ?? loginTotp.error?.message ?? passkeyError
  const canPasskey = !first && browserSupportsWebAuthn()

  async function withPasskey() {
    setPasskeyError(null)
    setPasskeyBusy(true)
    try {
      const { options, ticket } = await passkeyOptions.mutateAsync()
      const response = await startAuthentication({ optionsJSON: options })
      await passkeyLogin.mutateAsync({ ticket, response })
    } catch (err) {
      const e = err as Error & { name?: string }
      // người dùng bấm huỷ hộp thoại hệ thống — không phải lỗi
      if (e.name !== 'NotAllowedError') setPasskeyError(e.message)
    } finally {
      setPasskeyBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-2xl" style={{ background: 'var(--brand-soft)' }}>
            {mfaTicket ? '🔐' : '🏠'}
          </div>
          <h1 className="text-xl font-bold">{first ? 'Khởi tạo Family Hub' : mfaTicket ? 'Xác thực 2 bước' : 'Family Hub'}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {first
              ? 'Tạo gia đình và tài khoản phụ huynh đầu tiên'
              : mfaTicket
                ? 'Nhập mã 6 số từ ứng dụng xác thực, hoặc một mã khôi phục'
                : 'Đăng nhập để tiếp tục'}
          </p>
        </div>

        {mfaTicket ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              loginTotp.mutate({ ticket: mfaTicket, code })
            }}
          >
            <Field label="Mã xác thực">
              <input
                className="input-base text-center text-lg tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                required
              />
            </Field>
            {error && <ErrorNote message={error} />}
            <button className="btn btn-primary mt-2" disabled={busy || code.trim().length < 6}>
              {busy ? 'Đang kiểm tra…' : 'Xác nhận'}
            </button>
            <button type="button" className="btn btn-ghost text-sm" onClick={() => { setMfaTicket(null); setCode(''); loginTotp.reset() }}>
              ← Quay lại
            </button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (first) bootstrap.mutate({ familyName, name, email, password })
              else login.mutate({ email, password })
            }}
          >
            {first && (
              <>
                <Field label="Tên gia đình">
                  <input className="input-base" value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Gia đình Nguyễn" required />
                </Field>
                <Field label="Tên của bạn">
                  <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bố" required />
                </Field>
              </>
            )}
            <Field label="Email">
              <input className="input-base" type="email" autoComplete="username webauthn" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Mật khẩu">
              <input
                className="input-base"
                type="password"
                autoComplete={first ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={first ? 8 : undefined}
                required
              />
            </Field>

            {error && <ErrorNote message={error} />}

            <button className="btn btn-primary mt-2" disabled={busy}>
              {busy ? 'Đang xử lý…' : first ? 'Tạo gia đình' : 'Đăng nhập'}
            </button>

            {canPasskey && (
              <>
                <div className="my-1 flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  hoặc
                  <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => void withPasskey()} disabled={passkeyBusy}>
                  {passkeyBusy ? 'Đang chờ thiết bị…' : '🔑 Đăng nhập bằng passkey'}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  )
}
