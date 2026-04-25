'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ActiveSession, LiveTelemetry, SessionSummary } from '@/lib/hubTypes'

type SessionStatus = 'SESSION_ACTIVE' | 'IDLE'
type ConnectionStatus = 'online' | 'degraded' | 'offline'

type LiveSample = {
  timestamp: string
  depthMm: number
  rateCpm: number
  recoilOk: boolean
  pauses: number
  batteryLevel: number
  connectionStatus: ConnectionStatus
  flags: string[]
}

type EventEntry = {
  id: string
  title: string
  detail: string
  timestamp: string
  tone: 'info' | 'warning' | 'critical'
}

const TELEMETRY_WINDOW = 12

function nowIso() {
  return new Date().toISOString()
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function statusTone(status: SessionStatus) {
  return status === 'SESSION_ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'
}

function connectionTone(status: ConnectionStatus) {
  if (status === 'online') {
    return 'border-cyan-200 bg-cyan-50 text-cyan-700'
  }

  if (status === 'degraded') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-rose-200 bg-rose-50 text-rose-700'
}

function eventTone(tone: EventEntry['tone']) {
  if (tone === 'critical') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }

  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function toLiveSample(entry: LiveTelemetry | null | undefined): LiveSample {
  if (!entry) {
    return {
      timestamp: nowIso(),
      depthMm: 0,
      rateCpm: 0,
      recoilOk: false,
      pauses: 0,
      batteryLevel: 0,
      connectionStatus: 'offline',
      flags: ['Waiting for backend data'],
    }
  }

  const flags = Array.isArray(entry.flags) && entry.flags.length > 0 ? entry.flags : ['On target']

  return {
    timestamp: entry.timestamp,
    depthMm: Number(entry.depthMm ?? 0),
    rateCpm: Number(entry.rateCpm ?? 0),
    recoilOk: Boolean(entry.recoilOk),
    pauses: Number(entry.pauses ?? 0),
    batteryLevel: Number(entry.batteryLevel ?? 0),
    connectionStatus: (entry.connectionStatus as ConnectionStatus) || 'offline',
    flags,
  }
}

function buildEventEntries(sample: LiveSample): EventEntry[] {
  const entries: EventEntry[] = []
  const eventStamp = sample.timestamp

  if (sample.depthMm < 50) {
    entries.push({
      id: `depth-${eventStamp}`,
      title: 'Press Deeper',
      detail: 'Compression depth dropped below the target band.',
      timestamp: sample.timestamp,
      tone: 'warning',
    })
  }

  if (sample.depthMm > 60) {
    entries.push({
      id: `release-${eventStamp}`,
      title: 'Release Fully',
      detail: 'Compression depth is above the target band.',
      timestamp: sample.timestamp,
      tone: 'warning',
    })
  }

  if (sample.pauses > 0) {
    entries.push({
      id: `pause-${eventStamp}`,
      title: 'Pause detected',
      detail: `${sample.pauses} compression pause${sample.pauses > 1 ? 's' : ''} recorded in the live stream.`,
      timestamp: sample.timestamp,
      tone: 'info',
    })
  }

  if (sample.connectionStatus !== 'online') {
    entries.push({
      id: `connection-${eventStamp}`,
      title: 'Connection warning',
      detail: 'Heartbeat is still visible, but the link quality has degraded.',
      timestamp: sample.timestamp,
      tone: 'critical',
    })
  }

  if (entries.length === 0) {
    entries.push({
      id: `target-${eventStamp}`,
      title: 'On target',
      detail: 'Telemetry stayed inside the live coaching band.',
      timestamp: sample.timestamp,
      tone: 'info',
    })
  }

  return entries
}

function buildSummaryCard(summary: SessionSummary | null | undefined, sample: LiveSample, sessionIsLive: boolean) {
  if (summary) {
    return {
      avgDepthMm: summary.avgDepthMm,
      avgRateCpm: summary.avgRateCpm,
      recoilOkPct: summary.recoilOkPct,
      verdict: summary.compliancePct != null && summary.compliancePct >= 80 ? 'PASS' : 'REVIEW',
      score: summary.compliancePct ?? summary.recoilOkPct,
    }
  }

  return {
    avgDepthMm: sample.depthMm,
    avgRateCpm: sample.rateCpm,
    recoilOkPct: sample.recoilOk ? 100 : 0,
    verdict: sessionIsLive ? 'ACTIVE' : 'WAITING',
    score: sample.recoilOk ? 100 : 0,
  }
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
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function LiveStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{detail}</div>
    </div>
  )
}

export function StudentTraineeLiveAccess() {
  const searchParams = useSearchParams()
  const queryManikinId = searchParams?.get('manikinId')?.trim() || ''
  const [selectedManikinId, setSelectedManikinId] = useState(queryManikinId)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('IDLE')
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetry[]>([])
  const [backendSummary, setBackendSummary] = useState<SessionSummary | null>(null)
  const [liveSample, setLiveSample] = useState<LiveSample>(() => toLiveSample(null))
  const [telemetryHistory, setTelemetryHistory] = useState<LiveSample[]>(() => [toLiveSample(null)])
  const [eventHistory, setEventHistory] = useState<EventEntry[]>(() => buildEventEntries(toLiveSample(null)))
  const [heartbeatAt, setHeartbeatAt] = useState(nowIso())

  useEffect(() => {
    if (queryManikinId && queryManikinId !== selectedManikinId) {
      setSelectedManikinId(queryManikinId)
    }
  }, [queryManikinId, selectedManikinId])

  const selectedTelemetry = useMemo(
    () => liveTelemetry.find((item) => item.manikinId === selectedManikinId) ?? liveTelemetry[0] ?? null,
    [liveTelemetry, selectedManikinId]
  )

  const resolvedManikinId = selectedTelemetry?.manikinId || activeSession?.manikinId || selectedManikinId
  const topicBase = resolvedManikinId ? `resq/manikins/${resolvedManikinId}` : 'resq/manikins/pending'
  const topics = useMemo(
    () => ({
      telemetry: `${topicBase}/telemetry`,
      events: `${topicBase}/events`,
      status: `${topicBase}/status`,
      heartbeat: `${topicBase}/heartbeat`,
    }),
    [topicBase],
  )

  const liveSummary = useMemo(
    () => buildSummaryCard(backendSummary, liveSample, sessionStatus === 'SESSION_ACTIVE'),
    [backendSummary, liveSample, sessionStatus],
  )

  useEffect(() => {
    let cancelled = false

    const loadBackendState = async () => {
      const manikinQuery = selectedManikinId ? `?manikinId=${encodeURIComponent(selectedManikinId)}` : ''

      try {
        const [activeResponse, liveResponse, summaryResponse] = await Promise.all([
          fetch(`/api/mock/session/active${manikinQuery}`, { cache: 'no-store' }),
          fetch(`/api/mock/live${manikinQuery}`, { cache: 'no-store' }),
          fetch(`/api/mock/session/last-summary${manikinQuery}`, { cache: 'no-store' }),
        ])

        const [activePayload, livePayload, summaryPayload] = await Promise.all([
          activeResponse.json(),
          liveResponse.json(),
          summaryResponse.json(),
        ])

        if (cancelled) {
          return
        }

        if (!activeResponse.ok) {
          throw new Error(activePayload?.error ?? 'Unable to load the active session.')
        }

        if (!liveResponse.ok) {
          throw new Error(livePayload?.error ?? 'Unable to load live telemetry.')
        }

        if (!summaryResponse.ok) {
          throw new Error(summaryPayload?.error ?? 'Unable to load the latest summary.')
        }

        const nextActiveSession = (activePayload?.activeSession ?? null) as ActiveSession | null
        const nextTelemetry = Array.isArray(livePayload) ? (livePayload as LiveTelemetry[]) : []
        const nextSummary = (summaryPayload ?? null) as SessionSummary | null
        const nextSelection =
          selectedManikinId || nextActiveSession?.manikinId || nextTelemetry[0]?.manikinId || ''
        const selectedRow =
          nextTelemetry.find((entry) => entry.manikinId === nextSelection) ?? nextTelemetry[0] ?? null
        const nextSample = toLiveSample(selectedRow)

        setActiveSession(nextActiveSession)
        setLiveTelemetry(nextTelemetry)
        setBackendSummary(nextSummary)
        setSessionStatus(nextActiveSession?.status === 'active' ? 'SESSION_ACTIVE' : 'IDLE')

        if (nextSelection && nextSelection !== selectedManikinId) {
          setSelectedManikinId(nextSelection)
        }

        setLiveSample(nextSample)
        setHeartbeatAt(selectedRow?.timestamp ?? nowIso())
        setTelemetryHistory((currentHistory) => {
          const nextHistory = [...currentHistory, nextSample]
          return nextHistory.slice(-TELEMETRY_WINDOW)
        })
        setEventHistory((currentHistory) => {
          const nextEvents = buildEventEntries(nextSample)
          if (nextEvents.length === 0) {
            return currentHistory.slice(0, 6)
          }

          return [...nextEvents, ...currentHistory].slice(0, 6)
        })
      } catch (error) {
        if (!cancelled) {
          setSessionStatus('IDLE')
          setHeartbeatAt(nowIso())
          setLiveSample(toLiveSample(null))
          setLiveTelemetry([])
          setBackendSummary(null)
          setEventHistory([
            {
              id: 'backend-error',
              title: 'Backend unavailable',
              detail: error instanceof Error ? error.message : 'Unable to load live telemetry.',
              timestamp: nowIso(),
              tone: 'critical',
            },
          ])
        }
      }
    }

    void loadBackendState()
    const intervalId = window.setInterval(loadBackendState, 4000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [selectedManikinId])

  const sessionIsLive = sessionStatus === 'SESSION_ACTIVE'
  const connectionLabel = sessionIsLive ? (liveSample.connectionStatus === 'online' ? 'Stable' : 'Degraded') : 'Idle'
  const connectionDetail = sessionIsLive
    ? `Backend refreshed ${formatTime(heartbeatAt)}.`
    : 'The instructor has ended the session and the device is waiting for the next start command.'
  const displayManikinId = resolvedManikinId || 'pending'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e2eef8_0,_#f8fbff_42%,_#f6f7fb_100%)] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/70 bg-white/85 px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">Trainee Live Access</div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Student dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Device-scoped telemetry stream for {displayManikinId}.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`rounded-full border px-3 py-1 font-semibold uppercase tracking-[0.16em] ${statusTone(sessionStatus)}`}>
              {sessionStatus}
            </span>
            <span className={`rounded-full border px-3 py-1 font-semibold uppercase tracking-[0.16em] ${connectionTone(liveSample.connectionStatus)}`}>
              {connectionLabel}
            </span>
            <Link href="/login" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700">
              Back to login
            </Link>
          </div>
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-4">
          <MetricCard title="Session boundary" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <LiveStat label="Device" value={displayManikinId} detail={`MQTT base: ${topicBase}`} />
              <LiveStat label="Status topic" value={topics.status} detail="Updated on change only" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <LiveStat label="Telemetry topic" value={topics.telemetry} detail="Frequent live updates" />
              <LiveStat label="Heartbeat topic" value={topics.heartbeat} detail="Connection health indicator" />
            </div>
          </MetricCard>

          <MetricCard title="Connection health">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">MQTT link</div>
              <div className="mt-2 flex items-center gap-3">
                <span className={`inline-flex h-3 w-3 rounded-full ${sessionIsLive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <div>
                  <div className="text-lg font-semibold text-slate-900">{connectionLabel}</div>
                  <div className="text-sm text-slate-500">{connectionDetail}</div>
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">Heartbeat</div>
              <div className="mt-1">{topics.heartbeat}</div>
            </div>
          </MetricCard>

          <MetricCard title="Summary">
            <div className="grid gap-3">
              <LiveStat label="Average depth" value={`${liveSummary.avgDepthMm} mm`} detail="Session aggregate" />
              <LiveStat label="Average rate" value={`${liveSummary.avgRateCpm} cpm`} detail="Live stream target" />
              <LiveStat label="Recoil" value={`${liveSummary.recoilOkPct}%`} detail={`Final verdict: ${liveSummary.verdict} (${liveSummary.score}/100)`} />
            </div>
          </MetricCard>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <MetricCard title="Live compression gauges" className="overflow-hidden">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Depth</span>
                  <span className="font-semibold text-slate-900">{liveSample.depthMm} mm</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all ${liveSample.depthMm >= 50 && liveSample.depthMm <= 60 ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                    style={{ width: `${Math.min(100, Math.max(0, (liveSample.depthMm / 70) * 100))}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-500">Target band: 50-60 mm</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Rate</span>
                  <span className="font-semibold text-slate-900">{liveSample.rateCpm} cpm</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, (liveSample.rateCpm / 130) * 100))}%` }} />
                </div>
                <div className="mt-2 text-xs text-slate-500">Telemetry stream updates frequently while the session is active.</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Battery</span>
                  <span className="font-semibold text-slate-900">{liveSample.batteryLevel}%</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className={`h-full rounded-full transition-all ${liveSample.batteryLevel < 45 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${liveSample.batteryLevel}%` }} />
                </div>
                <div className="mt-2 text-xs text-slate-500">Heartbeat topic: stable link if the bar stays green.</div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Live telemetry window</div>
                    <div className="text-xs text-slate-500">Derived from {topics.telemetry}</div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{sessionIsLive ? 'streaming' : 'idle'}</span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={telemetryHistory.map((entry) => ({
                      timestamp: formatTime(entry.timestamp),
                      depthMm: entry.depthMm,
                      rateCpm: entry.rateCpm,
                    }))} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[40, 130]} />
                      <Tooltip />
                      <Area type="monotone" dataKey="depthMm" name="Depth" stroke="#0891b2" fill="#bae6fd" fillOpacity={0.7} />
                      <Area type="monotone" dataKey="rateCpm" name="Rate" stroke="#1d4ed8" fill="#dbeafe" fillOpacity={0.45} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Current telemetry</div>
                    <div className="text-xs text-slate-500">Live sample from {topics.telemetry}</div>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{formatTime(liveSample.timestamp)}</span>
                </div>

                <div className="space-y-3">
                  <LiveStat label="Compression depth" value={`${liveSample.depthMm} mm`} detail={liveSample.flags[0] ?? 'Within the live coaching band'} />
                  <LiveStat label="Compression rate" value={`${liveSample.rateCpm} cpm`} detail={liveSample.recoilOk ? 'Recoil is staying acceptable.' : 'Recoil is lagging behind the target.'} />
                  <LiveStat label="Flags" value={liveSample.flags.length.toString()} detail={liveSample.flags.join(' • ')} />
                </div>
              </div>
            </div>
          </MetricCard>

          <div className="space-y-6">
            <MetricCard title="Coaching alerts">
              <div className="space-y-3">
                {eventHistory.map((entry) => (
                  <article key={entry.id} className={`rounded-2xl border p-4 ${eventTone(entry.tone)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-slate-900">{entry.title}</h4>
                        <p className="mt-1 text-sm text-slate-600">{entry.detail}</p>
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{formatTime(entry.timestamp)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </MetricCard>

            <MetricCard title="Event history">
              <div className="space-y-2 text-sm text-slate-600">
                {eventHistory.length === 0 ? (
                  <p>No events have been received from {topics.events} yet.</p>
                ) : (
                  eventHistory.slice(0, 4).map((entry) => (
                    <div key={`${entry.id}-history`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="font-medium text-slate-900">{entry.title}</div>
                      <div className="text-xs text-slate-500">{entry.detail}</div>
                    </div>
                  ))
                )}
              </div>
            </MetricCard>

            <MetricCard title="Session status">
              {sessionIsLive ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  The manikin is in SESSION_ACTIVE mode. Telemetry continues until the instructor ends the session.
                </div>
              ) : (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">Idle summary</div>
                  <p>The live stream has stopped. This view stays on the final summary until the next session starts.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LiveStat label="Final verdict" value={String(liveSummary.verdict)} detail={`Score ${liveSummary.score}/100`} />
                    <LiveStat label="Last status" value="IDLE" detail="Waiting for a new instructor command" />
                  </div>
                </div>
              )}
            </MetricCard>
          </div>
        </section>
      </div>
    </main>
  )
}