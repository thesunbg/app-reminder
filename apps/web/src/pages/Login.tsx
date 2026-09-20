import { useState } from 'react'
import { ErrorNote, Spinner } from '@/components/ui'
import { trpc } from '@/lib/trpc'

export default function Login() {
  const utils = trpc.useUtils()
  const needsBootstrap = trpc.auth.needsBootstrap.useQuery()
  const onDone = () => { void utils.auth.me.invalidate(); void utils.auth.needsBootstrap.invalidate() }

  const login = trpc.auth.login.useMutation({ onSuccess: onDone })
  const bootstrap = trpc.auth.bootstrap.useMutation({ onSuccess: onDone })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')

  if (needsBootstrap.isLoading) return <Spinner />
  const first = needsBootstrap.data === true
  const busy = login.isPending || bootstrap.isPending
  const error = login.error?.message ?? bootstrap.error?.message

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-2xl" style={{ background: 'var(--brand-soft)' }}>🏠</div>
          <h1 className="text-xl font-bold">{first ? 'Khởi tạo Family Hub' : 'Family Hub'}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {first ? 'Tạo gia đình và tài khoản phụ huynh đầu tiên' : 'Đăng nhập để tiếp tục'}
          </p>
        </div>

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
            <input className="input-base" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
        </form>
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
