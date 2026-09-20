import { useEffect, useMemo, useState } from 'react'
import { Avatar, Card, EmptyState, ErrorNote, Spinner, StatTile } from '@/components/ui'
import { addDays, dayMonth, today, weekdayShort } from '@/lib/format'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Tab = 'tong-quan' | 'tkb' | 'bai-tap' | 'diem'
const TABS: { id: Tab; label: string }[] = [
  { id: 'tong-quan', label: 'Tổng quan' },
  { id: 'tkb', label: 'Thời khoá biểu' },
  { id: 'bai-tap', label: 'Bài tập' },
  { id: 'diem', label: 'Điểm' },
]
const WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

export default function Study() {
  const children = trpc.study.children.useQuery()
  const [childId, setChildId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('tong-quan')

  useEffect(() => {
    if (!childId && children.data?.[0]) setChildId(children.data[0].id)
  }, [children.data, childId])

  if (children.isLoading) return <Spinner />
  const list = children.data ?? []
  if (list.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4">
        <h1 className="mb-4 text-lg font-bold">Học tập</h1>
        <EmptyState icon="🎓" title="Chưa có tài khoản con" hint="Vào Cài đặt → + Thành viên, chọn vai trò “Con” để bắt đầu theo dõi thời khoá biểu, bài tập và điểm." />
      </div>
    )
  }
  const child = list.find((c) => c.id === childId) ?? list[0]!

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Học tập</h1>
        {list.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => setChildId(c.id)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={c.id === child.id
                  ? { background: 'var(--brand-soft)', color: 'var(--brand)', border: '1px solid transparent' }
                  : { color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                <Avatar name={c.name} color={c.avatarColor} size={18} />
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
            style={tab === t.id ? { background: 'var(--surface)', color: 'var(--brand)' } : { color: 'var(--muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tong-quan' && <Dashboard childId={child.id} onGo={setTab} />}
      {tab === 'tkb' && <Schedule childId={child.id} />}
      {tab === 'bai-tap' && <Homework childId={child.id} />}
      {tab === 'diem' && <Scores childId={child.id} />}
    </div>
  )
}

// ---------- Tổng quan ----------

function Dashboard({ childId, onGo }: { childId: string; onGo: (t: Tab) => void }) {
  const d = trpc.study.dashboard.useQuery({ childId })
  const utils = trpc.useUtils()
  const toggle = trpc.study.homeworkToggle.useMutation({ onSuccess: () => void utils.study.invalidate() })
  if (d.isLoading) return <Spinner />
  const x = d.data
  if (!x) return null
  const t = today()

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Tuần này" value={x.week.completionRate} unit="%" tone={x.week.completionRate >= 80 ? 'ok' : x.week.completionRate >= 50 ? 'warn' : 'brand'} />
        <StatTile label="Bài tập chưa xong" value={x.homework.pending.length + x.homework.overdue.length} unit={x.homework.overdue.length > 0 ? `(${x.homework.overdue.length} quá hạn)` : ''} tone={x.homework.overdue.length > 0 ? 'warn' : 'ok'} />
        <StatTile label="Chuỗi ngày" value={x.week.streak} unit="ngày" tone="ok" />
        <StatTile label="Nhật ký tuần này" value={x.diary.entriesThisWeek} unit="bài" />
      </div>

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Hôm nay ở trường</h2>
          <button className="text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => onGo('tkb')}>cả tuần</button>
        </div>
        {x.todayClasses.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Không có tiết nào (hoặc chưa nhập thời khoá biểu).</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {x.todayClasses.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-sm">
                <span className="w-5 text-center text-xs font-bold" style={{ color: 'var(--muted)' }}>{c.period}</span>
                <span className="tabular-nums text-xs" style={{ color: 'var(--muted)' }}>{c.startTime}–{c.endTime}</span>
                <span className="font-medium">{c.subject}</span>
                {c.room && <span className="text-xs" style={{ color: 'var(--muted)' }}>· {c.room}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Bài tập sắp tới</h2>
          <button className="text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => onGo('bai-tap')}>tất cả</button>
        </div>
        {x.homework.overdue.length + x.homework.pending.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Không có bài tập nào đang chờ 🎉</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {[...x.homework.overdue, ...x.homework.pending].slice(0, 6).map((h) => (
              <HomeworkRow key={h.id} h={h} today={t} onToggle={(done) => toggle.mutate({ id: h.id, done })} />
            ))}
          </ul>
        )}
        {x.upcomingExams.length > 0 && (
          <div className="mt-3 rounded-xl px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}>
            <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--warn)' }}>Sắp thi</p>
            {x.upcomingExams.map((e) => (
              <p key={e.id}>{dayMonth(e.date)} · <b>{e.subject}</b> — {e.title}</p>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Điểm 90 ngày (thang 10)</h2>
          <button className="text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => onGo('diem')}>chi tiết</button>
        </div>
        {x.scores.bySubject.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Chưa có điểm nào.</p>
        ) : (
          <SubjectBars rows={x.scores.bySubject} />
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">30 ngày việc định kỳ</h2>
        <p className="mb-2 text-sm" style={{ color: 'var(--muted)' }}>
          Hoàn thành {x.month.completionRate}% · {x.month.totalHours} giờ
        </p>
        <div className="flex gap-0.5">
          {x.month.daily.map((day) => {
            const r = day.due === 0 ? null : day.done / day.due
            const bg = r === null ? 'var(--surface-2)' : r >= 1 ? 'var(--ok)' : r >= 0.5 ? 'var(--warn)' : 'var(--danger)'
            return <span key={day.date} className="h-4 flex-1 rounded-sm" style={{ background: bg, opacity: r === null ? 1 : 0.85 }} title={`${dayMonth(day.date)}: ${day.done}/${day.due}`} />
          })}
        </div>
      </Card>
    </div>
  )
}

function SubjectBars({ rows }: { rows: { subject: string; avg: number; count: number; last: number }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.subject}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">{r.subject}</span>
            <span className="tabular-nums text-xs" style={{ color: 'var(--muted)' }}>TB {r.avg} · {r.count} bài · gần nhất {r.last}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full rounded-full" style={{ width: `${r.avg * 10}%`, background: r.avg >= 8 ? 'var(--ok)' : r.avg >= 6.5 ? 'var(--warn)' : 'var(--danger)' }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- Thời khoá biểu ----------

type ClassRow = RouterOutputs['study']['schedule'][number]

function Schedule({ childId }: { childId: string }) {
  const utils = trpc.useUtils()
  const rows = trpc.study.schedule.useQuery({ childId })
  const [editing, setEditing] = useState<Partial<ClassRow> | null>(null)
  const remove = trpc.study.scheduleRemove.useMutation({ onSuccess: () => void utils.study.invalidate() })
  const todayWd = ((new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

  if (rows.isLoading) return <Spinner />
  const byDay = new Map<number, ClassRow[]>()
  for (const r of rows.data ?? []) byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), r])
  const hasSunday = (byDay.get(7)?.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-3">
      {editing && <ClassForm childId={childId} initial={editing} onDone={() => { setEditing(null); void utils.study.invalidate() }} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WEEKDAYS.slice(0, hasSunday ? 7 : 6).map((label, i) => {
          const wd = i + 1
          const items = byDay.get(wd) ?? []
          return (
            <Card key={wd} className="p-3" >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: wd === todayWd ? 'var(--brand)' : undefined }}>
                  {label}{wd === todayWd && <span className="ml-1 text-xs font-normal">· hôm nay</span>}
                </h3>
                <button className="text-xs" style={{ color: 'var(--brand)' }} onClick={() => setEditing({ weekday: wd, period: (items.at(-1)?.period ?? 0) + 1, startTime: items.at(-1)?.endTime ?? '07:00' })}>+ tiết</button>
              </div>
              {items.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Nghỉ</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {items.map((c) => (
                    <li key={c.id} className="group flex items-center gap-2 rounded-lg px-2 py-1 text-sm" style={{ background: 'var(--surface-2)' }}>
                      <span className="w-4 text-center text-xs font-bold" style={{ color: 'var(--muted)' }}>{c.period}</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(c)}>
                        <span className="font-medium">{c.subject}</span>
                        <span className="ml-1 tabular-nums text-xs" style={{ color: 'var(--muted)' }}>{c.startTime}–{c.endTime}{c.room ? ` · ${c.room}` : ''}</span>
                      </button>
                      <button className="text-xs opacity-60 hover:opacity-100" aria-label="Xoá tiết" onClick={() => remove.mutate({ id: c.id })}>✕</button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )
        })}
      </div>
      {!hasSunday && (
        <button className="self-start text-xs underline" style={{ color: 'var(--muted)' }} onClick={() => setEditing({ weekday: 7, period: 1, startTime: '07:00' })}>
          + Thêm tiết Chủ nhật
        </button>
      )}
    </div>
  )
}

function ClassForm({ childId, initial, onDone }: { childId: string; initial: Partial<ClassRow>; onDone: () => void }) {
  const [subject, setSubject] = useState(initial.subject ?? '')
  const [weekday, setWeekday] = useState(initial.weekday ?? 1)
  const [period, setPeriod] = useState(initial.period ?? 1)
  const [startTime, setStartTime] = useState(initial.startTime ?? '07:00')
  const [endTime, setEndTime] = useState(initial.endTime ?? plus45(initial.startTime ?? '07:00'))
  const [room, setRoom] = useState(initial.room ?? '')
  const [teacher, setTeacher] = useState(initial.teacher ?? '')
  const upsert = trpc.study.scheduleUpsert.useMutation({ onSuccess: onDone })

  return (
    <form
      className="card flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        upsert.mutate({ id: initial.id, childId, subject, weekday, period, startTime, endTime, room: room || null, teacher: teacher || null })
      }}
    >
      <p className="text-sm font-semibold">{initial.id ? 'Sửa tiết' : 'Thêm tiết'}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input className="input-base col-span-2" placeholder="Môn (Toán, Văn…)" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus required />
        <select className="input-base" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAYS.map((w, i) => <option key={i} value={i + 1}>{w}</option>)}
        </select>
        <input className="input-base" type="number" min={1} max={15} value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Tiết" />
        <input className="input-base" type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setEndTime(plus45(e.target.value)) }} required />
        <input className="input-base" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        <input className="input-base" placeholder="Phòng" value={room} onChange={(e) => setRoom(e.target.value)} />
        <input className="input-base" placeholder="Giáo viên" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
      </div>
      {upsert.error && <ErrorNote message={upsert.error.message} />}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={upsert.isPending || !subject.trim()}>Lưu</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Huỷ</button>
      </div>
    </form>
  )
}

function plus45(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const total = (h ?? 0) * 60 + (m ?? 0) + 45
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// ---------- Bài tập ----------

type Rec = RouterOutputs['study']['records'][number]

function HomeworkRow({ h, today: t, onToggle, onEdit }: { h: Rec; today: string; onToggle: (done: boolean) => void; onEdit?: () => void }) {
  const done = Boolean(h.doneAt)
  const overdue = !done && h.date < t
  const label = h.date === t ? 'hôm nay' : h.date === addDays(t, 1) ? 'ngày mai' : `${weekdayShort(h.date)} ${dayMonth(h.date)}`
  return (
    <li className="flex items-center gap-3 text-sm" style={{ opacity: done ? 0.6 : 1 }}>
      <button
        onClick={() => onToggle(!done)}
        aria-label={done ? 'Bỏ đánh dấu xong' : 'Đánh dấu xong'}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold text-white"
        style={done ? { background: 'var(--ok)', borderColor: 'var(--ok)' } : { borderColor: overdue ? 'var(--danger)' : 'var(--border)' }}
      >
        {done ? '✓' : ''}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onEdit} disabled={!onEdit}>
        <span className={`font-medium ${done ? 'line-through' : ''}`}>{h.title}</span>
        <span className="ml-1 text-xs" style={{ color: overdue ? 'var(--danger)' : 'var(--muted)' }}>
          {h.subject} · {overdue ? 'quá hạn ' : ''}{label}
        </span>
      </button>
    </li>
  )
}

function Homework({ childId }: { childId: string }) {
  const utils = trpc.useUtils()
  const t = today()
  const list = trpc.study.records.useQuery({ childId, kind: 'HOMEWORK', from: addDays(t, -30) })
  const [editing, setEditing] = useState<Partial<Rec> | null>(null)
  const [showDone, setShowDone] = useState(false)
  const toggle = trpc.study.homeworkToggle.useMutation({ onSuccess: () => void utils.study.invalidate() })
  const remove = trpc.study.recordRemove.useMutation({ onSuccess: () => { setEditing(null); void utils.study.invalidate() } })

  if (list.isLoading) return <Spinner />
  const all = list.data ?? []
  const open = all.filter((h) => !h.doneAt)
  const done = all.filter((h) => h.doneAt).sort((a, b) => (b.doneAt! > a.doneAt! ? 1 : -1))

  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <RecordForm childId={childId} kind="HOMEWORK" initial={editing} onDone={() => { setEditing(null); void utils.study.invalidate() }} onRemove={editing.id ? () => remove.mutate({ id: editing.id! }) : undefined} />
      ) : (
        <button className="btn btn-primary self-start" onClick={() => setEditing({ date: addDays(t, 1) })}>+ Bài tập</button>
      )}
      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">Chưa xong ({open.length})</h3>
        {open.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Không có bài nào — nghỉ đi 🎉</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((h) => <HomeworkRow key={h.id} h={h} today={t} onToggle={(d) => toggle.mutate({ id: h.id, done: d })} onEdit={() => setEditing(h)} />)}
          </ul>
        )}
      </Card>
      {done.length > 0 && (
        <Card className="p-4">
          <button className="mb-2 text-sm font-semibold" onClick={() => setShowDone((v) => !v)}>
            {showDone ? '▾' : '▸'} Đã xong ({done.length})
          </button>
          {showDone && (
            <ul className="flex flex-col gap-2">
              {done.map((h) => <HomeworkRow key={h.id} h={h} today={t} onToggle={(d) => toggle.mutate({ id: h.id, done: d })} onEdit={() => setEditing(h)} />)}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function RecordForm({ childId, kind, initial, onDone, onRemove }: {
  childId: string; kind: 'HOMEWORK' | 'EXAM' | 'SCORE'; initial: Partial<Rec>; onDone: () => void; onRemove?: () => void
}) {
  const [k, setK] = useState<'HOMEWORK' | 'EXAM' | 'SCORE'>(initial.kind as 'HOMEWORK' | 'EXAM' | 'SCORE' | undefined ?? kind)
  const [subject, setSubject] = useState(initial.subject ?? '')
  const [title, setTitle] = useState(initial.title ?? '')
  const [date, setDate] = useState(initial.date ?? today())
  const [score, setScore] = useState(initial.score?.toString() ?? '')
  const [maxScore, setMaxScore] = useState(initial.maxScore?.toString() ?? '10')
  const [note, setNote] = useState(initial.note ?? '')
  const create = trpc.study.recordCreate.useMutation({ onSuccess: onDone })
  const update = trpc.study.recordUpdate.useMutation({ onSuccess: onDone })
  const busy = create.isPending || update.isPending
  const err = create.error?.message ?? update.error?.message
  const wantsScore = k !== 'HOMEWORK'

  return (
    <form
      className="card flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const data = {
          childId, kind: k, subject: subject.trim(), title: title.trim(), date,
          score: wantsScore && score !== '' ? Number(score) : null,
          maxScore: wantsScore ? Number(maxScore) || 10 : null,
          note: note.trim() || null,
        }
        if (initial.id) update.mutate({ id: initial.id, ...data })
        else create.mutate(data)
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{initial.id ? 'Sửa' : 'Thêm'} {k === 'HOMEWORK' ? 'bài tập' : k === 'EXAM' ? 'bài thi' : 'điểm'}</p>
        {kind !== 'HOMEWORK' && (
          <select className="input-base !w-auto !py-1 text-xs" value={k} onChange={(e) => setK(e.target.value as typeof k)}>
            <option value="SCORE">Điểm thường</option>
            <option value="EXAM">Bài thi / kiểm tra</option>
          </select>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="input-base" placeholder="Môn" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus required />
        <input className="input-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label={k === 'SCORE' ? 'Ngày' : 'Hạn / ngày thi'} />
        <input className="input-base col-span-2" placeholder={k === 'HOMEWORK' ? 'Bài gì (vd: Bài 5 trang 32)' : 'Tên bài (vd: Kiểm tra 15 phút)'} value={title} onChange={(e) => setTitle(e.target.value)} required />
        {wantsScore && (
          <>
            <input className="input-base" type="number" step="0.25" min={0} placeholder={k === 'EXAM' ? 'Điểm (bỏ trống nếu chưa có)' : 'Điểm'} value={score} onChange={(e) => setScore(e.target.value)} />
            <input className="input-base" type="number" min={1} placeholder="Thang" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} aria-label="Thang điểm" />
          </>
        )}
        <input className="input-base col-span-2" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <ErrorNote message={err} />}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || !subject.trim() || !title.trim()}>Lưu</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Huỷ</button>
        {onRemove && <button type="button" className="btn btn-ghost ml-auto text-xs" style={{ color: 'var(--danger)' }} onClick={() => { if (window.confirm('Xoá mục này?')) onRemove() }}>Xoá</button>}
      </div>
    </form>
  )
}

// ---------- Điểm ----------

function Scores({ childId }: { childId: string }) {
  const utils = trpc.useUtils()
  const t = today()
  const list = trpc.study.records.useQuery({ childId, from: addDays(t, -180) })
  const dash = trpc.study.dashboard.useQuery({ childId })
  const [editing, setEditing] = useState<Partial<Rec> | null>(null)
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  const remove = trpc.study.recordRemove.useMutation({ onSuccess: () => { setEditing(null); void utils.study.invalidate() } })

  const rows = useMemo(() => (list.data ?? []).filter((r) => r.kind !== 'HOMEWORK'), [list.data])
  const subjects = useMemo(() => [...new Set(rows.map((r) => r.subject))].sort((a, b) => a.localeCompare(b, 'vi')), [rows])
  if (list.isLoading) return <Spinner />
  const shown = subjectFilter ? rows.filter((r) => r.subject === subjectFilter) : rows

  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <RecordForm childId={childId} kind="SCORE" initial={editing} onDone={() => { setEditing(null); void utils.study.invalidate() }} onRemove={editing.id ? () => remove.mutate({ id: editing.id! }) : undefined} />
      ) : (
        <button className="btn btn-primary self-start" onClick={() => setEditing({ kind: 'SCORE' })}>+ Điểm / bài thi</button>
      )}

      {dash.data && dash.data.scores.bySubject.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Trung bình 90 ngày (thang 10)</h3>
          <SubjectBars rows={dash.data.scores.bySubject} />
        </Card>
      )}

      {subjects.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!subjectFilter} onClick={() => setSubjectFilter(null)}>Tất cả</Chip>
          {subjects.map((s) => <Chip key={s} active={subjectFilter === s} onClick={() => setSubjectFilter(s)}>{s}</Chip>)}
        </div>
      )}

      <Card className="p-4">
        {shown.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Chưa có điểm nào trong 6 tháng.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((r) => {
              const v = r.score === null || r.score === undefined ? null : Math.round((r.score / (r.maxScore ?? 10)) * 100) / 10
              return (
                <li key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 tabular-nums text-xs" style={{ color: 'var(--muted)' }}>{dayMonth(r.date)}</span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
                    <span className="font-medium">{r.subject}</span>
                    <span className="ml-1 text-xs" style={{ color: 'var(--muted)' }}>{r.kind === 'EXAM' ? '🧪 ' : ''}{r.title}</span>
                  </button>
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums"
                    style={v === null
                      ? { background: 'var(--surface-2)', color: 'var(--muted)' }
                      : { background: `color-mix(in srgb, ${v >= 8 ? 'var(--ok)' : v >= 6.5 ? 'var(--warn)' : 'var(--danger)'} 18%, transparent)`, color: v >= 8 ? 'var(--ok)' : v >= 6.5 ? 'var(--warn)' : 'var(--danger)' }}
                  >
                    {v === null ? 'chưa có' : `${r.score}/${r.maxScore ?? 10}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={active ? { background: 'var(--brand-soft)', color: 'var(--brand)' } : { color: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      {children}
    </button>
  )
}

