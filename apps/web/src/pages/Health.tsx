/**
 * Sổ sức khoẻ gia đình.
 *
 * Bốn thứ nhà nào cũng phải nhớ mà không ai nhớ nổi: con cao cân bao nhiêu hồi
 * tháng trước, đã tiêm mũi nào, hẹn tái khám ngày nào, đang uống thuốc gì.
 */
import { lazy, Suspense, useState } from 'react'
import { Avatar, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui'
import { fullDate, today } from '@/lib/format'
import { trpc, type RouterOutputs } from '@/lib/trpc'

const GrowthChart = lazy(() => import('@/components/GrowthChart'))

type Kind = 'GROWTH' | 'VACCINE' | 'CHECKUP' | 'MEDICINE'
type Record_ = RouterOutputs['health']['list']['records'][number]

const KIND_META: Record<Kind, { label: string; icon: string; color: string; placeholder: string }> = {
  GROWTH: { label: 'Chiều cao / cân nặng', icon: '📏', color: '#0891b2', placeholder: '' },
  VACCINE: { label: 'Tiêm chủng', icon: '💉', color: '#16a34a', placeholder: 'Sởi – quai bị – rubella mũi 2' },
  CHECKUP: { label: 'Khám', icon: '🩺', color: '#7c3aed', placeholder: 'Khám răng định kỳ' },
  MEDICINE: { label: 'Thuốc', icon: '💊', color: '#f59e0b', placeholder: 'Siro ho, 5ml × 2 lần/ngày' },
}

const KINDS: Kind[] = ['GROWTH', 'VACCINE', 'CHECKUP', 'MEDICINE']

export default function Health() {
  const utils = trpc.useUtils()
  const people = trpc.health.people.useQuery()
  const [userId, setUserId] = useState<string | null>(null)
  const who = userId ?? people.data?.[0]?.id ?? null
  const [adding, setAdding] = useState<Kind | null>(null)

  const list = trpc.health.list.useQuery({ userId: who! }, { enabled: Boolean(who) })
  const remove = trpc.health.remove.useMutation({ onSuccess: () => void utils.health.list.invalidate() })

  if (people.isLoading) return <Spinner />
  const person = people.data?.find((p) => p.id === who)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <h1 className="mb-3 text-lg font-bold">Sổ sức khoẻ</h1>

      {(people.data?.length ?? 0) > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {people.data!.map((p) => (
            <button
              key={p.id}
              onClick={() => setUserId(p.id)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={p.id === who ? { background: 'var(--brand-soft)', color: 'var(--brand)' } : { background: 'var(--surface-2)', color: 'var(--muted)' }}
            >
              <Avatar name={p.name} color={p.avatarColor} size={18} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {list.isLoading && <Spinner />}

      {list.data && (
        <>
          {list.data.upcoming.length > 0 && (
            <Card className="mb-4 p-4">
              <h2 className="mb-2 text-sm font-semibold">Hẹn sắp tới</h2>
              <ul className="flex flex-col gap-2">
                {list.data.upcoming.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 text-sm">
                    <span>{KIND_META[u.kind as Kind].icon}</span>
                    <span className="min-w-0 flex-1 truncate">{u.title || KIND_META[u.kind as Kind].label}</span>
                    <span
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold"
                      style={
                        u.daysUntil <= 7
                          ? { background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }
                          : { color: 'var(--muted)' }
                      }
                    >
                      {u.daysUntil === 0 ? 'Hôm nay' : u.daysUntil === 1 ? 'Ngày mai' : `Còn ${u.daysUntil} ngày`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                Nhắc trước 7 ngày, 1 ngày và đúng sáng hôm đó. Hồ sơ của con thì nhắc bố mẹ.
              </p>
            </Card>
          )}

          {list.data.growth.length > 0 && (
            <Card className="mb-4 p-4">
              <h2 className="mb-1 text-sm font-semibold">📏 Chiều cao & cân nặng</h2>
              <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
                Đây là số đo của nhà mình theo thời gian — <b>không có đường chuẩn WHO</b>.
                Muốn biết con nằm ở phân vị nào thì hỏi bác sĩ; app không đoán hộ.
              </p>
              <Suspense fallback={<Spinner />}>
                <GrowthChart rows={list.data.growth} />
              </Suspense>
              <Latest rows={list.data.growth} />
            </Card>
          )}

          <div className="mb-3 flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                className="btn btn-ghost !py-1.5 text-xs"
                onClick={() => setAdding((cur) => (cur === k ? null : k))}
                style={adding === k ? { color: 'var(--brand)', borderColor: 'var(--brand)' } : undefined}
              >
                + {KIND_META[k].icon} {KIND_META[k].label}
              </button>
            ))}
          </div>

          {adding && who && (
            <RecordForm
              key={adding}
              kind={adding}
              userId={who}
              onDone={() => {
                setAdding(null)
                void utils.health.list.invalidate()
              }}
            />
          )}

          {KINDS.filter((k) => k !== 'GROWTH').map((k) => {
            const rows = list.data!.records.filter((r) => r.kind === k)
            if (rows.length === 0) return null
            return (
              <Card key={k} className="mb-3 p-4">
                <h2 className="mb-2 text-sm font-semibold">
                  {KIND_META[k].icon} {KIND_META[k].label} <span style={{ color: 'var(--muted)' }}>({rows.length})</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {rows.map((r) => (
                    <RecordRow key={r.id} record={r} onRemove={() => remove.mutate({ id: r.id })} />
                  ))}
                </ul>
              </Card>
            )
          })}

          {list.data.records.length === 0 && !adding && (
            <EmptyState
              icon="🩺"
              title={`Sổ của ${person?.name ?? 'người này'} còn trống`}
              hint="Ghi số đo chiều cao cân nặng mỗi tháng, mũi tiêm đã tiêm, lịch tái khám — app sẽ nhắc trước ngày hẹn."
            />
          )}
        </>
      )}
    </div>
  )
}

/** Số đo gần nhất + thay đổi so với lần trước — cái người ta thật sự muốn biết. */
function Latest({ rows }: { rows: RouterOutputs['health']['list']['growth'] }) {
  const last = rows.at(-1)
  const prev = rows.at(-2)
  if (!last) return null
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null ? Math.round((a - b) * 10) / 10 : null
  const dh = delta(last.heightCm, prev?.heightCm)
  const dw = delta(last.weightKg, prev?.weightKg)

  return (
    <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
      Gần nhất {fullDate(last.date)}:{' '}
      {last.heightCm != null && <b>{last.heightCm} cm{dh !== null && dh !== 0 && ` (${dh > 0 ? '+' : ''}${dh})`}</b>}
      {last.heightCm != null && last.weightKg != null && ' · '}
      {last.weightKg != null && <b>{last.weightKg} kg{dw !== null && dw !== 0 && ` (${dw > 0 ? '+' : ''}${dw})`}</b>}
      {last.bmi != null && ` · BMI ${last.bmi}`}
    </p>
  )
}

function RecordRow({ record, onRemove }: { record: Record_; onRemove: () => void }) {
  const meta = KIND_META[record.kind as Kind]
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-1 h-3 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{record.title}</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {[
            fullDate(record.date),
            record.nextDate ? `hẹn lại ${fullDate(record.nextDate)}` : null,
            record.note,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <button
        className="btn btn-ghost !px-2 !py-1 text-xs"
        onClick={() => {
          if (confirm(`Xoá "${record.title}" khỏi sổ sức khoẻ?`)) onRemove()
        }}
      >
        Xoá
      </button>
    </li>
  )
}

function RecordForm({ kind, userId, onDone }: { kind: Kind; userId: string; onDone: () => void }) {
  const [date, setDate] = useState(today())
  const [title, setTitle] = useState('')
  const [heightCm, setHeight] = useState('')
  const [weightKg, setWeight] = useState('')
  const [note, setNote] = useState('')
  const [nextDate, setNext] = useState('')

  const create = trpc.health.create.useMutation({ onSuccess: onDone })
  const meta = KIND_META[kind]
  const isGrowth = kind === 'GROWTH'
  const valid = isGrowth ? Boolean(heightCm || weightKg) : title.trim().length > 0

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <p className="text-sm font-semibold">{meta.icon} {meta.label}</p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ngày</span>
        <input className="input-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      {isGrowth ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Chiều cao (cm)</span>
            <input className="input-base" inputMode="decimal" value={heightCm} onChange={(e) => setHeight(e.target.value)} placeholder="138.5" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Cân nặng (kg)</span>
            <input className="input-base" inputMode="decimal" value={weightKg} onChange={(e) => setWeight(e.target.value)} placeholder="32.4" />
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tên</span>
          <input className="input-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={meta.placeholder} />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Hẹn lần sau (tuỳ chọn) — app sẽ nhắc trước 7 ngày
        </span>
        <input className="input-base" type="date" value={nextDate} onChange={(e) => setNext(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ghi chú</span>
        <textarea className="input-base" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {create.error && <ErrorNote message={create.error.message} />}

      <button
        className="btn btn-primary"
        disabled={!valid || create.isPending}
        onClick={() =>
          create.mutate({
            userId, kind, date,
            title: title.trim(),
            heightCm: heightCm ? Number(heightCm) : null,
            weightKg: weightKg ? Number(weightKg) : null,
            note: note.trim() || null,
            nextDate: nextDate || null,
          })
        }
      >
        {create.isPending ? 'Đang lưu…' : 'Lưu'}
      </button>
    </Card>
  )
}
