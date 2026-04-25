"use client"

import { useState } from 'react'
import type { ActiveSession } from '@/lib/hubTypes'

type Props = {
  activeSession: ActiveSession | null
  selectedManikinId: string | null
  onSessionChange: (session: ActiveSession | null) => void
  onSummaryRefresh: () => void
}

export default function SessionManager({
  activeSession,
  selectedManikinId,
  onSessionChange,
  onSummaryRefresh,
}: Props) {
  const [traineeId, setTraineeId] = useState('trainee-local')
  const [busy, setBusy] = useState<'start' | 'end' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleStart = async () => {
    setBusy('start')
    setMessage(null)

    try {
      const response = await fetch('/api/mock/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manikinId: selectedManikinId, traineeId }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to start session.')
      }

      onSessionChange(payload.activeSession ?? payload.session ?? null)
      setMessage('Session started.')
      onSummaryRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start session.')
    } finally {
      setBusy(null)
    }
  }

  const handleEnd = async () => {
    if (!activeSession) {
      return
    }

    setBusy('end')
    setMessage(null)

    try {
      const response = await fetch('/api/mock/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.sessionId }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to end session.')
      }

      onSessionChange(null)
      setMessage('Session closed. Summary updated.')
      onSummaryRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to end session.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Session Control Center</h2>
          <p className="mt-1 text-sm text-slate-500">Start or end the current local training session.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${activeSession ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
          {activeSession ? 'Active' : 'Idle'}
        </span>
      </div>

      <div className="mt-5 space-y-4 rounded-2xl bg-slate-50 p-4">
        <label className="block text-sm font-medium text-slate-700">
          Trainee ID
          <input
            value={traineeId}
            onChange={(event) => setTraineeId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
            placeholder="trainee-local"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={busy !== null || !selectedManikinId || Boolean(activeSession)}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {busy === 'start' ? 'Starting...' : 'Start Session'}
          </button>
          <button
            type="button"
            onClick={handleEnd}
            disabled={busy !== null || !activeSession}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            {busy === 'end' ? 'Ending...' : 'End Session'}
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Current Session</h3>
        {activeSession ? (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Session ID</dt>
              <dd className="font-semibold text-slate-900">{activeSession.sessionId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Manikin</dt>
              <dd className="font-semibold text-slate-900">{activeSession.manikinId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Trainee</dt>
              <dd className="font-semibold text-slate-900">{activeSession.traineeId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Started</dt>
              <dd className="font-semibold text-slate-900">{new Date(activeSession.startedAt).toLocaleString()}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-600">No live session is running. Select a manikin and start one.</p>
        )}
      </div>

      {message && <p className="mt-4 text-sm text-slate-600">{message}</p>}
    </section>
  )
}