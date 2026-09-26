import { useEffect, useMemo, useState } from 'react'
import ScreenTime from '@/components/ScreenTime'
import { Avatar, Card, EmptyState, ErrorNote, Spinner, StatTile } from '@/components/ui'
import { addDays, dayMonth, today, weekdayShort } from '@/lib/format'
import { prepareImage, type PreparedImage } from '@/lib/image'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Tab = 'tong-quan' | 'tkb' | 'bai-tap' | 'diem' | 'may-tinh'
const TABS: { id: Tab; label: string }[] = [
  { id: 'tong-quan', label: 'Tổng quan' },
  { id: 'tkb', label: 'Thời khoá biểu' },
  { id: 'bai-tap', label: 'Bài tập' },
  { id: 'diem', label: 'Điểm' },
  { id: 'may-tinh', label: 'Máy tính' },
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
        {/* Hiện cả khi mới có một con: thời khoá biểu, bài tập và điểm đều theo
            TỪNG con, nên phải thấy rõ mình đang xem của ai. */}
        {list.length > 0 && (
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
      {tab === 'tkb' && <Schedule childId={child.id} childName={child.name} />}
      {tab === 'bai-tap' && <Homework childId={child.id} />}
      {tab === 'diem' && <Scores childId={child.id} />}
      {tab === 'may-tinh' && <ScreenTime userId={child.id} canManage />}
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
              <p key={e.id}>{e.date ? dayMonth(e.date) : '—'} · <b>{e.subject ?? 'Chưa phân môn'}</b> — {e.title}</p>
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

/** Nhãn thứ cho câu hỏi xác nhận: WEEKDAYS[0] là Thứ 2. */
const weekdayName = (wd: number) => WEEKDAYS[wd - 1] ?? `thứ ${wd}`

function Schedule({ childId, childName }: { childId: string; childName: string }) {
  const utils = trpc.useUtils()
  const rows = trpc.study.schedule.useQuery({ childId })
  const [editing, setEditing] = useState<Partial<ClassRow> | null>(null)
  const remove = trpc.study.scheduleRemove.useMutation({ onSuccess: () => void utils.study.invalidate() })
  const todayWd = ((new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

  if (rows.isLoading) return <Spinner />
  const byDay = new Map<number, ClassRow[]>()
  for (const r of rows.data ?? []) byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), r])
  const hasSunday = (byDay.get(7)?.length ?? 0) > 0

  const total = rows.data?.length ?? 0

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Thời khoá biểu của <b style={{ color: 'var(--text)' }}>{childName}</b>
        {total > 0 ? ` · ${total} tiết/tuần` : ' · chưa có tiết nào'}
      </p>
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
                      <button
                        className="text-xs opacity-60 hover:opacity-100"
                        aria-label={`Xoá tiết ${c.subject}`}
                        onClick={() => {
                          const when = `${weekdayName(c.weekday)}, tiết ${c.period} (${c.startTime}–${c.endTime})`
                          if (window.confirm(`Xoá tiết ${c.subject} — ${when} khỏi thời khoá biểu của ${childName}?`)) {
                            remove.mutate({ id: c.id })
                          }
                        }}
                      >
                        ✕
                      </button>
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

/** Nhãn hạn nộp; bài không có hạn thì nói thẳng là chưa đặt hạn. */
function dueLabel(date: string | null, t: string): string {
  if (!date) return 'chưa đặt hạn'
  if (date === t) return 'hôm nay'
  if (date === addDays(t, 1)) return 'ngày mai'
  return `${weekdayShort(date)} ${dayMonth(date)}`
}

type HomeworkLike = Omit<Rec, 'attachments'> & { attachments?: Rec['attachments'] }

function HomeworkRow({ h, today: t, onToggle, onEdit }: { h: HomeworkLike; today: string; onToggle: (done: boolean) => void; onEdit?: () => void }) {
  const done = Boolean(h.doneAt)
  const overdue = !done && Boolean(h.date) && h.date! < t
  const meta = [h.subject, `${overdue ? 'quá hạn ' : ''}${dueLabel(h.date, t)}`].filter(Boolean).join(' · ')
  const images = h.attachments ?? []
  return (
    <li className="flex items-start gap-3 text-sm" style={{ opacity: done ? 0.6 : 1 }}>
      <button
        onClick={() => onToggle(!done)}
        aria-label={done ? 'Bỏ đánh dấu xong' : 'Đánh dấu xong'}
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold text-white"
        style={done ? { background: 'var(--ok)', borderColor: 'var(--ok)' } : { borderColor: overdue ? 'var(--danger)' : 'var(--border)' }}
      >
        {done ? '✓' : ''}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onEdit} disabled={!onEdit}>
        {/* nội dung giờ là ô nhiều dòng — giữ nguyên xuống dòng con đã gõ */}
        <span className={`block whitespace-pre-wrap font-medium ${done ? 'line-through' : ''}`}>{h.title}</span>
        <span className="text-xs" style={{ color: overdue ? 'var(--danger)' : 'var(--muted)' }}>
          {meta}
          {images.length > 0 && ` · ${images.length} ảnh`}
        </span>
        {images.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {images.map((a) => (
              <img
                key={a.id}
                src={`/study/anh/${a.id}`}
                alt="Ảnh bài tập"
                loading="lazy"
                className="h-16 w-16 rounded-lg object-cover"
                style={{ background: 'var(--surface-2)' }}
              />
            ))}
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * Chọn / chụp ảnh đề bài. Trên điện thoại, `capture="environment"` mở thẳng
 * camera sau — con giơ máy chụp cái bảng là xong, không phải qua thư viện ảnh.
 */
function AttachmentPicker({ recordId, existing, queued, onQueue, onUnqueue, onError, onChanged }: {
  recordId: string | null
  existing: Rec['attachments']
  queued: PreparedImage[]
  onQueue: (im: PreparedImage) => void
  onUnqueue: (index: number) => void
  onError: (msg: string | null) => void
  onChanged: () => void
}) {
  const [working, setWorking] = useState(false)
  const addAttachment = trpc.study.attachmentAdd.useMutation()
  const removeAttachment = trpc.study.attachmentRemove.useMutation({ onSuccess: onChanged })

  async function pick(files: FileList | null) {
    if (!files?.length) return
    onError(null)
    setWorking(true)
    try {
      for (const file of Array.from(files)) {
        const im = await prepareImage(file)
        if (im.size > 3 * 1024 * 1024) {
          onError('Ảnh vẫn quá lớn sau khi nén — thử chụp lại gần hơn')
          continue
        }
        // bài đã có id thì gửi luôn; chưa có thì xếp hàng, lưu xong sẽ gửi
        if (recordId) {
          await addAttachment.mutateAsync({
            recordId, mime: im.mime, data: im.data, width: im.width, height: im.height,
          })
          onChanged()
        } else {
          onQueue(im)
        }
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Không xử lý được ảnh')
    } finally {
      setWorking(false)
    }
  }

  const total = existing.length + queued.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-ghost !py-1.5 text-xs" style={{ cursor: 'pointer' }}>
          {working ? 'Đang xử lý ảnh…' : '📷 Thêm ảnh'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={working || total >= 6}
            onChange={(e) => {
              void pick(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {total > 0 ? `${total}/6 ảnh` : 'Chụp đề bài trên bảng cũng được'}
        </span>
      </div>

      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          {existing.map((a) => (
            <div key={a.id} className="relative">
              <img
                src={`/study/anh/${a.id}`}
                alt="Ảnh bài tập"
                className="h-20 w-20 rounded-lg object-cover"
                style={{ background: 'var(--surface-2)' }}
              />
              <button
                type="button"
                aria-label="Xoá ảnh"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: 'var(--danger)' }}
                disabled={removeAttachment.isPending}
                onClick={() => {
                  // ảnh đã lưu thì xoá là mất hẳn, không như ảnh đang chờ gửi
                  if (window.confirm('Xoá ảnh này? Không lấy lại được.')) removeAttachment.mutate({ id: a.id })
                }}
              >
                ×
              </button>
            </div>
          ))}
          {queued.map((im, i) => (
            <div key={`q${i}`} className="relative">
              <img src={im.previewUrl} alt="Ảnh sắp thêm" className="h-20 w-20 rounded-lg object-cover opacity-70" />
              <button
                type="button"
                aria-label="Bỏ ảnh này"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: 'var(--danger)' }}
                onClick={() => onUnqueue(i)}
              >
                ×
              </button>
              <span
                className="absolute bottom-0 left-0 right-0 rounded-b-lg text-center text-[10px] text-white"
                style={{ background: 'rgba(0,0,0,.55)' }}
              >
                lưu xong sẽ gửi
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
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
        <button className="btn btn-primary self-start" onClick={() => setEditing({ kind: 'HOMEWORK' })}>+ Bài tập</button>
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
  const utils = trpc.useUtils()
  const [k, setK] = useState<'HOMEWORK' | 'EXAM' | 'SCORE'>(initial.kind as 'HOMEWORK' | 'EXAM' | 'SCORE' | undefined ?? kind)
  const [subject, setSubject] = useState(initial.subject ?? '')
  /// id của bài đang sửa; null khi thêm mới (ảnh phải chờ lưu xong mới gắn được)
  const saved = initial.id ?? null
  const [title, setTitle] = useState(initial.title ?? '')
  // bài tập mới để trống hạn: con ghi nhanh rồi đặt hạn sau nếu cần
  const [date, setDate] = useState(initial.date ?? (initial.kind === 'HOMEWORK' || kind === 'HOMEWORK' ? '' : today()))
  const [score, setScore] = useState(initial.score?.toString() ?? '')
  const [maxScore, setMaxScore] = useState(initial.maxScore?.toString() ?? '10')
  const [note, setNote] = useState(initial.note ?? '')
  // Ảnh chỉ gắn được vào bài đã có id. Khi thêm mới thì giữ tạm ở đây rồi
  // upload ngay sau khi lưu xong — con không phải bấm lưu hai lần.
  const [queued, setQueued] = useState<PreparedImage[]>([])
  const [imgError, setImgError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const addAttachment = trpc.study.attachmentAdd.useMutation()

  async function uploadAll(recordId: string, images: PreparedImage[]) {
    for (const im of images) {
      await addAttachment.mutateAsync({
        recordId,
        mime: im.mime,
        data: im.data,
        width: im.width,
        height: im.height,
      })
    }
  }

  const create = trpc.study.recordCreate.useMutation({
    onSuccess: async (rec) => {
      if (queued.length > 0) {
        setUploading(true)
        try {
          await uploadAll(rec.id, queued)
        } finally {
          setUploading(false)
        }
      }
      onDone()
    },
  })
  const update = trpc.study.recordUpdate.useMutation({ onSuccess: onDone })
  const busy = create.isPending || update.isPending || uploading
  const err = create.error?.message ?? update.error?.message ?? addAttachment.error?.message ?? imgError
  const wantsScore = k !== 'HOMEWORK'

  return (
    <form
      className="card flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const data = {
          childId, kind: k, subject: subject.trim() || null, title: title.trim(), date: date || null,
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
        {/* bài tập: nội dung là thứ bắt buộc duy nhất, nên để nó lên đầu */}
        {k === 'HOMEWORK' ? (
          <textarea
            className="input-base col-span-2 min-h-24"
            placeholder="Nội dung bài tập — chép đề vào đây cũng được"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
          />
        ) : (
          <input
            className="input-base col-span-2"
            placeholder="Tên bài (vd: Kiểm tra 15 phút)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
          />
        )}
        <input
          className="input-base"
          placeholder={k === 'HOMEWORK' ? 'Môn (không bắt buộc)' : 'Môn'}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required={k !== 'HOMEWORK'}
        />
        <input
          className="input-base"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required={k !== 'HOMEWORK'}
          aria-label={k === 'SCORE' ? 'Ngày' : 'Hạn / ngày thi'}
        />
        {k === 'HOMEWORK' && (
          <p className="col-span-2 -mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            {date
              ? 'Có hạn thì app nhắc 19:00 tối hôm trước và 07:00 sáng hôm nộp.'
              : 'Không đặt hạn cũng được — khi đó app không nhắc, bài chỉ nằm trong danh sách chưa xong.'}
          </p>
        )}
        {wantsScore && (
          <>
            <input className="input-base" type="number" step="0.25" min={0} placeholder={k === 'EXAM' ? 'Điểm (bỏ trống nếu chưa có)' : 'Điểm'} value={score} onChange={(e) => setScore(e.target.value)} />
            <input className="input-base" type="number" min={1} placeholder="Thang" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} aria-label="Thang điểm" />
          </>
        )}
        <input className="input-base col-span-2" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {k === 'HOMEWORK' && (
        <AttachmentPicker
          recordId={saved}
          existing={(initial as Rec).attachments ?? []}
          queued={queued}
          onQueue={(im) => setQueued((q) => [...q, im])}
          onUnqueue={(i) => setQueued((q) => q.filter((_, idx) => idx !== i))}
          onError={setImgError}
          onChanged={() => void utils.study.invalidate()}
        />
      )}

      {err && <ErrorNote message={err} />}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || !title.trim() || (k !== 'HOMEWORK' && (!subject.trim() || !date))}
        >
          Lưu
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Huỷ</button>
        {onRemove && (
          <button
            type="button"
            className="btn btn-ghost ml-auto text-xs"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              const what = k === 'HOMEWORK' ? 'bài tập' : k === 'EXAM' ? 'bài thi' : 'điểm'
              // nội dung bài tập có thể dài mấy dòng — cắt cho câu hỏi gọn
              const name = title.trim().length > 60 ? `${title.trim().slice(0, 57)}…` : title.trim()
              const imgs = (initial as Rec).attachments?.length ?? 0
              const extra = imgs > 0 ? `\n${imgs} ảnh đính kèm cũng bị xoá theo.` : ''
              if (window.confirm(`Xoá ${what} “${name}”?${extra}\nKhông khôi phục được.`)) onRemove()
            }}
          >
            Xoá
          </button>
        )}
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
  const subjects = useMemo(
    () => [...new Set(rows.map((r) => r.subject).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, 'vi')),
    [rows],
  )
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
                  <span className="w-12 shrink-0 tabular-nums text-xs" style={{ color: 'var(--muted)' }}>{r.date ? dayMonth(r.date) : '—'}</span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
                    <span className="font-medium">{r.subject ?? 'Chưa phân môn'}</span>
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

