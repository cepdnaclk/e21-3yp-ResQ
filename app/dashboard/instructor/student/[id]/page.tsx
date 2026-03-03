"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { studentSessionMetrics, getRecoilStatus, mockLiveStudents } from '../../../../data/mockDashboard'
import mockRootSession from '../../../../../mockSession.json'

// Seeded random function for consistent server/client rendering
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

type FeedbackEntry = {
  id: string
  comment: string
  timestamp: string
}

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'

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
        <div
          className="absolute inset-y-0 bg-emerald-300 opacity-40"
          style={{ left: `${targetLowPct}%`, width: `${targetHighPct - targetLowPct}%` }}
        />
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

function CircularGauge({ value, size = 120, label }: { value: number; size?: number; label?: string }) {
  const progress = Number(value ?? 0) || 0
  const sz = Number(size) || 120
  const stroke = 14
  const radius = Math.max(0, (sz - stroke) / 2)
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, progress))
  const offset = circumference > 0 ? circumference - (clamped / 100) * circumference : 0
  const color = clamped >= 90 ? '#10b981' : clamped >= 80 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex items-center justify-center">
      <svg width={sz} height={sz}>
        <g transform={`translate(${sz / 2}, ${sz / 2})`}>
          <circle r={radius} fill="#fff" />
          <circle r={radius} stroke="#eef2f7" strokeWidth={stroke} fill="transparent" />
          <circle
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="transparent"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={String(offset)}
            transform="rotate(-90)"
          />
          <text x="0" y="-6" textAnchor="middle" fontSize="28" fontWeight={700} fill="#0f172a">{clamped}</text>
          {label && <text x="0" y="18" textAnchor="middle" fontSize="12" fill="#6b7280">{label}</text>}
        </g>
      </svg>
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
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  )
}

export default function InstructorStudentDetailPage() {
  const params = useParams()
  const studentId = params?.id ? String(params.id) : null
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackEntry[]>([])

  const feedbackStorageKey = useMemo(() => `resq-feedback-student-${studentId ?? 'default'}`, [studentId])

  const { metrics, studentName, studentSpecificPerformance } = useMemo(() => {
    if (studentId) {
      const s = mockLiveStudents.find((st) => String(st.id) === String(studentId))
      if (s) {
        const baseMetrics = {
          averageDepth: s.averageDepth,
          rate: 110,
          recoilAccuracy: s.recoilAccuracy,
          pressure: s.pressure ?? (studentSessionMetrics as any).pressure ?? 0,
          timeElapsedSeconds: s.timeElapsedSeconds ?? (studentSessionMetrics as any).timeElapsedSeconds ?? 0,
          handPlacementAccuracy: (mockRootSession as any).handPlacementAccuracy ?? 0,
          incompleteRecoil: (mockRootSession as any).incompleteRecoil ?? 0,
          longestPause: (mockRootSession as any).longestPause ?? 0,
          handsOffTime: (mockRootSession as any).handsOffTime ?? 0,
          pausesDetected: (mockRootSession as any).pausesDetected ?? 0,
          handPlacement: (mockRootSession as any).handPlacement ?? {},
          finalVerdict: (mockRootSession as any).finalVerdict ?? null,
          performance: (mockRootSession as any).performance ?? {},
        }

        // Generate performance data based on student's metrics
        // Use student ID as seed for consistent server/client rendering
        const seed = parseInt(studentId) || 1
        const numCompressions = 10
        const baseDepth = s.averageDepth
        const depthVariation = baseDepth * 0.15
        
        const depthArray = Array.from({ length: numCompressions }, (_, i) => {
          const variation = (seededRandom(seed * 100 + i) - 0.5) * depthVariation
          return Math.max(30, Math.round(baseDepth + variation))
        })

        const basePressure = s.pressure || 42
        const pressureVariation = basePressure * 0.2
        const pressureArray = Array.from({ length: numCompressions }, (_, i) => {
          const variation = (seededRandom(seed * 200 + i) - 0.5) * pressureVariation
          return Math.max(20, Math.round(basePressure + variation))
        })

        const baseRate = 110
        const rateArray = Array.from({ length: numCompressions }, (_, i) => {
          const variation = (seededRandom(seed * 300 + i) - 0.5) * 30
          return Math.max(80, Math.round(baseRate + variation))
        })

        const pauseProbability = s.averageDepth < 50 ? 0.4 : s.averageDepth < 55 ? 0.2 : 0.1
        const pausesArray = Array.from({ length: numCompressions }, (_, i) => {
          return seededRandom(seed * 400 + i) < pauseProbability ? Math.round(seededRandom(seed * 500 + i) * 2) : 0
        })

        const studentSpecificPerf = {
          depth: depthArray,
          rate: rateArray,
          pressure: pressureArray,
          pauses: pausesArray,
        }

        return {
          metrics: baseMetrics,
          studentName: s.name,
          studentSpecificPerformance: studentSpecificPerf,
        }
      }
    }
    return {
      metrics: {
        ...studentSessionMetrics,
        handPlacementAccuracy: (mockRootSession as any).handPlacementAccuracy ?? 0,
        incompleteRecoil: (mockRootSession as any).incompleteRecoil ?? 0,
        longestPause: (mockRootSession as any).longestPause ?? 0,
        handsOffTime: (mockRootSession as any).handsOffTime ?? 0,
        pausesDetected: (mockRootSession as any).pausesDetected ?? 0,
        handPlacement: (mockRootSession as any).handPlacement,
        finalVerdict: (mockRootSession as any).finalVerdict,
        performance: (mockRootSession as any).performance,
      },
      studentName: '',
      studentSpecificPerformance: {},
    }
  }, [studentId])

  const recoilStatus = getRecoilStatus(metrics.recoilAccuracy)

  const sessionPerformance = studentSpecificPerformance ?? {}

  function HeatmapGrid({ handPlacement }: { handPlacement?: any }) {
    const off = Number(handPlacement?.offCenterStreaks ?? 0)
    const err = Number(handPlacement?.errorAtCenterMm ?? 0)

    const base = [1.0, 0.85, 0.6, 0.4].map((f) => f * (off + 1) + err * 0.2)
    const max = Math.max(...base, 1)

    return (
      <div className="grid grid-cols-2 gap-2 mb-3">
        {base.map((val, idx) => {
          const intensity = Math.min(1, val / max)
          const alpha = 0.06 + intensity * 0.6
          const bg = `rgba(239,68,68,${alpha})`
          return (
            <div key={idx} className="h-28 rounded-md flex items-center justify-center" style={{ background: bg }}>
              <div className="text-xs text-slate-700">{Math.round(intensity * 100)}%</div>
            </div>
          )
        })}
      </div>
    )
  }

  function PerformanceChart({ perf }: { perf: any }) {
    const depthArr: number[] = (perf?.depth ?? (mockRootSession as any).compressions ?? []) as number[]
    const rateArr: number[] = perf?.rate ?? []
    const pressureArr: number[] = perf?.pressure ?? []
    const pausesArr: number[] = perf?.pauses ?? []

    const length = Math.max(depthArr.length, rateArr.length, pressureArr.length, pausesArr.length, 1)
    const data = Array.from({ length }).map((_, i) => ({
      name: `${i + 1}`,
      depth: depthArr[i] ?? null,
      rate: rateArr[i] ?? null,
      pressure: pressureArr[i] ?? null,
      pauses: pausesArr[i] ?? 0,
    }))

    return (
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} label={{ value: 'Compression Cycle', position: 'insideBottom', offset: -5, fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'Depth/Pressure (mm/kg)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'Rate (cpm)', angle: 90, position: 'insideRight', fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: '12px' }} />

          <Area yAxisId="left" type="monotone" dataKey="depth" name="Depth (mm)" stroke="#0369a1" fill="#bfdbfe" fillOpacity={0.6} />
          <Line yAxisId="left" type="monotone" dataKey="pressure" name="Pressure (kg)" stroke="#0ea5e9" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="rate" name="Rate (cpm)" stroke="#075985" strokeWidth={2} dot={false} />
          <Bar yAxisId="left" dataKey="pauses" name="Pauses (sec)" barSize={12} fill="#dc2626" opacity={0.8} />
        </ComposedChart>
      </ResponsiveContainer>
    )
  }

  const computedScore = Math.round((Number(metrics.averageDepth ?? 0) / 55) * 100) || 0

  const isPass = Number(metrics.averageDepth ?? 0) >= 50 && Number(metrics.averageDepth ?? 0) <= 60 && Number(metrics.rate ?? 0) >= 100 && Number(metrics.rate ?? 0) <= 120

  // Calculate pause statistics
  const pauseStats = useMemo(() => {
    const pausesArr: number[] = (sessionPerformance as any)?.pauses ?? []
    const totalPauses = pausesArr.reduce((sum: number, p: number) => sum + p, 0)
    const pauseCount = pausesArr.filter((p: number) => p > 0).length
    const longestPause = pausesArr.length > 0 ? Math.max(...pausesArr) : 0
    const avgPause = pauseCount > 0 ? (totalPauses / pauseCount).toFixed(1) : '0'
    return { totalPauses, pauseCount, longestPause, avgPause }
  }, [sessionPerformance])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(feedbackStorageKey)
      if (!raw) {
        setFeedbackHistory([])
        return
      }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setFeedbackHistory(parsed)
      } else {
        setFeedbackHistory([])
      }
    } catch {
      setFeedbackHistory([])
    }
  }, [feedbackStorageKey])

  function handleSaveFeedback() {
    const trimmed = feedbackText.trim()
    if (!trimmed) return

    const newEntry: FeedbackEntry = {
      id: `${Date.now()}`,
      comment: trimmed,
      timestamp: new Date().toISOString(),
    }

    const updated = [newEntry, ...feedbackHistory]
    setFeedbackHistory(updated)
    setFeedbackText('')

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(feedbackStorageKey, JSON.stringify(updated))
    }
  }

  function handleDeleteFeedback(entryId: string) {
    const updated = feedbackHistory.filter((entry) => entry.id !== entryId)
    setFeedbackHistory(updated)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(feedbackStorageKey, JSON.stringify(updated))
    }
  }

  function handleClearAllFeedback() {
    setFeedbackHistory([])
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(feedbackStorageKey, JSON.stringify([]))
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-slate-800">{studentName ? `${studentName} — Student Performance` : 'Student Performance'}</h1>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard/instructor" className="text-blue-600 hover:text-blue-800 font-medium">Back to Dashboard</Link>
            <div className="text-slate-500">CPR Training System</div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Top Row - Student Info, Quality Score, Verdict & Pause */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Student Info */}
            <div className="lg:col-span-3">
              <div className="rounded-2xl bg-white p-4 shadow-sm h-full">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{studentName || 'Student'}</div>
                  <div className="text-xs text-slate-400">Registration Number</div>
                </div>

                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Average Values</h4>
                  <div className="text-sm text-slate-600 space-y-1">
                    <div className="flex justify-between"><span>Average Depth</span><span className="font-semibold">{metrics.averageDepth} mm</span></div>
                    <div className="flex justify-between"><span>Rate</span><span className="font-semibold">{metrics.rate} cpm</span></div>
                    <div className="flex justify-between"><span>Recoil</span><span className="font-semibold">{metrics.recoilAccuracy} %</span></div>
                    <div className="flex justify-between"><span>Hand Placement</span><span className="font-semibold">{(metrics as any).handPlacementAccuracy || 0} %</span></div>
                    <div className="flex justify-between"><span>Incomplete Recoil</span><span className="font-semibold">{(metrics as any).incompleteRecoil || 0} %</span></div>
                    <div className="flex justify-between"><span>Longest Pause</span><span className="font-semibold">{(metrics as any).longestPause || 0} sec</span></div>
                    <div className="flex justify-between"><span>Hands-Off Time</span><span className="font-semibold">{(metrics as any).handsOffTime || 0} sec</span></div>
                    <div className="flex justify-between"><span>Pauses Detected</span><span className="font-semibold">{(metrics as any).pausesDetected || 0}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Center: Quality Score */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl bg-white p-6 shadow-sm h-full flex flex-col items-center justify-center">
                <div className="text-sm text-slate-500">Live CPR Quality Score</div>
                <div className="mt-3">
                  <CircularGauge value={computedScore} label={computedScore >= 90 ? 'Good' : 'Med'} />
                </div>

                <div className="w-full mt-4 grid grid-cols-2 gap-4 text-sm text-slate-600">
                  <div className="flex justify-between"><span>Depth</span><span className="font-semibold">{metrics.averageDepth}</span></div>
                  <div className="flex justify-between"><span>Rate</span><span className="font-semibold">{metrics.rate}</span></div>
                  <div className="flex justify-between"><span>Recoil</span><span className="font-semibold">{metrics.recoilAccuracy}</span></div>
                  <div className="flex justify-between"><span>Hand Placement</span><span className="font-semibold">{(metrics as any).handPlacement?.errorAtCenterMm ?? '-'}</span></div>
                </div>
              </div>
            </div>

            {/* Right: Verdict & Pause Analysis */}
            <div className="lg:col-span-4 space-y-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-500">Final Verdict</div>
                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${isPass ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
                    <span className={isPass ? 'text-emerald-600' : 'text-rose-600'}>{isPass ? '✓' : '✕'}</span>
                    <span>{isPass ? 'PASS' : 'FAIL'}</span>
                    <span className="text-xs text-slate-500 ml-2">{computedScore}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-slate-700">Pause Analysis</div>
                  <div className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${pauseStats.pauseCount === 0 ? 'bg-emerald-100 text-emerald-700' : pauseStats.pauseCount <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM8 9a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/></svg>
                    {pauseStats.pauseCount === 0 ? 'Excellent' : pauseStats.pauseCount <= 2 ? 'Good' : 'Needs Work'}
                  </div>
                </div>
                <div className="space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between items-center">
                    <span>Total Pauses</span>
                    <span className="font-bold text-lg text-rose-600">{pauseStats.totalPauses} sec</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pause Events</span>
                    <span className="font-semibold text-slate-800">{pauseStats.pauseCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Longest Pause</span>
                    <span className="font-semibold text-slate-800">{pauseStats.longestPause} sec</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average Pause</span>
                    <span className="font-semibold text-slate-800">{pauseStats.avgPause} sec</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="text-xs text-slate-500 italic">CPR should have minimal interruptions. Aim for less than 10 seconds total pause time.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row - Hand Placement and Performance Graph */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-sm font-medium text-slate-500 mb-3">Hand Placement Accuracy</div>
                <HeatmapGrid handPlacement={(metrics as any).handPlacement} />
                <div className="mt-3 text-sm text-slate-600">
                  <div className="flex justify-between"><span>Error at Center</span><span className="font-semibold">{(metrics as any).handPlacement?.errorAtCenterMm ?? 4} mm</span></div>
                  <div className="flex justify-between mt-2"><span>off-center streaks</span><span className="font-semibold">{(metrics as any).handPlacement?.offCenterStreaks ?? 3} x</span></div>
                  <div className="flex justify-between mt-2"><span>Angle tilt indicator</span><span className="font-semibold">{(metrics as any).handPlacement?.angleTiltIndicator ?? 2} x</span></div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-sm font-medium text-slate-500 mb-3">Performance Measure Graph</div>
                <PerformanceChart perf={sessionPerformance} />
              </div>
            </div>
          </div>

          {/* Bottom Row - Assignment */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-slate-700">Feedback History</div>
                  <button
                    className="text-xs text-rose-600 hover:text-rose-700 disabled:text-slate-400"
                    onClick={handleClearAllFeedback}
                    disabled={feedbackHistory.length === 0}
                  >
                    Clear All
                  </button>
                </div>
                {feedbackHistory.length === 0 ? (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-500">
                    No feedback yet.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                    {feedbackHistory.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-slate-100 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm text-slate-700 whitespace-pre-wrap flex-1">{entry.comment}</div>
                          <button
                            className="text-xs text-rose-600 hover:text-rose-700"
                            onClick={() => handleDeleteFeedback(entry.id)}
                          >
                            Delete
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-sm text-slate-500 mb-2">Assignment</div>
                <textarea
                  className="w-full rounded-lg border border-slate-100 p-2 text-sm"
                  rows={5}
                  placeholder="Enter your feedback here..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                />
                <div className="mt-3 text-right">
                  <button
                    className="bg-resq-blue text-white px-4 py-1 rounded-full text-sm disabled:opacity-50"
                    onClick={handleSaveFeedback}
                    disabled={!feedbackText.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
