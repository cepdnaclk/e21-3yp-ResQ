"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { mockLiveStudents } from '../../data/mockDashboard'
import { mockSession as sessionData } from '../../data/mockSession'
import mockRootSession from '../../../mockSession.json'

// Recharts for the instructor performance visualization
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

type Session = {
  averageDepth: number
  rate: number
  recoilAccuracy: number
  pressure?: number
  pauses?: number
}

type Student = {
  id: string
  name: string
  reg: string
  session: Session
  handsOffTimeSec: number
  alertTimeSec: number
}

function CircularGauge({ value, size = 96, label }: { value: number; size?: number; label?: string }) {
  // ensure numeric inputs and provide safe defaults to avoid NaN
  const progress = Number(value ?? 0) || 0
  const sz = Number(size) || 96
  const stroke = 12
  const radius = Math.max(0, (sz - stroke) / 2)
  const circumference = isFinite(radius) ? 2 * Math.PI * radius : 0

  const clamped = Math.max(0, Math.min(100, progress))
  const offset = circumference > 0 ? circumference - (clamped / 100) * circumference : 0
  const dashArray = `${circumference} ${circumference}`

  const color = clamped >= 90 ? "#10b981" : clamped >= 80 ? "#f59e0b" : "#ef4444"

  return (
    <div className="flex items-center">
      <svg width={sz} height={sz} className="block" aria-hidden>
        <defs>
          <filter id="gShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.08" />
          </filter>
        </defs>
        <g transform={`translate(${sz / 2}, ${sz / 2})`} filter="url(#gShadow)">
          <circle r={radius} fill="#ffffff" />
          <circle r={radius} stroke="#eef2f7" strokeWidth={stroke} fill="transparent" />
          <circle
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="transparent"
            strokeDasharray={dashArray}
            strokeDashoffset={String(offset)}
            transform="rotate(-90)"
            style={{ transition: "stroke-dashoffset 400ms, stroke 200ms" }}
          />

          <text x="0" y="-6" textAnchor="middle" fontSize="22" fontWeight={700} fill="#0f172a">{clamped}</text>
          {label && <text x="0" y="18" textAnchor="middle" fontSize="11" fill="#6b7280">{label}</text>}
        </g>
      </svg>
    </div>
  )
}

function PerformanceCard({ student }: { student: Student }) {
  // normalize numeric session values to avoid NaN children and include pressure/pauses
  const depthVal = Number(student.session?.averageDepth ?? 0) || 0
  const rateVal = Number(student.session?.rate ?? 0) || 0
  const recoilVal = Number(student.session?.recoilAccuracy ?? 0) || 0
  const pressureVal = Number(student.session?.pressure ?? 0) || 0
  const pausesVal = Number(student.session?.pauses ?? 0) || 0

  const score = useMemo(() => {
    // use same simple depth-based score as student dashboard for consistency
    return Math.round((depthVal / 55) * 100) || 0
  }, [depthVal])

  const label = score >= 90 ? "Good" : score >= 80 ? "Med" : "Needs"
  // Final verdict: require depth and rate within thresholds AND an overall computed score threshold
  const SCORE_PASS_THRESHOLD = 85
  const depthInRange = depthVal >= 50 && depthVal <= 60
  const rateInRange = rateVal >= 100 && rateVal <= 120
  const isPass = depthInRange && rateInRange && score >= SCORE_PASS_THRESHOLD
  const badgeColor = isPass ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"

  return (
    <Link
      href={`/student/dashboard?student=${encodeURIComponent(student.id)}`}
      className="relative group block cursor-pointer rounded-2xl bg-white p-5 shadow-sm hover:shadow-md transform hover:-translate-y-1 transition-all border border-transparent hover:border-slate-200"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-medium">A</div>
          <div>
            <div className="text-sm font-semibold text-slate-800">{student.name}</div>
            <div className="text-xs text-slate-400">Reg # {student.reg}</div>
          </div>
        </div>

        <div className={`absolute right-4 top-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${badgeColor}`}>
          <span className={isPass ? 'text-emerald-600' : 'text-rose-600'}>{isPass ? '✓' : '✕'}</span>
          <span>{isPass ? 'PASS' : 'FAIL'}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm text-slate-500">Live CPR Quality Score</div>
          <div className="mt-3 flex items-center gap-4">
            <div className="flex-shrink-0">
              <ul className="text-sm text-slate-600 space-y-1">
                <li className="flex justify-between w-36"><span>Depth</span><span className="font-semibold text-slate-800">{String(depthVal)}</span></li>
                <li className="flex justify-between w-36"><span>Rate</span><span className="font-semibold text-slate-800">{String(rateVal)}</span></li>
                <li className="flex justify-between w-36"><span>Recoil</span><span className="font-semibold text-slate-800">{String(recoilVal)}</span></li>
                <li className="flex justify-between w-36"><span>Hand Placement</span><span className="font-semibold text-slate-800">{'93'}</span></li>
                <li className="flex justify-between w-36"><span>Pressure</span><span className="font-semibold text-slate-800">{String(pressureVal)}</span></li>
                <li className="flex justify-between w-36"><span>Pauses</span><span className="font-semibold text-slate-800">{String(pausesVal)}</span></li>
              </ul>
            </div>
            <div className="ml-2">
              <CircularGauge value={Number(score || 0)} label={label} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-3 text-sm text-slate-600 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3" /></svg>
          <span>Hands-Off Time: <span className="font-semibold text-slate-800">{student.handsOffTimeSec} sec</span></span>
        </div>

        <div className="inline-flex items-center gap-2 text-red-600 font-semibold">
          <svg className="h-4 w-4 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l5.516 9.81c.75 1.333-.213 2.991-1.742 2.991H4.483c-1.53 0-2.492-1.658-1.742-2.99l5.516-9.811zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-6a1 1 0 00-.993.883L9 8v3a1 1 0 001.993.117L11 11V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          <span>{student.alertTimeSec} sec</span>
        </div>
      </div>
    </Link>
  )
}

function HeatmapGrid({ handPlacement }: { handPlacement?: any }) {
  const off = Number(handPlacement?.offCenterStreaks ?? 0)
  const err = Number(handPlacement?.errorAtCenterMm ?? 0)

  // Distribute an intensity across 4 quadrants based on off-center streaks
  const base = [1.0, 0.85, 0.6, 0.4].map((f) => f * off + err * 0.2)
  const max = Math.max(...base, 1)

  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      {base.map((val, idx) => {
        const intensity = Math.min(1, val / max)
        const alpha = 0.08 + intensity * 0.6
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

function PerformanceChart({ session }: { session: any }) {
  const depthArr: number[] = (session?.performance?.depth ?? session?.compressions ?? []) as number[]
  const rateArr: number[] = (session?.performance?.rate ?? []) as number[]
  const pressureArr: number[] = (session?.performance?.pressure ?? []) as number[]
  const pausesArr: number[] = (session?.performance?.pauses ?? []) as number[]

  const length = Math.max(depthArr.length, rateArr.length, pressureArr.length, pausesArr.length, 1)
  const data = Array.from({ length }).map((_, i) => ({
    name: `${i + 1}`,
    depth: depthArr[i] ?? null,
    rate: rateArr[i] ?? null,
    pressure: pressureArr[i] ?? null,
    pauses: pausesArr[i] ?? 0,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />

        {/* Depth as Area (medical-blue) */}
        <Area yAxisId="left" type="monotone" dataKey="depth" stroke="#0369a1" fill="#bfdbfe" fillOpacity={0.6} />

        {/* Pressure as line (lighter blue) */}
        <Line yAxisId="left" type="monotone" dataKey="pressure" stroke="#0ea5e9" strokeWidth={2} dot={false} />

        {/* Rate as line on right axis (darker blue) */}
        <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#075985" strokeWidth={2} dot={false} />

        {/* Pauses as thin red bars */}
        <Bar yAxisId="left" dataKey="pauses" barSize={6} fill="#ef4444" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export default function InstructorDashboardPage() {
  const [query, setQuery] = useState("")
  const [filterTab, setFilterTab] = useState("all")

  // Map mockLiveStudents + sessionData into a roster with pressure and pauses
  const students: Student[] = useMemo(() => {
    const base = sessionData as unknown as Session
    // compute pauses as number of compression values under a threshold
    const pauseThreshold = 48
    const pausesCount = Array.isArray((sessionData as any).compressions)
      ? (sessionData as any).compressions.filter((c: number) => Number(c) < pauseThreshold).length
      : 0

    return mockLiveStudents.map((s, idx) => ({
      id: s.id ?? `s${idx + 1}`,
      name: s.name,
      reg: String((s as any).reg ?? '12345'),
      session: {
        averageDepth: Number(s.averageDepth ?? base.averageDepth ?? 0),
        rate: Number(base.rate ?? 0),
        recoilAccuracy: Number(s.recoilAccuracy ?? base.recoilAccuracy ?? 0),
        pressure: Number((s as any).pressure ?? (base as any).pressure ?? 0),
        pauses: pausesCount,
      },
      handsOffTimeSec: Number((s as any).timeElapsedSeconds ?? 23),
      alertTimeSec: idx === 2 ? 37 : idx === 0 ? 7.4 : 23,
    }))
  }, [])

  // Helper to evaluate pass/fail for each student
  const getStudentVerdict = (student: Student) => {
    const depthVal = Number(student.session?.averageDepth ?? 0) || 0
    const rateVal = Number(student.session?.rate ?? 0) || 0
    const score = Math.round((depthVal / 55) * 100) || 0
    const SCORE_PASS_THRESHOLD = 85
    const depthInRange = depthVal >= 50 && depthVal <= 60
    const rateInRange = rateVal >= 100 && rateVal <= 120
    return depthInRange && rateInRange && score >= SCORE_PASS_THRESHOLD
  }

  // Count pass and fail
  const passCount = students.filter((s) => getStudentVerdict(s)).length
  const failCount = students.length - passCount

  // Apply filters based on tab and search query
  const filtered = useMemo(() => {
    let result = students
    
    // Apply tab filter
    if (filterTab === "pass") {
      result = result.filter((s) => getStudentVerdict(s))
    } else if (filterTab === "fail") {
      result = result.filter((s) => !getStudentVerdict(s))
    } else if (filterTab === "top") {
      result = result.filter((s) => {
        const depthVal = Number(s.session?.averageDepth ?? 0) || 0
        const score = Math.round((depthVal / 55) * 100) || 0
        return score >= 90
      })
    } else if (filterTab === "improve") {
      result = result.filter((s) => {
        const depthVal = Number(s.session?.averageDepth ?? 0) || 0
        const score = Math.round((depthVal / 55) * 100) || 0
        return score < 80
      })
    }
    
    // Apply search query
    return result.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
  }, [students, filterTab, query])

  return (
    <main className="min-h-screen font-sans" style={{ backgroundColor: '#fbfdff' }}>
      <div className="max-w-7xl mx-auto p-6">
        {/* Top navigation with title and system text */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-semibold text-slate-800">Instructor Dashboard UI</h1>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>CPR Training System</span>
            <Link href="/login" className="text-blue-600 hover:text-blue-800 font-medium">Back to Login</Link>
            <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">☺</div>
          </div>
        </div>

        {/* Filter bar with tabs and search on right */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setFilterTab("all")} className={`rounded-full px-4 py-1 text-sm font-medium ${filterTab === "all" ? "bg-slate-100" : "bg-white border border-slate-200"}`}>All Students</button>
            <button onClick={() => setFilterTab("pass")} className={`rounded-full px-4 py-1 text-sm font-medium ${filterTab === "pass" ? "bg-emerald-100 text-emerald-800" : "bg-white border border-slate-200"}`}>Pass ({passCount})</button>
            <button onClick={() => setFilterTab("fail")} className={`rounded-full px-4 py-1 text-sm font-medium ${filterTab === "fail" ? "bg-rose-100 text-rose-700" : "bg-white border border-slate-200"}`}>Fail ({failCount})</button>
            <button onClick={() => setFilterTab("top")} className={`rounded-full px-4 py-1 text-sm font-medium ${filterTab === "top" ? "bg-slate-100" : "bg-white border border-slate-200"}`}>Top Performers</button>
            <button onClick={() => setFilterTab("improve")} className={`rounded-full px-4 py-1 text-sm font-medium ${filterTab === "improve" ? "bg-slate-100" : "bg-white border border-slate-200"}`}>Needs Improvement</button>
          </div>

          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search students..."
              className="w-64 rounded-full border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 110-15 7.5 7.5 0 010 15z" /></svg>
            </div>
          </div>
        </div>

        <section>
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {filtered.map((s) => (
              <PerformanceCard key={s.id} student={s} />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
