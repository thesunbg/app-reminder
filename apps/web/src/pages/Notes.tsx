import { useState } from 'react'
import NoteEditor, { emptyNote, type EditableNote } from '@/components/NoteEditor'
import { Avatar, EmptyState, Spinner } from '@/components/ui'
import { fullDate, relativeDay, today } from '@/lib/format'
import { noteBackground } from '@/lib/noteColors'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type View = 'active' | 'reminders' | 'archived'

export default function Notes() {
  const utils = trpc.useUtils()
  const me = trpc.auth.me.useQuery()
  const [view, setView] = useState<View>('active')
  const [label, setLabel] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<EditableNote | null>(null)

  const list = trpc.note.list.useQuery({
    archived: view === 'archived',
    label,
    search: search.trim() || undefined,
    withReminder: view === 'reminders' || undefined,
  })
  const labels = trpc.note.labels.useQuery()

  const refresh = () => {
    void utils.note.list.invalidate()
    void utils.note.labels.invalidate()
    void utils.notify.upcomingCount.invalidate()
  }

  const setPinned = trpc.note.setPinned.useMutation({ onSuccess: refresh })
  const setArchived = trpc.note.setArchived.useMutation({ onSuccess: refresh })
  const remove = trpc.note.remove.useMutation({ onSuccess: refresh })
  const toggleItem = trpc.note.toggleItem.useMutation({ onSuccess: refresh })
  const complete = trpc.note.complete.useMutation({
    onSuccess: (r) => {
      refresh()
      if (r.nextDate) alert(`Đã xong. Lần tới: ${fullDate(r.nextDate)}`)
    },
  })

  const notes = list.data ?? []
  const pinned = notes.filter((n) => n.pinned)
  const rest = notes.filter((n) => !n.pinned)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input-base !w-auto flex-1"
          placeholder="Tìm trong ghi chú…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn-primary" onClick={() => setEditing(emptyNote())}>
          + Ghi chú
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {([['active', 'Ghi chú'], ['reminders', 'Có hạn'], ['archived', 'Lưu trữ']] as const).map(
          ([v, labelText]) => (
            <button
              key={v}
              onClick={() => { setView(v); setLabel(undefined) }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={view === v
                ? { background: 'var(--brand-soft)', color: 'var(--brand)' }
                : { color: 'var(--muted)' }}
            >
              {labelText}
            </button>
          ),
        )}
        {(labels.data ?? []).length > 0 && <span className="mx-1" style={{ color: 'var(--border)' }}>|</span>}
        {(labels.data ?? []).map((l) => (
          <button
            key={l.label}
            onClick={() => setLabel(label === l.label ? undefined : l.label)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
            style={label === l.label
              ? { background: 'var(--brand)', color: '#fff' }
              : { background: 'var(--surface-2)', color: 'var(--muted)' }}
          >
            {l.label} <span style={{ opacity: 0.6 }}>{l.count}</span>
          </button>
        ))}
      </div>

      {list.isLoading && <Spinner />}

      {!list.isLoading && notes.length === 0 && (
        <EmptyState
          icon="📝"
          title={search ? 'Không tìm thấy ghi chú nào' : view === 'archived' ? 'Chưa lưu trữ ghi chú nào' : 'Chưa có ghi chú'}
          hint={search ? undefined : 'Ghi chú tự do, danh sách việc, hoặc gắn hạn kiểu “thay dầu xe ngày 20/10”.'}
        />
      )}

      {pinned.length > 0 && (
        <>
          <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--muted)' }}>ĐÃ GHIM</p>
          <Grid>
            {pinned.map((n) => (
              <NoteCard key={n.id} note={n} meId={me.data?.id} onEdit={setEditing}
                onPin={setPinned.mutate} onArchive={setArchived.mutate}
                onRemove={remove.mutate} onToggleItem={toggleItem.mutate} onComplete={complete.mutate} />
            ))}
          </Grid>
          {rest.length > 0 && (
            <p className="mb-2 mt-4 text-xs font-semibold" style={{ color: 'var(--muted)' }}>KHÁC</p>
          )}
        </>
      )}

      <Grid>
        {rest.map((n) => (
          <NoteCard key={n.id} note={n} meId={me.data?.id} onEdit={setEditing}
            onPin={setPinned.mutate} onArchive={setArchived.mutate}
            onRemove={remove.mutate} onToggleItem={toggleItem.mutate} onComplete={complete.mutate} />
        ))}
      </Grid>

      {editing && (
        <NoteEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}

/** Masonry bằng CSS columns — ghi chú cao thấp khác nhau vẫn xếp khít. */
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">{children}</div>
}

type NoteRow = RouterOutputs['note']['list'][number]

function NoteCard({
  note, meId, onEdit, onPin, onArchive, onRemove, onToggleItem, onComplete,
}: {
  note: NoteRow
  meId?: string
  onEdit: (n: EditableNote) => void
  onPin: (v: { id: string; pinned: boolean }) => void
  onArchive: (v: { id: string; archived: boolean }) => void
  onRemove: (v: { id: string }) => void
  onToggleItem: (v: { itemId: string; checked: boolean }) => void
  onComplete: (v: { id: string }) => void
}) {
  const mine = note.ownerId === meId
  const checked = note.items.filter((i) => i.checked)
  const unchecked = note.items.filter((i) => !i.checked)
  const overdue = note.remindDate != null && note.remindDate < today()

  const toEditable = (): EditableNote => ({
    id: note.id,
    title: note.title,
    body: note.body,
    kind: note.kind,
    color: note.color,
    labels: note.labels,
    shared: note.shared,
    remindDate: note.remindDate,
    remindAtTime: note.remindAtTime,
    remindBeforeDays: note.remindBeforeDays,
    recurIntervalDays: note.recurIntervalDays,
    items: note.items.map((i) => ({ id: i.id, text: i.text, checked: i.checked })),
  })

  return (
    <div
      className="group rounded-2xl border p-3 transition"
      style={{ background: noteBackground(note.color), borderColor: 'var(--border)' }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => mine && onEdit(toEditable())}>
          {note.title && <p className="mb-1 font-semibold leading-snug">{note.title}</p>}

          {note.kind === 'TEXT'
            ? note.body && <p className="whitespace-pre-wrap text-sm leading-snug opacity-90">{note.body}</p>
            : (
              <ul className="flex flex-col gap-0.5 text-sm">
                {unchecked.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex items-start gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onToggleItem({ itemId: i.id, checked: true })}
                      className="mt-0.5"
                    />
                    <span>{i.text}</span>
                  </li>
                ))}
                {checked.length > 0 && (
                  <li className="mt-1 text-xs opacity-60">✓ {checked.length} mục đã xong</li>
                )}
              </ul>
            )}
        </div>
        {mine && (
          <button
            onClick={() => onPin({ id: note.id, pinned: !note.pinned })}
            aria-label={note.pinned ? 'Bỏ ghim' : 'Ghim'}
            className="shrink-0 text-sm"
            style={{ opacity: note.pinned ? 1 : 0.35 }}
          >
            📌
          </button>
        )}
      </div>

      {(note.labels.length > 0 || note.remindDate || note.shared) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {note.remindDate && (
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={overdue
                ? { background: 'color-mix(in srgb, var(--danger) 20%, transparent)', color: 'var(--danger)' }
                : { background: 'color-mix(in srgb, var(--text) 10%, transparent)' }}
            >
              🔔 {relativeDay(note.remindDate) ?? fullDate(note.remindDate).replace(/^\w+, /, '')}
              {note.recurIntervalDays && ' ↻'}
            </span>
          )}
          {note.shared && (
            <span className="rounded-full px-2 py-0.5" style={{ background: 'color-mix(in srgb, var(--text) 10%, transparent)' }}>
              👪 cả nhà
            </span>
          )}
          {note.labels.map((l) => (
            <span key={l} className="rounded-full px-2 py-0.5" style={{ background: 'color-mix(in srgb, var(--text) 10%, transparent)' }}>
              {l}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {!mine && <Avatar name={note.owner.name} color={note.owner.avatarColor} size={20} />}
        {mine && (
          <>
            {note.remindDate && !note.archived && (
              <IconBtn title="Đánh dấu xong" onClick={() => onComplete({ id: note.id })}>✓</IconBtn>
            )}
            <IconBtn
              title={note.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
              onClick={() => onArchive({ id: note.id, archived: !note.archived })}
            >
              {note.archived ? '↩' : '🗄'}
            </IconBtn>
            <IconBtn
              title="Xoá"
              onClick={() => { if (confirm('Xoá ghi chú này?')) onRemove({ id: note.id }) }}
            >
              🗑
            </IconBtn>
          </>
        )}
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-xs"
      style={{ background: 'color-mix(in srgb, var(--text) 8%, transparent)' }}
    >
      {children}
    </button>
  )
}
