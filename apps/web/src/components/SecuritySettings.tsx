import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'
import { Card, ErrorNote, Spinner } from '@/components/ui'
import { trpc } from '@/lib/trpc'

export default function SecuritySettings() {
  const security = trpc.auth.security.useQuery()
  if (security.isLoading) return <Card className="mb-4 p-4"><Spinner /></Card>
  const s = security.data
  if (!s) return null

  return (
    <Card className="mb-4 flex flex-col gap-5 p-4">
      <h2 className="font-semibold">Bảo mật & dữ liệu</h2>
      <TotpSection enabled={s.totpEnabled} recoveryLeft={s.recoveryCodesLeft} />
      <PasskeySection passkeys={s.passkeys} rpId={s.rpId} />
      <PasswordSection sessions={s.sessions} />
      <ExportSection />
    </Card>
  )
}

function SectionHead({ title, hint, on }: { title: string; hint: string; on?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {on !== undefined && (
        <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: on ? 'var(--ok)' : 'var(--border)' }} aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{hint}</p>
      </div>
    </div>
  )
}

// ---------- đăng nhập 2 bước ----------

function TotpSection({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const utils = trpc.useUtils()
  const refresh = () => { void utils.auth.security.invalidate(); void utils.auth.me.invalidate() }

  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [regen, setRegen] = useState(false)
  const [password, setPassword] = useState('')

  const start = trpc.auth.totpSetupStart.useMutation({ onSuccess: (d) => { setSetup(d); setCode('') } })
  const confirm = trpc.auth.totpSetupConfirm.useMutation({
    onSuccess: (d) => { setCodes(d.recoveryCodes); setSetup(null); setCode(''); refresh() },
  })
  const disable = trpc.auth.totpDisable.useMutation({
    onSuccess: () => { setDisabling(false); setPassword(''); setCode(''); setCodes(null); refresh() },
  })
  const regenerate = trpc.auth.recoveryCodesRegenerate.useMutation({
    onSuccess: (d) => { setCodes(d.recoveryCodes); setRegen(false); setPassword(''); refresh() },
  })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SectionHead
            on={enabled}
            title="Đăng nhập 2 bước"
            hint={enabled ? `Đang bật · còn ${recoveryLeft} mã khôi phục` : 'Thêm mã 6 số từ ứng dụng xác thực khi đăng nhập'}
          />
        </div>
        {!enabled && !setup && (
          <button className="btn btn-primary !py-1.5 text-xs" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? '…' : 'Bật'}
          </button>
        )}
        {enabled && !disabling && (
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => { setDisabling(true); setRegen(false) }}>Tắt</button>
        )}
      </div>

      {start.error && <ErrorNote message={start.error.message} />}

      {setup && (
        <div className="flex flex-col gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
          <p className="text-sm">
            1. Mở <b>Google Authenticator</b>, <b>1Password</b>, hoặc app Mật khẩu của iPhone và quét mã:
          </p>
          <img src={setup.qrDataUrl} alt="Mã QR thiết lập 2 bước" width={180} height={180} className="mx-auto rounded-lg bg-white p-2" />
          <details className="text-xs" style={{ color: 'var(--muted)' }}>
            <summary className="cursor-pointer">Không quét được? Nhập tay</summary>
            <code className="mt-1 block break-all select-all rounded-md px-2 py-1 font-mono text-sm" style={{ background: 'var(--surface)', color: 'var(--text)' }}>
              {setup.secret.match(/.{1,4}/g)?.join(' ')}
            </code>
          </details>
          <p className="text-sm">2. Nhập mã 6 số app đang hiển thị để xác nhận:</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); confirm.mutate({ code }) }}>
            <input
              className="input-base flex-1 text-center tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
            />
            <button className="btn btn-primary" disabled={confirm.isPending || code.trim().length < 6}>Xác nhận</button>
          </form>
          {confirm.error && <ErrorNote message={confirm.error.message} />}
          <button className="btn btn-ghost text-xs" onClick={() => setSetup(null)}>Huỷ</button>
        </div>
      )}

      {codes && <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />}

      {enabled && !disabling && !regen && (
        <button className="self-start text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => setRegen(true)}>
          Tạo lại mã khôi phục
        </button>
      )}

      {(disabling || regen) && (
        <form
          className="flex flex-col gap-2 rounded-xl p-3"
          style={{ background: 'var(--surface-2)' }}
          onSubmit={(e) => {
            e.preventDefault()
            if (disabling) disable.mutate({ password, code })
            else regenerate.mutate({ password })
          }}
        >
          <p className="text-sm font-semibold">{disabling ? 'Tắt đăng nhập 2 bước' : 'Tạo lại mã khôi phục'}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {disabling ? 'Cần mật khẩu và mã hiện tại.' : 'Bộ mã cũ sẽ không dùng được nữa.'}
          </p>
          <input className="input-base" type="password" autoComplete="current-password" placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} />
          {disabling && (
            <input className="input-base" inputMode="numeric" autoComplete="one-time-code" placeholder="Mã 6 số hoặc mã khôi phục" value={code} onChange={(e) => setCode(e.target.value)} />
          )}
          {(disable.error ?? regenerate.error) && <ErrorNote message={(disable.error ?? regenerate.error)!.message} />}
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={disable.isPending || regenerate.isPending || !password}>
              {disabling ? 'Tắt 2 bước' : 'Tạo mã mới'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setDisabling(false); setRegen(false); setPassword(''); setCode('') }}>Huỷ</button>
          </div>
        </form>
      )}
    </section>
  )
}

function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = codes.join('\n')
  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}>
      <p className="text-sm font-semibold">Mã khôi phục — lưu ngay, chỉ hiện một lần</p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Mất điện thoại thì dùng một mã này để đăng nhập. Mỗi mã dùng được một lần.
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-md px-3 py-2 font-mono text-sm select-all" style={{ background: 'var(--surface)' }}>
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex gap-2">
        <button
          className="btn btn-ghost flex-1 text-xs"
          onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)) }}
        >
          {copied ? '✓ Đã sao chép' : 'Sao chép'}
        </button>
        <a
          className="btn btn-ghost flex-1 text-xs"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Family Hub — mã khôi phục\n\n${text}\n`)}`}
          download="family-hub-ma-khoi-phuc.txt"
        >
          Tải file
        </a>
        <button className="btn btn-primary text-xs" onClick={onClose}>Đã lưu</button>
      </div>
    </div>
  )
}

// ---------- passkey ----------

type PasskeyRow = { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: Date; lastUsedAt: Date | null }

function PasskeySection({ passkeys, rpId }: { passkeys: PasskeyRow[]; rpId: string }) {
  const utils = trpc.useUtils()
  const refresh = () => void utils.auth.security.invalidate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const options = trpc.auth.passkeyRegisterOptions.useMutation()
  const register = trpc.auth.passkeyRegister.useMutation({ onSuccess: refresh })
  const remove = trpc.auth.passkeyRemove.useMutation({ onSuccess: refresh })
  const rename = trpc.auth.passkeyRename.useMutation({ onSuccess: refresh })

  const supported = browserSupportsWebAuthn()

  async function add() {
    setError(null)
    setBusy(true)
    try {
      const { options: opts, ticket } = await options.mutateAsync()
      const response = await startRegistration({ optionsJSON: opts })
      const name = defaultPasskeyName()
      await register.mutateAsync({ ticket, response, name })
    } catch (err) {
      const e = err as Error & { name?: string }
      if (e.name === 'InvalidStateError') setError('Thiết bị này đã có passkey cho tài khoản của bạn')
      else if (e.name !== 'NotAllowedError') setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SectionHead
            on={passkeys.length > 0}
            title="Passkey"
            hint={supported ? `Đăng nhập bằng Face ID / vân tay / khoá bảo mật, không cần mật khẩu (${rpId})` : 'Trình duyệt này không hỗ trợ passkey'}
          />
        </div>
        {supported && (
          <button className="btn btn-primary !py-1.5 text-xs" onClick={() => void add()} disabled={busy}>
            {busy ? 'Đang chờ…' : '+ Thêm'}
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}
      {passkeys.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
              <span aria-hidden>🔑</span>
              <div className="min-w-0 flex-1">
                <button
                  className="block max-w-full truncate text-left text-sm font-semibold"
                  title="Đổi tên"
                  onClick={() => {
                    const name = window.prompt('Tên passkey', p.name)?.trim()
                    if (name && name !== p.name) rename.mutate({ id: p.id, name })
                  }}
                >
                  {p.name}
                </button>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {p.deviceType === 'multiDevice' ? 'Đồng bộ qua iCloud/Google' : 'Chỉ trên thiết bị này'}
                  {' · '}
                  {p.lastUsedAt ? `dùng ${relative(p.lastUsedAt)}` : `tạo ${relative(p.createdAt)}`}
                </p>
              </div>
              <button
                className="btn btn-ghost !px-2 !py-1 text-xs"
                onClick={() => { if (window.confirm(`Xoá passkey "${p.name}"?`)) remove.mutate({ id: p.id }) }}
                disabled={remove.isPending}
              >
                Xoá
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function defaultPasskeyName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'Thiết bị'
}

function relative(d: Date): string {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
  if (days <= 0) return 'hôm nay'
  if (days === 1) return 'hôm qua'
  if (days < 30) return `${days} ngày trước`
  return new Date(d).toLocaleDateString('vi-VN')
}

// ---------- mật khẩu & phiên ----------

function PasswordSection({ sessions }: { sessions: number }) {
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => { setOpen(false); setCurrent(''); setNext(''); setDone('Đã đổi mật khẩu') },
  })
  const logoutOthers = trpc.auth.logoutOthers.useMutation({
    onSuccess: () => { setDone('Đã đăng xuất các thiết bị khác'); void utils.auth.security.invalidate() },
  })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SectionHead title="Mật khẩu & thiết bị" hint={`Đang đăng nhập trên ${sessions} thiết bị`} />
        </div>
        <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setOpen((v) => !v)}>{open ? 'Đóng' : 'Đổi mật khẩu'}</button>
      </div>
      {open && (
        <form
          className="flex flex-col gap-2 rounded-xl p-3"
          style={{ background: 'var(--surface-2)' }}
          onSubmit={(e) => { e.preventDefault(); change.mutate({ current, next }) }}
        >
          <input className="input-base" type="password" autoComplete="current-password" placeholder="Mật khẩu hiện tại" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input className="input-base" type="password" autoComplete="new-password" placeholder="Mật khẩu mới (tối thiểu 8 ký tự)" value={next} onChange={(e) => setNext(e.target.value)} />
          {change.error && <ErrorNote message={change.error.message} />}
          <button className="btn btn-primary" disabled={change.isPending || !current || next.length < 8}>Lưu mật khẩu</button>
        </form>
      )}
      {done && <p className="text-xs" style={{ color: 'var(--ok)' }}>✓ {done}</p>}
      {sessions > 1 && (
        <button className="self-start text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => logoutOthers.mutate()} disabled={logoutOthers.isPending}>
          Đăng xuất các thiết bị khác
        </button>
      )}
    </section>
  )
}

// ---------- export ----------

function ExportSection() {
  return (
    <section className="flex items-center gap-3">
      <div className="flex-1">
        <SectionHead
          title="Tải dữ liệu"
          hint="File JSON gồm thành viên, việc định kỳ, sự kiện, ghi chú, nhật ký, học tập. Nhật ký riêng tư của người khác không nằm trong đó."
        />
      </div>
      <a className="btn btn-ghost !py-1.5 text-xs" href="/export" download>Tải JSON</a>
    </section>
  )
}
