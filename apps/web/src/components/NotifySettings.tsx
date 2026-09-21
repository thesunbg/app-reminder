import { useEffect, useState } from 'react'
import { Card, ErrorNote, Spinner } from '@/components/ui'
import { isNative, registerForPush, rememberedToken, unregisterPush } from '@/lib/native'
import { checkPushSupport, currentSubscription, subscribePush, unsubscribePush } from '@/lib/push'
import { trpc } from '@/lib/trpc'

export default function NotifySettings() {
  const utils = trpc.useUtils()
  const status = trpc.notify.status.useQuery()
  const upcoming = trpc.notify.upcomingCount.useQuery()

  const [code, setCode] = useState<{ code: string; expiresInMin: number } | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [nativeBusy, setNativeBusy] = useState(false)
  const [nativeToken, setNativeToken] = useState<string | null>(() => rememberedToken())

  const support = checkPushSupport()
  const refresh = () => { void utils.notify.status.invalidate(); void utils.notify.upcomingCount.invalidate() }

  useEffect(() => {
    void currentSubscription().then((s) => setSubscribed(Boolean(s)))
  }, [])

  const makeCode = trpc.notify.createTelegramCode.useMutation({ onSuccess: (d) => setCode(d) })
  const unlink = trpc.notify.unlinkTelegram.useMutation({ onSuccess: () => { setCode(null); refresh() } })
  const savePrefs = trpc.notify.updatePreferences.useMutation({ onSuccess: refresh })
  const subscribe = trpc.notify.subscribePush.useMutation({ onSuccess: () => { setSubscribed(true); refresh() } })
  const unsubscribe = trpc.notify.unsubscribePush.useMutation({ onSuccess: () => { setSubscribed(false); refresh() } })
  const registerNative = trpc.notify.registerNative.useMutation({ onSuccess: refresh })
  const unregisterNative = trpc.notify.unregisterNative.useMutation({ onSuccess: refresh })
  const sendTest = trpc.notify.sendTest.useMutation({
    onSuccess: (d) => setTestMsg(d.detail),
    onError: (e) => setTestMsg(`❌ ${e.message}`),
  })

  if (status.isLoading) return <Card className="p-4"><Spinner /></Card>
  const s = status.data
  if (!s) return null

  async function togglePush(on: boolean) {
    setPushError(null)
    setPushBusy(true)
    try {
      if (on) {
        if (!s!.vapidPublicKey) throw new Error('Server chưa cấu hình VAPID')
        const sub = await subscribePush(s!.vapidPublicKey)
        await subscribe.mutateAsync(sub)
      } else {
        const endpoint = await unsubscribePush()
        if (endpoint) await unsubscribe.mutateAsync({ endpoint })
        else setSubscribed(false)
      }
    } catch (err) {
      setPushError((err as Error).message)
    } finally {
      setPushBusy(false)
    }
  }

  async function toggleNative(on: boolean) {
    setNativeError(null)
    setNativeBusy(true)
    try {
      if (on) {
        const reg = await registerForPush()
        setNativeToken(reg.token)
        await registerNative.mutateAsync(reg)
      } else {
        // Không biết token thì vẫn gỡ được ở máy; bản ghi phía server sẽ tự rụng
        // ở lần gửi sau khi FCM báo token đã chết.
        if (nativeToken) await unregisterNative.mutateAsync({ token: nativeToken })
        await unregisterPush()
        setNativeToken(null)
      }
    } catch (err) {
      setNativeError((err as Error).message)
    } finally {
      setNativeBusy(false)
    }
  }

  return (
    <Card className="mb-4 flex flex-col gap-4 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Kênh nhắc nhở</h2>
        {(upcoming.data ?? 0) > 0 && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {upcoming.data} nhắc nhở đang chờ
          </span>
        )}
      </div>

      {/* ---------- Telegram ---------- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Dot on={s.telegramLinked && s.notifyTelegram} />
          <span className="flex-1 text-sm font-semibold">Telegram</span>
          {s.telegramLinked && (
            <Switch
              checked={s.notifyTelegram}
              onChange={(v) => savePrefs.mutate({ notifyTelegram: v })}
              label="Bật nhắc qua Telegram"
            />
          )}
        </div>

        {!s.serverTelegramReady && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Server chưa cấu hình <code>TELEGRAM_BOT_TOKEN</code>. Tạo bot qua @BotFather rồi
            thêm token vào <code>apps/server/.env</code> và khởi động lại server.
          </p>
        )}

        {s.serverTelegramReady && !s.telegramLinked && (
          <div className="flex flex-col gap-2">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Mở bot trên Telegram và gửi lệnh dưới đây để nhận nhắc nhở.
            </p>
            {code ? (
              <div className="rounded-xl px-3 py-3 text-center" style={{ background: 'var(--surface-2)' }}>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Gửi tin nhắn này cho bot:</p>
                <p className="my-1 font-mono text-lg font-bold tracking-wider">/start {code.code}</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Mã hết hạn sau {code.expiresInMin} phút</p>
              </div>
            ) : (
              <button className="btn btn-ghost self-start" onClick={() => makeCode.mutate()} disabled={makeCode.isPending}>
                {makeCode.isPending ? 'Đang tạo…' : 'Lấy mã liên kết'}
              </button>
            )}
            {makeCode.error && <ErrorNote message={makeCode.error.message} />}
          </div>
        )}

        {s.telegramLinked && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => { setTestMsg(null); sendTest.mutate({ channel: 'telegram' }) }} disabled={sendTest.isPending}>
              Gửi thử
            </button>
            <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
              Ngắt liên kết
            </button>
          </div>
        )}
      </section>

      <hr style={{ borderColor: 'var(--border)' }} />

      {/* ---------- Web Push ---------- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Dot on={Boolean(subscribed) && s.notifyWebPush} />
          <span className="flex-1 text-sm font-semibold">Thông báo trình duyệt</span>
          {subscribed && (
            <Switch
              checked={s.notifyWebPush}
              onChange={(v) => savePrefs.mutate({ notifyWebPush: v })}
              label="Bật thông báo trình duyệt"
            />
          )}
        </div>

        {!support.ok ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{support.reason}</p>
        ) : !s.serverWebPushReady ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Server chưa cấu hình khoá VAPID.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-ghost !py-1.5 text-xs"
              onClick={() => void togglePush(!subscribed)}
              disabled={pushBusy || subscribed === null}
            >
              {pushBusy ? 'Đang xử lý…' : subscribed ? 'Tắt trên máy này' : 'Bật trên máy này'}
            </button>
            {subscribed && (
              <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => { setTestMsg(null); sendTest.mutate({ channel: 'webpush' }) }} disabled={sendTest.isPending}>
                Gửi thử
              </button>
            )}
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {s.pushDevices} thiết bị đã đăng ký
            </span>
          </div>
        )}
        {pushError && <ErrorNote message={pushError} />}
      </section>

      {/* ---------- Push native (app điện thoại) ---------- */}
      {(isNative() || s.nativeDevices > 0) && (
        <>
          <hr style={{ borderColor: 'var(--border)' }} />
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Dot on={s.nativeDevices > 0 && s.notifyNative} />
              <span className="flex-1 text-sm font-semibold">Thông báo trên app điện thoại</span>
              {s.nativeDevices > 0 && (
                <Switch
                  checked={s.notifyNative}
                  onChange={(v) => savePrefs.mutate({ notifyNative: v })}
                  label="Bật thông báo app điện thoại"
                />
              )}
            </div>

            {!s.serverNativeReady ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {s.nativeConfigError ?? 'Server chưa cấu hình FCM_SERVICE_ACCOUNT.'}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {isNative() && (
                  <button
                    className="btn btn-ghost !py-1.5 text-xs"
                    onClick={() => void toggleNative(!nativeToken)}
                    disabled={nativeBusy}
                  >
                    {nativeBusy ? 'Đang xử lý…' : nativeToken ? 'Tắt trên máy này' : 'Bật trên máy này'}
                  </button>
                )}
                {s.nativeDevices > 0 && (
                  <button
                    className="btn btn-ghost !py-1.5 text-xs"
                    onClick={() => { setTestMsg(null); sendTest.mutate({ channel: 'native' }) }}
                    disabled={sendTest.isPending}
                  >
                    Gửi thử
                  </button>
                )}
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {s.nativeDevices} máy đã cài app
                </span>
              </div>
            )}

            {isNative() && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                App còn tự đặt lịch nhắc sẵn trên máy cho 3 ngày tới, nên vẫn kêu
                đúng giờ khi mất mạng.
              </p>
            )}
            {nativeError && <ErrorNote message={nativeError} />}
          </section>
        </>
      )}

      {testMsg && (
        <p className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--surface-2)' }}>{testMsg}</p>
      )}

      <hr style={{ borderColor: 'var(--border)' }} />

      {/* ---------- Giờ yên lặng ---------- */}
      <QuietHours
        from={s.quietFrom}
        to={s.quietTo}
        onSave={(from, to) => savePrefs.mutate({ quietFrom: from, quietTo: to })}
        saving={savePrefs.isPending}
        error={savePrefs.error?.message ?? null}
      />
    </Card>
  )
}

function QuietHours({ from, to, onSave, saving, error }: {
  from: string | null; to: string | null
  onSave: (from: string | null, to: string | null) => void
  saving: boolean; error: string | null
}) {
  const [on, setOn] = useState(Boolean(from && to))
  const [f, setF] = useState(from ?? '22:30')
  const [t, setT] = useState(to ?? '06:30')

  useEffect(() => {
    setOn(Boolean(from && to))
    if (from) setF(from)
    if (to) setT(to)
  }, [from, to])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Dot on={on} />
        <span className="flex-1 text-sm font-semibold">Giờ yên lặng</span>
        <Switch
          checked={on}
          label="Bật giờ yên lặng"
          onChange={(v) => { setOn(v); onSave(v ? f : null, v ? t : null) }}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Nhắc nhở rơi vào khoảng này sẽ không được gửi — kể cả việc đến hạn.
      </p>
      {on && (
        <div className="flex items-center gap-2">
          <input className="input-base !w-auto" type="time" value={f} onChange={(e) => setF(e.target.value)} />
          <span className="text-sm" style={{ color: 'var(--muted)' }}>đến</span>
          <input className="input-base !w-auto" type="time" value={t} onChange={(e) => setT(e.target.value)} />
          <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onSave(f, t)} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  )
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: on ? 'var(--ok)' : 'var(--muted)' }}
      aria-hidden
    />
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-10 shrink-0 rounded-full transition"
      style={{ background: checked ? 'var(--brand)' : 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
        style={{ left: checked ? 20 : 3 }}
      />
    </button>
  )
}
