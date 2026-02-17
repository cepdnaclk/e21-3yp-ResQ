'use client'

import Link from 'next/link'
import { studentSessionMetrics, getRecoilStatus } from '../../data/mockDashboard'

const DEPTH_MIN = 0
const DEPTH_MAX = 70
const DEPTH_TARGET_LOW = 50
const DEPTH_TARGET_HIGH = 60

function DepthGauge({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, ((value - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN)) * 100))
  const targetLowPct = ((DEPTH_TARGET_LOW - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN)) * 100
  const targetHighPct = ((DEPTH_TARGET_HIGH - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN)) * 100
  const inTarget = value >= DEPTH_TARGET_LOW && value <= DEPTH_TARGET_HIGH

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">Compression depth</span>
        <span className={`font-semibold ${inTarget ? 'text-emerald-600' : 'text-resq-navy'}`}>
          {value} mm
        </span>
      </div>
      <div className="relative h-6 rounded-full bg-slate-200 overflow-hidden">
        {/* Target zone band (50–60 mm) */}
        <div
          className="absolute inset-y-0 bg-emerald-300 opacity-40"
          style={{ left: `${targetLowPct}%`, width: `${targetHighPct - targetLowPct}%` }}
        />
        {/* Current depth fill */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${
            inTarget ? 'bg-resq-blue' : 'bg-resq-navy'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>0</span>
        <span>Target 50–60 mm</span>
        <span>{DEPTH_MAX} mm</span>
      </div>
    </div>
  )
}

function MetricCard({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

export default function StudentDashboardPage() {
  const metrics = studentSessionMetrics
  const recoilStatus = getRecoilStatus(metrics.recoilAccuracy)

  return (
    <main className="min-h-screen bg-[#f8fafc]">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-semibold text-resq-navy">Student dashboard</h1>
          <Link
            href="/login"
            className="text-sm text-resq-blue hover:underline font-medium"
          >
            ← Back to login
          </Link>
        </header>

        <p className="text-slate-600 mb-6">
          Session-based CPR performance metrics. Target depth 50–60 mm, full recoil between compressions.
        </p>

        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-3">
          <MetricCard title="Depth" className="lg:col-span-2">
            <DepthGauge value={metrics.averageDepth} />
          </MetricCard>

          <MetricCard title="Pressure">
            <p className="text-3xl font-bold text-resq-navy">{metrics.pressure}</p>
            <p className="text-sm text-slate-500 mt-1">kg force applied</p>
          </MetricCard>

          <MetricCard title="Recoil state" className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex h-3 w-3 rounded-full ${
                  recoilStatus === 'Full Recoil' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                aria-hidden
              />
              <p className="text-xl font-semibold text-resq-navy">{recoilStatus}</p>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              {metrics.recoilAccuracy}% recoil accuracy this session
            </p>
          </MetricCard>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <MetricCard title="Rate">
            <p className="text-3xl font-bold text-resq-navy">{metrics.rate}</p>
            <p className="text-sm text-slate-500 mt-1">compressions per minute</p>
          </MetricCard>
          <MetricCard title="Session">
            <p className="text-3xl font-bold text-resq-navy">{metrics.timeElapsedSeconds}s</p>
            <p className="text-sm text-slate-500 mt-1">time elapsed</p>
          </MetricCard>
        </div>
      </div>
    </main>
  )
}
