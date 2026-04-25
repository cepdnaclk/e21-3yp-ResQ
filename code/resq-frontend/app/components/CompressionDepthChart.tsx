'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import { mockSession } from '../data/mockSession'

const TARGET_MIN = 50
const TARGET_MAX = 60

type ChartPoint = { index: number; depth: number; time: number }

function getChartData(): ChartPoint[] {
  const compressions = mockSession.compressions
  return compressions.map((depth, index) => ({
    index,
    depth: Math.round(depth * 10) / 10,
    time: index,
  }))
}

export default function CompressionDepthChart() {
  const data = getChartData()

  return (
    <div className="w-full h-[280px] sm:h-[320px]">
      <ResponsiveContainer width="100%" height="100%" minHeight={260}>
        <LineChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          {/* Target zone: 50–60 mm (drawn first so line appears on top) */}
          <ReferenceArea
            y1={TARGET_MIN}
            y2={TARGET_MAX}
            fill="#22c55e"
            fillOpacity={0.15}
            stroke="none"
          />
          <ReferenceLine y={TARGET_MIN} stroke="#22c55e" strokeDasharray="2 2" strokeOpacity={0.7} />
          <ReferenceLine y={TARGET_MAX} stroke="#22c55e" strokeDasharray="2 2" strokeOpacity={0.7} />
          <XAxis
            dataKey="index"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => `#${v}`}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis
            dataKey="depth"
            type="number"
            domain={[40, 65]}
            unit=" mm"
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={{ stroke: '#cbd5e1' }}
            width={42}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload != null
                ? `Compression #${(payload[0].payload as ChartPoint).index}`
                : ''
            }
            formatter={(value: number | undefined) => [value != null ? `${value} mm` : '—', 'Depth']}
            labelStyle={{ color: '#0f172a' }}
          />
          <Line
            type="monotone"
            dataKey="depth"
            stroke="#0f172a"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive={true}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-500 mt-1 text-center">
        Target zone: 50–60 mm (shaded green)
      </p>
    </div>
  )
}
