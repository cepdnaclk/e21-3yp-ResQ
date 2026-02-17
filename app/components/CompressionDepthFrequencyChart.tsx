'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { mockSession } from '../data/mockSession'

const RANGES = [
  { key: 'under40', label: '<40 mm', min: -Infinity, max: 40, color: '#ef4444' },
  { key: '40to50', label: '40–50 mm', min: 40, max: 50, color: '#f59e0b' },
  { key: '50to60', label: '50–60 mm', min: 50, max: 60, color: '#22c55e' },
  { key: 'over60', label: '>60 mm', min: 60, max: Infinity, color: '#3b82f6' },
] as const

type RangeCount = { range: string; count: number; fill: string }

function getFrequencyData(): RangeCount[] {
  const compressions = mockSession.compressions
  const counts = RANGES.map(() => 0)
  for (const depth of compressions) {
    const i = RANGES.findIndex(
      (r) => depth >= r.min && (r.max === Infinity || depth < r.max)
    )
    if (i >= 0) counts[i]++
  }
  return RANGES.map((r, i) => ({
    range: r.label,
    count: counts[i],
    fill: r.color,
  }))
}

export default function CompressionDepthFrequencyChart() {
  const data = getFrequencyData()

  return (
    <div className="w-full h-[260px] sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%" minHeight={240}>
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 8 }}
          layout="vertical"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis
            type="category"
            dataKey="range"
            width={80}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={{ stroke: '#cbd5e1' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(value: number | undefined) => [
              value != null ? `${value} compressions` : '—',
              'Count',
            ]}
            labelStyle={{ color: '#0f172a' }}
            cursor={{ fill: '#f1f5f9', fillOpacity: 0.6 }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={48}>
            {data.map((entry, index) => (
              <Cell key={entry.range} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-500 mt-1 text-center">
        50–60 mm is the target zone (green)
      </p>
    </div>
  )
}
