"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import HealthBanner from './HealthBanner'
import ManikinGrid from './ManikinGrid'
import SessionManager from './SessionManager'
import SummaryCard from './SummaryCard'
import type { ActiveSession, LiveTelemetry } from '@/lib/hubTypes'

export default function InstructorHubDashboard() {
  const router = useRouter()
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetry[]>([])
  const [liveLoading, setLiveLoading] = useState(true)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [selectedManikinId, setSelectedManikinId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadLiveTelemetry = async () => {
      try {
        const response = await fetch('/api/mock/live', { cache: 'no-store' })
        const payload = await response.json()

        if (!cancelled) {
          if (!response.ok) {
            throw new Error(payload?.error ?? 'Unable to load live telemetry.')
          }

          setLiveTelemetry(payload)
          setLiveError(null)

          setSelectedManikinId((current) => {
            if (current && payload.some((item: LiveTelemetry) => item.manikinId === current)) {
              return current
            }

            return activeSession?.manikinId ?? payload[0]?.manikinId ?? null
          })
        }
      } catch (fetchError) {
        if (!cancelled) {
          setLiveError(fetchError instanceof Error ? fetchError.message : 'Unable to load live telemetry.')
        }
      } finally {
        if (!cancelled) {
          setLiveLoading(false)
        }
      }
    }

    void loadLiveTelemetry()
    const intervalId = window.setInterval(loadLiveTelemetry, 4000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeSession?.manikinId])

  useEffect(() => {
    let cancelled = false

    const loadActiveSession = async () => {
      try {
        const response = await fetch('/api/mock/session/active', { cache: 'no-store' })
        const payload = await response.json()

        if (!cancelled) {
          if (!response.ok) {
            throw new Error(payload?.error ?? 'Unable to load active session.')
          }

          setActiveSession(payload.activeSession ?? payload.session ?? null)
        }
      } catch {
        if (!cancelled) {
          setActiveSession(null)
        }
      }
    }

    void loadActiveSession()
    const intervalId = window.setInterval(loadActiveSession, 4000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (activeSession?.manikinId) {
      setSelectedManikinId(activeSession.manikinId)
    }
  }, [activeSession?.manikinId])

  const selectedTelemetry = useMemo(
    () => liveTelemetry.find((item) => item.manikinId === selectedManikinId) ?? null,
    [liveTelemetry, selectedManikinId]
  )

  const handleOpenStudentDashboard = (manikinId: string) => {
    setSelectedManikinId(manikinId)
    router.push(`/student/dashboard?manikinId=${encodeURIComponent(manikinId)}`)
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fcff_0,_#eef7ff_42%,_#f8fafc_100%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">ResQ Local Hub</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Instructor Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Local-first control room for health, live telemetry, session control, and after-session review.
            </p>
          </div>
          <Link href="/login" className="text-sm font-semibold text-sky-700 hover:text-sky-900">
            Back to login
          </Link>
        </header>

        <div className="mt-5">
          <HealthBanner />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-5">
            <ManikinGrid
              telemetry={liveTelemetry}
              loading={liveLoading}
              error={liveError}
              activeManikinId={activeSession?.manikinId ?? null}
              selectedManikinId={selectedManikinId}
              onSelectManikin={handleOpenStudentDashboard}
            />

            <SummaryCard />
          </div>

          <div className="space-y-5">
            <SessionManager
              activeSession={activeSession}
              selectedManikinId={selectedTelemetry?.manikinId ?? selectedManikinId}
              onSessionChange={setActiveSession}
              onSummaryRefresh={() => {
                window.dispatchEvent(new Event('resq-summary-refresh'))
              }}
            />

            <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
              <h2 className="text-xl font-semibold">Phase 1 focus</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>Live telemetry failures stay isolated from health checks and session controls.</li>
                <li>The active session highlight follows the selected manikin tile.</li>
                <li>Detailed trend charts remain in the after-session summary view.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}