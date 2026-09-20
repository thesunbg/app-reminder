import { useState } from 'react'
import { EmptyState, Spinner } from '@/components/ui'
import { addDays, dayMonth, today, weekdayShort } from '@/lib/format'
import { trpc } from '@/lib/trpc'

export default function Week() {
  const [anchor, setAnchor] = useState(today())
  const utils = trpc.useUtils()
  const week = trpc.routine.week.useQuery({ date: anchor })
  const mark = trpc.routine.mark.useMutation({
    onSuccess: () => {
      void utils.routine.week.invalidate()
      void utils.routine.day.invalidate()
      void utils.stats.summary.invalidate()
    },
  })

  const rows = week.data?.rows ?? []

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:pb-8">
      <header className="mb-4 flex items-center gap-2">
        <button className="btn btn-ghost !px-3" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Tuần trước">‹</button>
        <p className="flex-1 text-center font-bold">
          {week.data ? `${dayMonth(week.data.from)} – ${dayMonth(week.data.to)}` : 'Tuần'}
        </p>
        <button className="btn btn-ghost !px-3" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Tuần sau">›</button>
      </header>

      {week.isLoading && <Spinner />}
      {!week.isLoading && rows.length === 0 && (
        <EmptyState icon="📅" title="Chưa có công việc định kỳ" hint="Thêm ở tab Quản lý." />
      )}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 px-3 py-2 text-left text-xs font-semibold" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                  Công việc
                </th>
                {week.data && Array.from({ length: 7 }, (_, i) => addDays(week.data!.from, i)).map((d) => (
                  <th key={d} className="px-1 py-2 text-center text-xs font-semibold" style={{ color: d === today() ? 'var(--brand)' : 'var(--muted)' }}>
                    <div>{weekdayShort(d)}</div>
                    <div className="font-normal tabular-nums">{dayMonth(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ routine, days }) => (
                <tr key={routine.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="sticky left-0 z-10 max-w-[180px] px-3 py-2" style={{ background: 'var(--surface)' }}>
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: routine.color }} />
                      <span className="truncate font-medium">{routine.title}</span>
                    </div>
                  </td>
                  {days.map((cell) => (
                    <td key={cell.date} className="px-1 py-2 text-center">
                      {cell.due ? (
                        <button
                          onClick={() => mark.mutate({ routineId: routine.id, date: cell.date, status: 'DONE' })}
                          disabled={mark.isPending}
                          aria-label={`${routine.title} ngày ${cell.date}`}
                          className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold text-white"
                          style={
                            cell.log?.status === 'DONE'
                              ? { background: 'var(--ok)', borderColor: 'var(--ok)' }
                              : cell.log?.status === 'PARTIAL'
                                ? { background: 'var(--warn)', borderColor: 'var(--warn)' }
                                : cell.log?.status === 'SKIPPED'
                                  ? { background: 'var(--muted)', borderColor: 'var(--muted)' }
                                  : { borderColor: 'var(--border)', background: 'transparent' }
                          }
                        >
                          {cell.log?.status === 'DONE' ? '✓' : cell.log?.status === 'PARTIAL' ? '½' : cell.log?.status === 'SKIPPED' ? '–' : ''}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--border)' }}>·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
