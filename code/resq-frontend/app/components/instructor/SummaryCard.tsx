"use client"

import { useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '@/lib/hubTypes'

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function SummaryCard() {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadSummary = async () => {
      try {
        const response = await fetch('/api/mock/session/last-summary', { cache: 'no-store' })
        const payload = await response.json()

        if (!cancelled) {
          if (!response.ok) {
            throw new Error(payload?.error ?? 'Unable to load summary.')
          }

          setSummary(payload)
          setError(null)
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load summary.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadSummary()
    const intervalId = window.setInterval(loadSummary, 8000)
    window.addEventListener('resq-summary-refresh', loadSummary)

    return () => {
      cancelled = true
      window.removeEventListener('resq-summary-refresh', loadSummary)
      window.clearInterval(intervalId)
    }
  }, [])

  const displayCompliance = useMemo(() => {
    if (!summary) {
      return 0
    }

    return summary.compliancePct ?? summary.recoilOkPct
  }, [summary])

  const handleDownloadJson = () => {
    if (!summary) return
    downloadFile(`session-summary-${summary.sessionId}.json`, JSON.stringify(summary, null, 2), 'application/json')
  }

  const handleDownloadCsv = () => {
    if (!summary) return

    const header = ['sessionId', 'manikinId', 'traineeId', 'startedAt', 'endedAt', 'sampleCount', 'avgDepthMm', 'avgRateCpm', 'recoilOkPct', 'compliancePct']
    const row = [
      summary.sessionId,
      summary.manikinId,
      summary.traineeId,
      summary.startedAt,
      summary.endedAt,
      String(summary.sampleCount),
      String(summary.avgDepthMm),
      String(summary.avgRateCpm),
      String(summary.recoilOkPct),
      String(displayCompliance),
    ]

    downloadFile(
      `session-summary-${summary.sessionId}.csv`,
      `${header.join(',')}
${row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')}`,
      'text/csv'
    )
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Analytics Drawer</h2>
          <p className="mt-1 text-sm text-slate-500">After-session review with export-ready session totals.</p>
        </div>
        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{loading ? 'Loading summary' : 'Latest summary'}</div>
      </div>

      {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {summary ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Stat label="Avg depth" value={`${summary.avgDepthMm} mm`} />
          <Stat label="Avg rate" value={`${summary.avgRateCpm} /min`} />
          <Stat label="Recoil OK" value={`${summary.recoilOkPct}%`} accent="emerald" />
          <Stat label="Compliance" value={`${displayCompliance}%`} accent="sky" />
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">
          No summary is available yet.
        </div>
      )}

      {summary && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-2xl bg-slate-50 p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Row label="Session ID" value={summary.sessionId} />
              <Row label="Manikin" value={summary.manikinId} />
              <Row label="Trainee" value={summary.traineeId} />
              <Row label="Samples" value={String(summary.sampleCount)} />
              <Row label="Started" value={new Date(summary.startedAt).toLocaleString()} />
              <Row label="Ended" value={new Date(summary.endedAt).toLocaleString()} />
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Export</h3>
            <div className="mt-3 flex flex-col gap-3">
              <button type="button" onClick={handleDownloadCsv} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                Download CSV
              </button>
              <button type="button" onClick={handleDownloadJson} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                Download JSON
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'sky' }) {
  const accentClasses = accent === 'emerald' ? 'text-emerald-700' : accent === 'sky' ? 'text-sky-700' : 'text-slate-900'

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accentClasses}`}>{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  )
}