/**
 * Chiều cao và cân nặng theo thời gian. Tách file riêng để recharts (~430 kB)
 * chỉ được tải khi mở sổ sức khoẻ — giống ScreenTimeChart và trang Thống kê.
 *
 * Hai trục riêng vì cm và kg khác thang hẳn nhau: vẽ chung một trục thì đường
 * cân nặng bẹt xuống đáy và chẳng đọc được gì.
 */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dayMonth } from '@/lib/format'

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 12,
}

type Row = { date: string; heightCm: number | null; weightKg: number | null; bmi: number | null }

export default function GrowthChart({ rows }: { rows: Row[] }) {
  const data = rows.map((r) => ({
    label: `${dayMonth(r.date)}/${r.date.slice(2, 4)}`,
    heightCm: r.heightCm,
    weightKg: r.weightKg,
  }))

  // một điểm thì không có đường nào để vẽ; nói thẳng thay vì hiện khung rỗng
  if (data.length < 2) {
    return (
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Có thêm ít nhất hai lần đo thì mới vẽ được đường thay đổi.
      </p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          interval={Math.max(0, Math.floor(data.length / 6))}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="h"
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          tickLine={false}
          axisLine={false}
          domain={['dataMin - 5', 'dataMax + 5']}
        />
        <YAxis
          yAxisId="w"
          orientation="right"
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          tickLine={false}
          axisLine={false}
          domain={['dataMin - 3', 'dataMax + 3']}
        />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="h"
          type="monotone"
          dataKey="heightCm"
          name="Chiều cao (cm)"
          stroke="#0891b2"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
        <Line
          yAxisId="w"
          type="monotone"
          dataKey="weightKg"
          name="Cân nặng (kg)"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
