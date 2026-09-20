import { useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Avatar, Card, Spinner, StatTile } from '@/components/ui'
import { addDays, dayMonth, minutesLabel, today } from '@/lib/format'
import { trpc } from '@/lib/trpc'

const RANGES = [
  { label: '7 ngày', days: 7 },
  { label: '30 ngày', days: 30 },
  { label: '90 ngày', days: 90 },
] as const

const PIE_COLORS = ['#4f46e5', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#7c3aed']
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }

export default function Stats() {
  const [days, setDays] = useState<number>(30)
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  const to = today()
  const from = addDays(to, -(days - 1))
  const me = trpc.auth.me.useQuery()
  const members = trpc.family.members.useQuery(undefined, { enabled: me.data?.role === 'PARENT' })
  const stats = trpc.stats.summary.useQuery({ from, to, ownerId })
  // heatmap luôn nhìn 13 tuần, độc lập với khoảng đang chọn
  const heatFrom = addDays(to, -90)
  const heat = trpc.stats.summary.useQuery({ from: heatFrom, to, ownerId })

  if (stats.isLoading) return <Spinner label="Đang tính thống kê…" />
  const d = stats.data
  if (!d) return null

  const daily = d.daily.map((x) => ({
    ...x,
    label: dayMonth(x.date),
    rate: x.due === 0 ? null : Math.round((x.done / x.due) * 100),
    hours: Math.round((x.minutes / 60) * 10) / 10,
  }))
  const categories = d.byCategory.map((c) => c.category)
  const weekly = d.weekly.map((w) => {
    const row: Record<string, number | string> = { label: dayMonth(w.week) }
    for (const c of categories) row[c] = Math.round((((w as Record<string, number | string>)[c] as number | undefined) ?? 0) / 6) / 10
    return row
  })
  const weekday = d.byWeekday.map((w) => ({ label: WEEKDAYS[w.weekday - 1], rate: w.rate ?? 0, due: w.due }))
  const worstDay = d.byWeekday.filter((w) => w.rate !== null && w.due >= 2).sort((a, b) => a.rate! - b.rate!)[0]

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-4 sm:pb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
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

      {me.data?.role === 'PARENT' && (members.data?.length ?? 0) > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <MemberChip active={!ownerId} label="Cả nhà" onClick={() => setOwnerId(undefined)} />
          {members.data!.map((m) => (
            <MemberChip
              key={m.id}
              active={ownerId === m.id}
              label={m.name}
              avatar={<Avatar name={m.name} color={m.avatarColor} size={18} />}
              onClick={() => setOwnerId(m.id)}
            />
          ))}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Hoàn thành" value={d.completionRate} unit="%" tone={d.completionRate >= 80 ? 'ok' : d.completionRate >= 50 ? 'warn' : 'brand'} />
        <StatTile label="Tổng thời lượng" value={d.totalHours} unit="giờ" />
        <StatTile label="Chuỗi ngày" value={d.streak} unit="ngày" tone="ok" />
        <StatTile label="Việc đã làm" value={d.totalDone} unit={`/${d.totalDue}`} />
      </div>

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">13 tuần gần đây</h2>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>mỗi ô một ngày · đậm = hoàn thành nhiều</span>
        </div>
        {heat.data ? <Heatmap daily={heat.data.daily} /> : <Spinner />}
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Giờ mỗi tuần theo nhóm</h2>
        {weekly.length === 0 || categories.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weekly} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v} giờ`, name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {categories.map((c, i) => (
                <Bar key={c} dataKey={c} stackId="a" fill={PIE_COLORS[i % PIE_COLORS.length]} radius={i === categories.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Thời lượng mỗi ngày</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={daily} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={Math.max(0, Math.floor(days / 10))} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} giờ`, 'Thời lượng']} />
            <Bar dataKey="hours" fill="var(--brand)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Tỉ lệ hoàn thành theo ngày</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={daily} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={Math.max(0, Math.floor(days / 6))} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Hoàn thành']} />
              <Line type="monotone" dataKey="rate" stroke="var(--ok)" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Theo thứ trong tuần</h2>
            {worstDay && worstDay.rate! < 70 && (
              <span className="text-xs" style={{ color: 'var(--warn)' }}>
                {WEEKDAYS[worstDay.weekday - 1]} hay bỏ nhất ({worstDay.rate}%)
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weekday} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Hoàn thành']} />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {weekday.map((w, i) => (
                  <Cell key={i} fill={w.rate >= 80 ? 'var(--ok)' : w.rate >= 50 ? 'var(--warn)' : 'var(--danger)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Thời lượng theo nhóm</h2>
          {d.byCategory.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={d.byCategory} dataKey="minutes" nameKey="category" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {d.byCategory.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => minutesLabel(v)} />
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    {!ownerId && r.owner && <Avatar name={r.owner.name} color={r.owner.avatarColor} size={16} />}
                    <span className="truncate font-medium">{r.title}</span>
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>
                    {r.rate}% · {minutesLabel(r.minutes)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${r.rate}%`, background: r.color }} />
                </div>
              </li>
            ))}
            {d.byRoutine.length === 0 && <Empty />}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Empty() {
  return <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>Chưa có dữ liệu</p>
}

function MemberChip({ active, label, avatar, onClick }: { active: boolean; label: string; avatar?: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition"
      style={active
        ? { background: 'var(--brand-soft)', color: 'var(--brand)', border: '1px solid transparent' }
        : { color: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      {avatar}
      {label}
    </button>
  )
}

/**
 * Lưới 13 cột (tuần) × 7 hàng (thứ), kiểu GitHub. Màu theo tỉ lệ hoàn thành;
 * ngày không có việc để trống để không bị hiểu là "bỏ".
 */
function Heatmap({ daily }: { daily: { date: string; due: number; done: number; minutes: number }[] }) {
  // căn cột đầu về thứ 2
  const first = daily[0]?.date
  if (!first) return <Empty />
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 // 0 = T2
  const cells: ({ date: string; due: number; done: number; minutes: number } | null)[] = [
    ...Array.from({ length: dow }, () => null),
    ...daily,
  ]
  const weeks: typeof cells[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const tone = (c: (typeof daily)[number]) => {
    if (c.due === 0) return 'var(--surface-2)'
    const r = c.done / c.due
    const alpha = r >= 1 ? 100 : r >= 0.75 ? 70 : r >= 0.5 ? 45 : r > 0 ? 25 : 0
    return alpha === 0
      ? 'color-mix(in srgb, var(--danger) 30%, var(--surface-2))'
      : `color-mix(in srgb, var(--ok) ${alpha}%, var(--surface-2))`
  }

  return (
    <div className="flex gap-2 overflow-x-auto">
      <div className="grid shrink-0 grid-rows-7 gap-1 text-[10px] leading-none" style={{ color: 'var(--muted)' }}>
        {WEEKDAYS.map((w) => <span key={w} className="flex h-3 items-center">{w}</span>)}
      </div>
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-rows-7 gap-1">
            {Array.from({ length: 7 }, (_, di) => {
              const c = week[di]
              if (!c) return <span key={di} className="h-3 w-3" />
              return (
                <span
                  key={di}
                  className="h-3 w-3 rounded-[3px]"
                  style={{ background: tone(c) }}
                  title={`${dayMonth(c.date)}: ${c.due === 0 ? 'không có việc' : `${c.done}/${c.due} việc · ${minutesLabel(c.minutes)}`}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
