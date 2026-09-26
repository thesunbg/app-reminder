import { useState } from 'react'
import NotifyLog from '@/components/NotifyLog'
import NotifySettings from '@/components/NotifySettings'
import ScreenTime from '@/components/ScreenTime'
import SecuritySettings from '@/components/SecuritySettings'
import { Avatar, Card, ErrorNote, Spinner } from '@/components/ui'
import { clearLocalNotifications } from '@/lib/native'
import { trpc, type RouterOutputs } from '@/lib/trpc'

const COLORS = ['#4f46e5', '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#7c3aed', '#db2777']

export default function Settings() {
  const utils = trpc.useUtils()
  const me = trpc.auth.me.useQuery()
  const members = trpc.family.members.useQuery()
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Trên điện thoại, lịch nhắc đã nằm sẵn trong hệ điều hành và không biết
      // gì về phiên đăng nhập. Không xoá thì máy vẫn nhắc việc của người vừa
      // đăng xuất — trên máy dùng chung là người khác đọc được.
      void clearLocalNotifications()
      void utils.invalidate()
    },
  })
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
          {me.data?.isAdmin && (
            <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Đóng' : '+ Thành viên'}
            </button>
          )}
        </div>

        {adding && <AddMemberForm onDone={() => { setAdding(false); void utils.family.members.invalidate() }} />}

        <ul className="flex flex-col gap-2">
          {(members.data ?? []).map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isMe={m.id === me.data?.id}
              canManage={Boolean(me.data?.isAdmin)}
              onChanged={() => {
                void utils.family.members.invalidate()
                void utils.auth.me.invalidate()
              }}
            />
          ))}
        </ul>

        {me.data?.isAdmin === false && (
          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
            Chỉ quản trị gia đình mới thêm, sửa hoặc gỡ được tài khoản.
          </p>
        )}
      </Card>

      <NotifySettings />

      {/* Máy tính của chính mình. Báo cáo về máy của con nằm ở Học tập →
          Máy tính; ở đây để phụ huynh (nhà có thể chưa có tài khoản con nào)
          vẫn ghép được máy của mình. */}
      <Card className="mb-4 p-4">
        <h2 className="mb-3 font-semibold">Máy tính của tôi</h2>
        {me.data && <ScreenTime userId={me.data.id} canManage />}
      </Card>

      <SecuritySettings />

      <NotifyLog />
    </div>
  )
}

type Member = RouterOutputs['family']['members'][number]
type Panel = 'edit' | 'password' | 'remove' | null

function MemberRow({ member: m, isMe, canManage, onChanged }: {
  member: Member; isMe: boolean; canManage: boolean; onChanged: () => void
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p))

  const update = trpc.family.updateMember.useMutation({
    onSuccess: () => { setPanel(null); onChanged() },
  })

  return (
    <li className="flex flex-col rounded-xl px-2 py-2" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-3">
        <Avatar name={m.name} color={m.avatarColor} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {m.name}
            {isMe && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--muted)' }}>(bạn)</span>}
            {!m.active && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--danger)' }}>· đã tắt</span>}
          </p>
          <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>{m.email}</p>
        </div>
        {m.isAdmin && (
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold"
            style={{ background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }}
          >
            Quản trị
          </span>
        )}
        <span
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
        >
          {m.role === 'PARENT' ? 'Phụ huynh' : 'Con'}
        </span>
      </div>

      {canManage && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
          <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => toggle('edit')}>
            {panel === 'edit' ? 'Đóng' : 'Sửa'}
          </button>
          <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => toggle('password')}>
            Đặt lại mật khẩu
          </button>
          {!isMe && (
            <>
              <button
                className="btn btn-ghost !px-2 !py-1 text-xs"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: m.id, active: !m.active })}
              >
                {m.active ? 'Tắt tài khoản' : 'Bật lại'}
              </button>
              <button
                className="btn btn-ghost !px-2 !py-1 text-xs"
                style={{ color: 'var(--danger)' }}
                onClick={() => toggle('remove')}
              >
                Gỡ
              </button>
            </>
          )}
        </div>
      )}

      {update.error && <div className="pl-11 pt-2"><ErrorNote message={update.error.message} /></div>}

      {panel === 'edit' && <EditMemberForm member={m} isMe={isMe} onDone={onChanged} />}
      {panel === 'password' && <ResetPasswordForm member={m} onDone={() => setPanel(null)} />}
      {panel === 'remove' && <RemoveMemberForm member={m} onDone={onChanged} />}
    </li>
  )
}

function EditMemberForm({ member: m, isMe, onDone }: { member: Member; isMe: boolean; onDone: () => void }) {
  const [name, setName] = useState(m.name)
  const [email, setEmail] = useState(m.email)
  const [role, setRole] = useState<'PARENT' | 'CHILD'>(m.role as 'PARENT' | 'CHILD')
  const [birthday, setBirthday] = useState(m.birthday ?? '')
  const [avatarColor, setAvatarColor] = useState(m.avatarColor)

  const update = trpc.family.updateMember.useMutation({ onSuccess: onDone })
  const emailChanged = email.trim().toLowerCase() !== m.email

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface)' }}>
      <div className="grid grid-cols-2 gap-2">
        <input className="input-base" placeholder="Tên" value={name} onChange={(e) => setName(e.target.value)} />
        <select
          className="input-base"
          value={role}
          disabled={isMe}
          onChange={(e) => setRole(e.target.value as 'PARENT' | 'CHILD')}
        >
          <option value="CHILD">Con</option>
          <option value="PARENT">Phụ huynh</option>
        </select>
      </div>
      <input className="input-base" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {emailChanged && (
        <p className="text-xs" style={{ color: 'var(--warn)' }}>
          Đổi email sẽ đăng xuất người này khỏi mọi thiết bị.
        </p>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ngày sinh</span>
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
      {update.error && <ErrorNote message={update.error.message} />}
      <button
        className="btn btn-primary"
        disabled={update.isPending || !name.trim() || !email.trim()}
        onClick={() =>
          update.mutate({
            id: m.id,
            name: name.trim(),
            email: email.trim(),
            role,
            birthday: birthday || null,
            avatarColor,
          })
        }
      >
        {update.isPending ? 'Đang lưu…' : 'Lưu'}
      </button>
    </div>
  )
}

function ResetPasswordForm({ member: m, onDone }: { member: Member; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const reset = trpc.family.resetMemberPassword.useMutation({ onSuccess: onDone })

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface)' }}>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Đặt mật khẩu mới cho {m.name}. Người này sẽ bị đăng xuất khỏi mọi thiết bị và phải đăng nhập lại.
      </p>
      <input
        className="input-base"
        type="password"
        placeholder="Mật khẩu mới (tối thiểu 8 ký tự)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {reset.error && <ErrorNote message={reset.error.message} />}
      <button
        className="btn btn-primary"
        disabled={reset.isPending || password.length < 8}
        onClick={() => reset.mutate({ id: m.id, password })}
      >
        {reset.isPending ? 'Đang đặt lại…' : 'Đặt lại mật khẩu'}
      </button>
    </div>
  )
}

/**
 * Xoá hẳn: hiện đúng số bản ghi sẽ mất rồi mới cho gõ tên xác nhận. Dữ liệu
 * gia đình chỉ có backup hằng đêm, nên đừng để ai bấm nhầm.
 */
function RemoveMemberForm({ member: m, onDone }: { member: Member; onDone: () => void }) {
  const [confirmName, setConfirmName] = useState('')
  const data = trpc.family.memberData.useQuery({ id: m.id })
  const remove = trpc.family.removeMember.useMutation({ onSuccess: onDone })

  const counts = data.data
  const rows: Array<[string, number]> = counts
    ? ([
        ['việc định kỳ', counts.routines],
        ['lượt tick việc', counts.taskLogs],
        ['ghi chú', counts.notes],
        ['mục nhật ký', counts.diaryEntries],
        ['bản ghi học tập', counts.studyRecords],
        ['báo cáo máy tính', counts.screenReports],
      ] as Array<[string, number]>).filter(([, n]) => n > 0)
    : []

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-xl p-3"
      style={{ background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>Gỡ hẳn {m.name}?</p>
      {data.isLoading ? (
        <Spinner />
      ) : (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {rows.length === 0
            ? 'Tài khoản này chưa có dữ liệu nào. Xoá xong không khôi phục được.'
            : `Sẽ mất luôn: ${rows.map(([label, n]) => `${n} ${label}`).join(', ')}. Không khôi phục được (trừ khi restore backup).`}
        </p>
      )}
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Muốn giữ dữ liệu thì dùng “Tắt tài khoản”: người này không đăng nhập được nữa nhưng nhật ký, ghi chú và lịch sử vẫn còn.
      </p>
      <input
        className="input-base"
        placeholder={`Gõ đúng “${m.name}” để xác nhận`}
        value={confirmName}
        onChange={(e) => setConfirmName(e.target.value)}
      />
      {remove.error && <ErrorNote message={remove.error.message} />}
      <button
        className="btn"
        style={{ background: 'var(--danger)', color: '#fff' }}
        disabled={remove.isPending || confirmName.trim() !== m.name}
        onClick={() => remove.mutate({ id: m.id, confirmName: confirmName.trim() })}
      >
        {remove.isPending ? 'Đang gỡ…' : 'Gỡ hẳn tài khoản'}
      </button>
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
