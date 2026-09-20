import { useEffect, useRef, useState } from 'react'
import { ErrorNote } from '@/components/ui'
import { addDays, today } from '@/lib/format'
import { COLOR_LABEL, NOTE_COLORS, noteBackground, type NoteColor } from '@/lib/noteColors'
import { trpc } from '@/lib/trpc'

export type EditableNote = {
  id?: string
  title: string
  body: string
  kind: 'TEXT' | 'CHECKLIST'
  color: string
  labels: string[]
  shared: boolean
  remindDate?: string | null
  remindAtTime: string
  remindBeforeDays: number[]
  recurIntervalDays?: number | null
  items: Array<{ id?: string; text: string; checked: boolean }>
}

export const emptyNote = (): EditableNote => ({
  title: '', body: '', kind: 'TEXT', color: 'default', labels: [], shared: false,
  remindDate: null, remindAtTime: '08:00', remindBeforeDays: [1, 0],
  recurIntervalDays: null, items: [],
})

const RECUR_PRESETS = [
  { label: 'không lặp', days: null },
  { label: '1 tháng', days: 30 },
  { label: '3 tháng', days: 90 },
  { label: '6 tháng', days: 180 },
  { label: '1 năm', days: 365 },
]

export default function NoteEditor({
  initial, onClose, onSaved,
}: {
  initial: EditableNote
  onClose: () => void
  onSaved: () => void
}) {
  const [note, setNote] = useState<EditableNote>(initial)
  const [labelDraft, setLabelDraft] = useState('')
  const [showRemind, setShowRemind] = useState(Boolean(initial.remindDate))
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const create = trpc.note.create.useMutation({ onSuccess: onSaved })
  const update = trpc.note.update.useMutation({ onSuccess: onSaved })
  const busy = create.isPending || update.isPending
  const error = create.error?.message ?? update.error?.message

  const set = <K extends keyof EditableNote>(k: K, v: EditableNote[K]) =>
    setNote((n) => ({ ...n, [k]: v }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function save() {
    const payload = {
      title: note.title.trim(),
      body: note.kind === 'TEXT' ? note.body : '',
      kind: note.kind,
      color: note.color as NoteColor,
      labels: note.labels,
      shared: note.shared,
      remindDate: showRemind ? note.remindDate || today() : null,
      remindAtTime: note.remindAtTime,
      remindBeforeDays: note.remindBeforeDays,
      recurIntervalDays: showRemind ? note.recurIntervalDays ?? null : null,
      items: note.kind === 'CHECKLIST' ? note.items.filter((i) => i.text.trim()) : [],
    }
    if (note.id) update.mutate({ id: note.id, ...payload })
    else create.mutate(payload)
  }

  function toChecklist() {
    const lines = note.body.split('\n').map((l) => l.trim()).filter(Boolean)
    setNote((n) => ({
      ...n,
      kind: 'CHECKLIST',
      items: n.items.length ? n.items : lines.map((text) => ({ text, checked: false })),
    }))
  }

  function toText() {
    setNote((n) => ({
      ...n,
      kind: 'TEXT',
      body: n.body || n.items.map((i) => i.text).join('\n'),
    }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(0,0,0,.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border p-4 shadow-2xl"
        style={{ background: noteBackground(note.color), borderColor: 'var(--border)' }}
      >
        <input
          className="w-full bg-transparent text-base font-semibold outline-none"
          placeholder="Tiêu đề"
          value={note.title}
          onChange={(e) => set('title', e.target.value)}
        />

        {note.kind === 'TEXT' ? (
          <textarea
            ref={bodyRef}
            className="mt-2 max-h-72 min-h-24 w-full resize-y bg-transparent text-sm outline-none"
            placeholder="Nội dung ghi chú…"
            value={note.body}
            onChange={(e) => set('body', e.target.value)}
          />
        ) : (
          <Checklist items={note.items} onChange={(items) => set('items', items)} />
        )}

        {note.labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {note.labels.map((l) => (
              <span
                key={l}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                style={{ background: 'color-mix(in srgb, var(--text) 10%, transparent)' }}
              >
                {l}
                <button
                  onClick={() => set('labels', note.labels.filter((x) => x !== l))}
                  aria-label={`Bỏ nhãn ${l}`}
                  className="opacity-60"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            className="btn btn-ghost !px-2.5 !py-1.5 !text-xs"
            onClick={() => (note.kind === 'TEXT' ? toChecklist() : toText())}
          >
            {note.kind === 'TEXT' ? '☑ Chuyển thành danh sách' : '≡ Chuyển thành văn bản'}
          </button>
          <button
            className="btn btn-ghost !px-2.5 !py-1.5 !text-xs"
            onClick={() => setShowRemind((v) => !v)}
          >
            {showRemind ? '🔔 Bỏ nhắc' : '🔔 Đặt nhắc'}
          </button>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={note.shared} onChange={(e) => set('shared', e.target.checked)} />
            <span>Chia sẻ cả nhà</span>
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            className="input-base !py-1.5 !text-xs"
            placeholder="Thêm nhãn rồi Enter…"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const v = labelDraft.trim()
              if (v && !note.labels.includes(v)) set('labels', [...note.labels, v])
              setLabelDraft('')
            }}
          />
        </div>

        {showRemind && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--text) 6%, transparent)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input-base !w-auto !py-1.5 !text-xs"
                type="date"
                value={note.remindDate ?? today()}
                onChange={(e) => set('remindDate', e.target.value)}
              />
              <input
                className="input-base !w-auto !py-1.5 !text-xs"
                type="time"
                value={note.remindAtTime}
                onChange={(e) => set('remindAtTime', e.target.value)}
              />
              <div className="flex gap-1">
                {[['Mai', 1], ['Tuần sau', 7], ['Tháng sau', 30]].map(([label, d]) => (
                  <button
                    key={label as string}
                    className="rounded-lg border px-2 py-1 text-xs"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => set('remindDate', addDays(today(), d as number))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span style={{ opacity: 0.7 }}>Lặp lại:</span>
              {RECUR_PRESETS.map((p) => {
                const on = (note.recurIntervalDays ?? null) === p.days
                return (
                  <button
                    key={p.label}
                    onClick={() => set('recurIntervalDays', p.days)}
                    className="rounded-lg border px-2 py-1 font-semibold"
                    style={on
                      ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
                      : { borderColor: 'var(--border)', opacity: 0.75 }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            {note.recurIntervalDays && (
              <p className="text-xs" style={{ opacity: 0.7 }}>
                Đánh dấu xong sẽ tự tạo ghi chú mới cho lần tới.
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => set('color', c)}
              title={COLOR_LABEL[c]}
              aria-label={COLOR_LABEL[c]}
              className="h-6 w-6 rounded-full border"
              style={{
                background: noteBackground(c),
                borderColor: note.color === c ? 'var(--text)' : 'var(--border)',
                borderWidth: note.color === c ? 2 : 1,
              }}
            />
          ))}
        </div>

        {error && <div className="mt-3"><ErrorNote message={error} /></div>}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Checklist({
  items, onChange,
}: {
  items: EditableNote['items']
  onChange: (items: EditableNote['items']) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="mt-2 flex flex-col gap-1">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={it.checked}
            onChange={(e) => onChange(items.map((x, i) => (i === idx ? { ...x, checked: e.target.checked } : x)))}
          />
          <input
            className={`flex-1 bg-transparent text-sm outline-none ${it.checked ? 'line-through opacity-60' : ''}`}
            value={it.text}
            onChange={(e) => onChange(items.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && it.text === '') {
                e.preventDefault()
                onChange(items.filter((_, i) => i !== idx))
              }
            }}
          />
          <button
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            aria-label="Xoá dòng"
            className="text-sm opacity-50"
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="opacity-50">+</span>
        <input
          className="flex-1 bg-transparent text-sm outline-none"
          placeholder="Thêm mục…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const v = draft.trim()
            if (v) onChange([...items, { text: v, checked: false }])
            setDraft('')
          }}
        />
      </div>
    </div>
  )
}
