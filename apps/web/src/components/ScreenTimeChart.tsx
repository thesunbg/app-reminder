/**
 * Cột "mỗi ngày dùng máy bao lâu". Tách file riêng để recharts (~430 kB) chỉ
 * được tải khi thực sự mở tab Máy tính — giống cách trang Thống kê đang làm.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dayMonth, minutesLabel, weekdayShort } from '@/lib/format'

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 12,
}

export default function ScreenTimeChart({ byDay }: { byDay: Array<{ date: string; minutes: number }> }) {
  // Trục giờ dễ đọc hơn phút khi mỗi ngày vài tiếng; giữ một chữ số thập phân
  // để ngày dùng 20 phút không bị làm tròn thành 0 rồi trông như không dùng.
  const data = byDay.map((d) => ({
    label: `${weekdayShort(d.date)} ${dayMonth(d.date)}`,
    hours: Math.round((d.minutes / 60) * 10) / 10,
    minutes: d.minutes,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          interval={Math.max(0, Math.floor(data.length / 8))}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(_v: number, _n: string, item: { payload?: { minutes: number } }) => [
            minutesLabel(item.payload?.minutes ?? 0),
            'Dùng máy',
          ]}
        />
        <Bar dataKey="hours" fill="var(--brand)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
