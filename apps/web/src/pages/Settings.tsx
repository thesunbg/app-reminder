import { useState } from 'react'
import NotifyLog from '@/components/NotifyLog'
import NotifySettings from '@/components/NotifySettings'
import { Avatar, Card, ErrorNote, Spinner } from '@/components/ui'
import { trpc } from '@/lib/trpc'

const COLORS = ['#4f46e5', '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#7c3aed', '#db2777']

export default function Settings() {
  const utils = trpc.useUtils()
  const me = trpc.auth.me.useQuery()
  const members = trpc.family.members.useQuery()
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { void utils.invalidate() } })
  const [adding, setAdding] = useState(false)

  if (me.isLoading) return <Spinner />

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <h1 className="mb-4 text-lg font-bold">Cài đặt</h1>

      <Card className="mb-4 flex items-center gap-3 p-4">
        <Avatar name={me.data?.name ?? '?'} color={me.data?.avatarColor ?? '#4f46e5'} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{me.data?.name}</p>
          <p className="truncate text-sm" style={{ color: 'var(--muted)' }}>{me.data?.email}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Đăng xuất
        </button>
      </Card>

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Gia đình {me.data?.familyName}</h2>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{members.data?.length ?? 0} thành viên</p>
          </div>
          {me.data?.role === 'PARENT' && (
            <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Đóng' : '+ Thành viên'}
            </button>
          )}
        </div>

        {adding && <AddMemberForm onDone={() => { setAdding(false); void utils.family.members.invalidate() }} />}

        <ul className="flex flex-col gap-2">
          {(members.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2" style={{ background: 'var(--surface-2)' }}>
              <Avatar name={m.name} color={m.avatarColor} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {m.name}
                  {m.id === me.data?.id && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--muted)' }}>(bạn)</span>}
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{m.email}</p>
              </div>
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
              >
                {m.role === 'PARENT' ? 'Phụ huynh' : 'Con'}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <NotifySettings />

      <NotifyLog />
    </div>
  )
}

function AddMemberForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'PARENT' | 'CHILD'>('CHILD')
  const [avatarColor, setAvatarColor] = useState(COLORS[3]!)
  const [birthday, setBirthday] = useState('')

  const add = trpc.family.addMember.useMutation({ onSuccess: onDone })

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="grid grid-cols-2 gap-2">
        <input className="input-base" placeholder="Tên" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input-base" value={role} onChange={(e) => setRole(e.target.value as 'PARENT' | 'CHILD')}>
          <option value="CHILD">Con</option>
          <option value="PARENT">Phụ huynh</option>
        </select>
      </div>
      <input className="input-base" type="email" placeholder="Email đăng nhập" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input-base" type="password" placeholder="Mật khẩu (tối thiểu 8 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ngày sinh (để nhắc sinh nhật)</span>
        <input className="input-base" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </label>
      <div className="flex gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setAvatarColor(c)}
            aria-label={`Chọn màu ${c}`}
            className="h-7 w-7 rounded-full"
            style={{ background: c, outline: avatarColor === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }}
          />
        ))}
      </div>
      {add.error && <ErrorNote message={add.error.message} />}
      <button
        className="btn btn-primary"
        disabled={add.isPending || !name.trim() || !email.trim() || password.length < 8}
        onClick={() => add.mutate({ name: name.trim(), email: email.trim(), password, role, avatarColor, birthday: birthday || null })}
      >
        {add.isPending ? 'Đang tạo…' : 'Tạo tài khoản'}
      </button>
    </div>
  )
}
