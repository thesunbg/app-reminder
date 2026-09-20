import { useEffect, useRef, useState } from 'react'
import { ErrorNote } from '@/components/ui'
import { dayMonth } from '@/lib/format'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Parsed = RouterOutputs['assistant']['parse']
type Action = Parsed['actions'][number]

/** Web Speech API chỉ có trên Chrome/Safari/Edge; Firefox không có. */
type SpeechRecognitionCtor = new () => {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
function speechCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Nút mic nổi ở mọi màn hình. Bấm → nói (hoặc gõ) → xem trước hành động →
 * xác nhận. Không có API key trên server thì không hiện nút.
 */
export default function AssistantButton() {
  const status = trpc.assistant.status.useQuery(undefined, { staleTime: Infinity })
  const [open, setOpen] = useState(false)
  if (!status.data?.enabled) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Nhập bằng giọng nói"
        className="fixed bottom-20 right-4 z-30 flex h-13 w-13 items-center justify-center rounded-full text-2xl shadow-lg transition hover:scale-105 sm:bottom-6 sm:right-6"
        style={{ background: 'var(--brand)', color: 'white', width: 52, height: 52 }}
      >
        🎙
      </button>
      {open && <AssistantSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function AssistantSheet({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils()
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [result, setResult] = useState<RouterOutputs['assistant']['run'] | null>(null)
  const [speechError, setSpeechError] = useState<string | null>(null)
  const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null)
  const supported = Boolean(speechCtor())

  const parse = trpc.assistant.parse.useMutation({ onSuccess: (d) => { setParsed(d); setResult(null) } })
  const run = trpc.assistant.run.useMutation({
    onSuccess: (d) => { setResult(d); setParsed(null); void utils.invalidate() },
  })

  useEffect(() => () => recRef.current?.abort(), [])

  function toggleMic() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const Ctor = speechCtor()
    if (!Ctor) return
    setSpeechError(null)
    const rec = new Ctor()
    rec.lang = 'vi-VN'
    rec.interimResults = true
    rec.continuous = false
    let finalText = ''
    rec.onresult = (e) => {
      let tmp = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!
        if (r.isFinal) finalText += r[0]!.transcript
        else tmp += r[0]!.transcript
      }
      setInterim(tmp)
      if (finalText) setText((t) => (t ? `${t} ${finalText}` : finalText).trim())
    }
    rec.onerror = (e) => {
      setSpeechError(e.error === 'not-allowed' ? 'Trình duyệt chưa cho phép dùng micro' : `Không nghe được (${e.error})`)
    }
    rec.onend = () => { setListening(false); setInterim('') }
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  const busy = parse.isPending || run.isPending

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.45)' }} />
      <div
        className="card relative flex w-full max-w-lg flex-col gap-3 rounded-b-none p-4 sm:rounded-b-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Trợ lý nhập liệu"
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold">🎙 Nói hoặc gõ một câu</p>
          <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={onClose}>Đóng</button>
        </div>

        {!parsed && !result && (
          <>
            <textarea
              className="input-base min-h-20 resize-none"
              placeholder='Vd: "Nhắc tôi thay dầu xe ngày 15 tháng sau, trước 3 ngày báo tôi" · "Giỗ ông nội 12 tháng 8 âm" · "Bé Su có bài tập Toán bài 5 trang 32 mai nộp"'
              value={interim ? `${text} ${interim}`.trim() : text}
              onChange={(e) => setText(e.target.value)}
              autoFocus={!supported}
            />
            <div className="flex gap-2">
              {supported && (
                <button
                  type="button"
                  className="btn flex-1"
                  style={listening ? { background: 'var(--danger)', color: 'white' } : { background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  onClick={toggleMic}
                >
                  {listening ? '● Đang nghe… bấm để dừng' : '🎙 Bấm để nói'}
                </button>
              )}
              <button className="btn btn-primary flex-1" disabled={busy || !text.trim()} onClick={() => parse.mutate({ text })}>
                {parse.isPending ? 'Đang hiểu…' : 'Xem trước'}
              </button>
            </div>
            {speechError && <ErrorNote message={speechError} />}
            {parse.error && <ErrorNote message={parse.error.message} />}
            {!supported && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Trình duyệt này không có nhận dạng giọng nói — gõ tay vẫn dùng được.</p>
            )}
          </>
        )}

        {parsed && (
          <>
            {parsed.reply && <p className="text-sm">{parsed.reply}</p>}
            {parsed.actions.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Không có hành động nào để thực hiện.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {parsed.actions.map((a, i) => <ActionCard key={i} a={a} onRemove={() => setParsed({ ...parsed, actions: parsed.actions.filter((_, j) => j !== i) })} />)}
              </ul>
            )}
            {run.error && <ErrorNote message={run.error.message} />}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setParsed(null)}>← Sửa câu</button>
              {parsed.actions.length > 0 && (
                <button className="btn btn-primary flex-1" disabled={busy} onClick={() => run.mutate({ actions: parsed.actions })}>
                  {run.isPending ? 'Đang lưu…' : `Thực hiện ${parsed.actions.length} việc`}
                </button>
              )}
            </div>
          </>
        )}

        {result && (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {result.done.map((d, i) => <li key={`d${i}`}>✅ {d.label}</li>)}
              {result.failed.map((f, i) => <li key={`f${i}`} style={{ color: 'var(--danger)' }}>❌ {label(f.type)}: {f.error}</li>)}
            </ul>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => { setResult(null); setText('') }}>Nói câu khác</button>
              <button className="btn btn-primary flex-1" onClick={onClose}>Xong</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function label(t: Action['type']): string {
  return {
    create_routine: 'Việc định kỳ', create_event: 'Sự kiện', create_note: 'Ghi chú', add_diary: 'Nhật ký',
    mark_routine: 'Đánh dấu việc', add_homework: 'Bài tập', add_score: 'Điểm',
  }[t]
}

const REPEAT_VI: Record<string, string> = { daily: 'hàng ngày', weekdays: 'thứ 2–6', weekend: 'cuối tuần' }
const DAY_VI: Record<string, string> = { MO: 'T2', TU: 'T3', WE: 'T4', TH: 'T5', FR: 'T6', SA: 'T7', SU: 'CN' }

function describe(a: Action): string {
  switch (a.type) {
    case 'create_routine': {
      const rep = REPEAT_VI[a.repeat] ?? a.repeat.replace(/^weekly:/i, '').split(',').map((d) => DAY_VI[d.trim().toUpperCase()] ?? d).join(', ')
      return `${a.title} · ${a.timeOfDay} · ${a.durationMin} phút · ${rep}${a.category ? ` · ${a.category}` : ''}`
    }
    case 'create_event':
      return a.calendar === 'LUNAR'
        ? `${a.title} · ${a.lunarDay}/${a.lunarMonth} âm lịch · nhắc trước ${a.remindBeforeDays.join('/')} ngày`
        : `${a.title} · ${a.solarDate}${a.yearly ? ' hàng năm' : ''} · nhắc trước ${a.remindBeforeDays.join('/')} ngày`
    case 'create_note':
      return [
        a.title || a.body.slice(0, 60),
        a.items?.length ? `${a.items.length} mục` : null,
        a.remindDate ? `hạn ${dayMonth(a.remindDate)}${a.remindBeforeDays ? ` (nhắc trước ${a.remindBeforeDays.join('/')} ngày)` : ''}` : null,
        a.recurIntervalDays ? `lặp mỗi ${a.recurIntervalDays} ngày` : null,
        a.shared ? 'cả nhà thấy' : null,
      ].filter(Boolean).join(' · ')
    case 'add_diary':
      return `${dayMonth(a.date)}${a.mood ? ` · tâm trạng ${a.mood}/5` : ''} · ${a.content.slice(0, 80)}`
    case 'mark_routine':
      return `${dayMonth(a.date)} · ${a.status === 'DONE' ? 'xong' : a.status === 'PARTIAL' ? 'làm dở' : 'bỏ qua'}`
    case 'add_homework':
      return `${a.subject} · ${a.title} · nộp ${dayMonth(a.date)}`
    case 'add_score':
      return `${a.subject} · ${a.title} · ${a.score === null ? 'chưa có điểm' : `${a.score}/${a.maxScore}`} · ${dayMonth(a.date)}`
  }
}

function ActionCard({ a, onRemove }: { a: Action; onRemove: () => void }) {
  return (
    <li className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>{label(a.type)}</p>
        <p className="text-sm">{describe(a)}</p>
      </div>
      <button className="text-xs opacity-60 hover:opacity-100" aria-label="Bỏ hành động này" onClick={onRemove}>✕</button>
    </li>
  )
}
