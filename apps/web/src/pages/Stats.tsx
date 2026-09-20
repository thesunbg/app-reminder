import { useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, Spinner, StatTile } from '@/components/ui'
import { addDays, dayMonth, minutesLabel, today } from '@/lib/format'
import { trpc } from '@/lib/trpc'

const RANGES = [
  { label: '7 ngày', days: 7 },
  { label: '30 ngày', days: 30 },
  { label: '90 ngày', days: 90 },
] as const

const PIE_COLORS = ['#4f46e5', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#7c3aed']

export default function Stats() {
  const [days, setDays] = useState<number>(30)
  const to = today()
  const from = addDays(to, -(days - 1))
  const stats = trpc.stats.summary.useQuery({ from, to })

  if (stats.isLoading) return <Spinner label="Đang tính thống kê…" />
  const d = stats.data
  if (!d) return null

  const daily = d.daily.map((x) => ({
    ...x,
    label: dayMonth(x.date),
    rate: x.due === 0 ? null : Math.round((x.done / x.due) * 100),
    hours: Math.round((x.minutes / 60) * 10) / 10,
  }))

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Thống kê</h1>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className="rounded-lg px-3 py-1 text-xs font-semibold transition"
              style={days === r.days
                ? { background: 'var(--surface)', color: 'var(--brand)' }
                : { color: 'var(--muted)' }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Hoàn thành" value={d.completionRate} unit="%" tone={d.completionRate >= 80 ? 'ok' : d.completionRate >= 50 ? 'warn' : 'brand'} />
        <StatTile label="Tổng thời lượng" value={d.totalHours} unit="giờ" />
        <StatTile label="Chuỗi ngày" value={d.streak} unit="ngày" tone="ok" />
        <StatTile label="Việc đã làm" value={d.totalDone} unit={`/${d.totalDue}`} />
      </div>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Thời lượng mỗi ngày</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={daily} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={Math.max(0, Math.floor(days / 10))} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
              formatter={(v: number) => [`${v} giờ`, 'Thời lượng']}
            />
            <Bar dataKey="hours" fill="var(--brand)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Tỉ lệ hoàn thành theo ngày</h2>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={daily} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={Math.max(0, Math.floor(days / 10))} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
              formatter={(v: number) => [`${v}%`, 'Hoàn thành']}
            />
            <Line type="monotone" dataKey="rate" stroke="var(--ok)" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Thời lượng theo nhóm</h2>
          {d.byCategory.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>Chưa có dữ liệu</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={d.byCategory} dataKey="minutes" nameKey="category" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {d.byCategory.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v: number) => minutesLabel(v)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Theo từng công việc</h2>
          <ul className="flex flex-col gap-3">
            {d.byRoutine.map((r) => (
              <li key={r.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>
                    {r.rate}% · {minutesLabel(r.minutes)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${r.rate}%`, background: r.color }} />
                </div>
              </li>
            ))}
            {d.byRoutine.length === 0 && (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>Chưa có dữ liệu</p>
            )}
          </ul>
        </Card>
      </div>
    </div>
  )
}
