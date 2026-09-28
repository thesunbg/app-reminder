/**
 * Tìm kiếm toàn cục.
 *
 * Sau một năm dùng thật, "hôm nọ ghi ở đâu ấy" là câu hỏi thường xuyên hơn mọi
 * biểu đồ. Gõ không dấu vẫn ra: server bỏ dấu cả hai vế.
 */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, EmptyState, Spinner } from '@/components/ui'
import { fullDate } from '@/lib/format'
import { trpc, type RouterOutputs } from '@/lib/trpc'

type Hit = RouterOutputs['search']['all']['hits'][number]

const KIND_META: Record<Hit['kind'], { label: string; icon: string; color: string }> = {
  note: { label: 'Ghi chú', icon: '📝', color: '#0891b2' },
  diary: { label: 'Nhật ký', icon: '✍', color: '#7c3aed' },
  study: { label: 'Học tập', icon: '🎓', color: '#f59e0b' },
  event: { label: 'Sự kiện', icon: '🕯', color: '#db2777' },
  routine: { label: 'Việc định kỳ', icon: '✓', color: '#16a34a' },
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [text, setText] = useState(initial)
  const [q, setQ] = useState(initial)

  // gõ xong mới tìm: mỗi phím một truy vấn thì server quét bảng liên tục
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim())
      setParams(text.trim() ? { q: text.trim() } : {}, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [text, setParams])

  const search = trpc.search.all.useQuery({ q }, { enabled: q.length >= 2 })
  const hits = search.data?.hits ?? []

  const groups = KIND_ORDER.map((kind) => ({ kind, rows: hits.filter((h) => h.kind === kind) })).filter(
    (g) => g.rows.length > 0,
  )

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:pb-8">
      <h1 className="mb-3 text-lg font-bold">Tìm kiếm</h1>

      <input
        className="input-base mb-4"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Gõ không dấu cũng được: gio ong noi, thay dau xe…"
        autoFocus
        aria-label="Từ khoá"
      />

      {q.length >= 2 && search.isLoading && <Spinner />}

      {q.length >= 2 && !search.isLoading && hits.length === 0 && (
        <EmptyState icon="🔍" title={`Không thấy gì cho "${q}"`} hint="Thử một từ ngắn hơn, hoặc một phần của tên." />
      )}

      {q.length < 2 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Tìm trong ghi chú, nhật ký, bài tập, sự kiện và việc định kỳ. Nhật ký
          riêng tư của người khác không nằm trong kết quả.
        </p>
      )}

      {groups.map(({ kind, rows }) => {
        const meta = KIND_META[kind]
        return (
          <Card key={kind} className="mb-3 p-4">
            <h2 className="mb-2 text-sm font-semibold">
              {meta.icon} {meta.label} <span style={{ color: 'var(--muted)' }}>({rows.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map((h) => (
                <li key={`${h.kind}-${h.id}`}>
                  <Link to={h.url} className="flex gap-2">
                    <span className="mt-1 h-3 w-1 shrink-0 rounded-full" style={{ background: meta.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title}</span>
                      {h.snippet && (
                        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                          {h.snippet}
                        </span>
                      )}
                      <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                        {[h.owner, h.date ? fullDate(h.date) : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}

const KIND_ORDER: Hit['kind'][] = ['note', 'diary', 'study', 'event', 'routine']
