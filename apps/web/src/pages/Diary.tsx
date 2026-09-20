import { useEffect, useState } from 'react'
import { Avatar, Card, ErrorNote, Spinner, StatTile } from '@/components/ui'
import { addDays, fullDate, relativeDay, today, weekdayShort } from '@/lib/format'
import { trpc } from '@/lib/trpc'

const MOODS = [
  { value: 1, icon: '😞', label: 'Tệ' },
  { value: 2, icon: '🙁', label: 'Không vui' },
  { value: 3, icon: '😐', label: 'Bình thường' },
  { value: 4, icon: '🙂', label: 'Vui' },
  { value: 5, icon: '😄', label: 'Rất vui' },
]

export default function Diary() {
  const utils = trpc.useUtils()
  const me = trpc.auth.me.useQuery()
  const [date, setDate] = useState(today())
  const [tab, setTab] = useState<'write' | 'history' | 'family'>('write')

  const day = trpc.diary.day.useQuery({ date })
  const save = trpc.diary.save.useMutation({
    onSuccess: () => {
      void utils.diary.day.invalidate()
      void utils.diary.recent.invalidate()
      setDirty(false)
    },
  })

  const [content, setContent] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)

  // nạp lại khi đổi ngày, nhưng đừng đè lên thứ người dùng đang gõ dở
  useEffect(() => {
    if (dirty) return
    setContent(day.data?.manual && 'content' in day.data.manual ? day.data.manual.content : '')
    setMood(day.data?.manual && 'mood' in day.data.manual ? (day.data.manual.mood ?? null) : null)
  }, [day.data, dirty])

  const auto = day.data?.auto
  const summary = day.data?.summary

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-3 flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
        {([['write', 'Viết'], ['history', 'Lịch sử'], ...(me.data?.role === 'PARENT' ? [['family', 'Cả nhà'] as const] : [])] as const).map(
          ([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k as typeof tab)}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold"
              style={tab === k ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {tab === 'write' && (
        <>
          <header className="mb-3 flex items-center gap-2">
            <button className="btn btn-ghost !px-3" onClick={() => { setDirty(false); setDate(addDays(date, -1)) }} aria-label="Ngày trước">‹</button>
            <div className="flex-1 text-center">
              <p className="font-bold">{relativeDay(date) ?? fullDate(date)}</p>
              {relativeDay(date) && <p className="text-xs" style={{ color: 'var(--muted)' }}>{fullDate(date)}</p>}
            </div>
            <button
              className="btn btn-ghost !px-3"
              onClick={() => { setDirty(false); setDate(addDays(date, 1)) }}
              disabled={date >= today()}
              aria-label="Ngày sau"
            >›</button>
          </header>

          {day.isLoading && <Spinner />}

          {summary && summary.due > 0 && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <StatTile label="Việc đã xong" value={`${summary.done}/${summary.due}`} />
              <StatTile label="Thời lượng" value={Math.round((summary.totalMinutes / 60) * 10) / 10} unit="giờ" />
            </div>
          )}

          {auto && (
            <Card className="mb-3 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">🤖 Tự động ghi lại</h2>
                <button
                  className="btn btn-ghost !px-2.5 !py-1 !text-xs"
                  onClick={() => {
                    setContent((c) => (c ? `${c}\n\n${auto.content}` : auto.content))
                    setDirty(true)
                  }}
                >
                  Chèn vào nhật ký
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--muted)' }}>{auto.content}</p>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">✍️ Nhật ký của bạn</h2>
            <textarea
              className="input-base min-h-48 resize-y !text-sm"
              placeholder="Hôm nay bạn đã làm gì, gặp ai, nghĩ gì…"
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true) }}
            />

            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tâm trạng</span>
              {MOODS.map((m) => (
                <button
                  key={m.value}
                  title={m.label}
                  aria-label={m.label}
                  onClick={() => { setMood(mood === m.value ? null : m.value); setDirty(true) }}
                  className="rounded-lg px-1.5 py-1 text-lg transition"
                  style={{
                    background: mood === m.value ? 'var(--brand-soft)' : 'transparent',
                    filter: mood === m.value ? 'none' : 'grayscale(1)',
                    opacity: mood === m.value ? 1 : 0.6,
                  }}
                >
                  {m.icon}
                </button>
              ))}
            </div>

            {save.error && <div className="mt-3"><ErrorNote message={save.error.message} /></div>}

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {content.length > 0 ? `${content.length} ký tự` : ''}
                {!dirty && day.data?.manual && ' · đã lưu'}
              </span>
              <button
                className="btn btn-primary"
                disabled={save.isPending || !dirty}
                onClick={() => save.mutate({ date, content, mood })}
              >
                {save.isPending ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </Card>

          <DiarySettings />
        </>
      )}

      {tab === 'history' && <History onPick={(d) => { setDirty(false); setDate(d); setTab('write') }} />}
      {tab === 'family' && <FamilyOverview />}
    </div>
  )
}

function History({ onPick }: { onPick: (date: string) => void }) {
  const recent = trpc.diary.recent.useQuery({ days: 30 })
  if (recent.isLoading) return <Spinner />
  const d = recent.data
  if (!d) return null

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <StatTile label="Chuỗi ngày viết" value={d.streak} unit="ngày" tone="ok" />
        <StatTile label="30 ngày qua" value={d.written} unit="/ 30" />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Lịch sử</h2>
        <ul className="flex flex-col">
          {d.days.map((x) => (
            <li key={x.date}>
              <button
                onClick={() => onPick(x.date)}
                className="flex w-full items-start gap-3 py-2 text-left"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <div
                  className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg"
                  style={{ background: x.preview ? 'var(--brand-soft)' : 'var(--surface-2)' }}
                >
                  <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{weekdayShort(x.date)}</span>
                  <span className="text-xs font-bold leading-none">{Number(x.date.slice(8, 10))}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {x.preview ? (
                    <p className="line-clamp-2 text-sm">{x.preview}</p>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>— chưa viết —</p>
                  )}
                </div>
                {x.mood && <span className="text-lg">{MOODS.find((m) => m.value === x.mood)?.icon}</span>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function FamilyOverview() {
  const overview = trpc.diary.familyOverview.useQuery({ days: 14 })
  if (overview.isLoading) return <Spinner />
  const d = overview.data
  if (!d) return null

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold">Cả nhà có viết không</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
        Chỉ hiện <strong>có viết hay không</strong>, không hiện nội dung. Nhật ký mà bố mẹ đọc được
        thì con sẽ viết cho bố mẹ đọc.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-xs font-semibold" style={{ color: 'var(--muted)' }}>Thành viên</th>
              {d.dates.map((x) => (
                <th key={x} className="px-0.5 py-1 text-center text-[10px] font-normal" style={{ color: 'var(--muted)' }}>
                  {Number(x.slice(8, 10))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.members.map((m) => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.name} color={m.avatarColor} size={24} />
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {m.diaryPrivate && <span title="Nhật ký riêng tư">🔒</span>}
                  </div>
                </td>
                {m.days.map((x) => (
                  <td key={x.date} className="px-0.5 py-2 text-center">
                    <span
                      className="mx-auto block h-4 w-4 rounded"
                      title={`${x.date}${x.written ? ' — đã viết' : ''}`}
                      style={{ background: x.written ? 'var(--ok)' : 'var(--surface-2)' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function DiarySettings() {
  const utils = trpc.useUtils()
  const settings = trpc.diary.settings.useQuery()
  const setPrivate = trpc.diary.setPrivate.useMutation({ onSuccess: () => void utils.diary.settings.invalidate() })
  const setDigest = trpc.diary.setDigest.useMutation({
    onSuccess: () => { void utils.diary.settings.invalidate(); void utils.notify.upcomingCount.invalidate() },
  })
  const [at, setAt] = useState('21:30')

  useEffect(() => {
    if (settings.data?.dailyDigestAt) setAt(settings.data.dailyDigestAt)
  }, [settings.data])

  if (!settings.data) return null
  const digestOn = Boolean(settings.data.dailyDigestAt)

  return (
    <Card className="mt-3 flex flex-col gap-3 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.data.diaryPrivate}
          onChange={(e) => setPrivate.mutate({ diaryPrivate: e.target.checked })}
        />
        <span className="text-sm">
          Nhật ký riêng tư
          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
            Người khác trong nhà chỉ thấy bạn có viết, không thấy nội dung. Chỉ bạn đổi được cài đặt này.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={digestOn}
          onChange={(e) => setDigest.mutate({ at: e.target.checked ? at : null })}
        />
        <span className="flex-1 text-sm">
          Tổng kết cuối ngày
          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
            Nhắc bạn hôm nay làm được gì và nhắc viết nhật ký.
          </span>
        </span>
        {digestOn && (
          <input
            className="input-base !w-auto !py-1 !text-xs"
            type="time"
            value={at}
            onChange={(e) => { setAt(e.target.value); setDigest.mutate({ at: e.target.value }) }}
          />
        )}
      </label>
    </Card>
  )
}
