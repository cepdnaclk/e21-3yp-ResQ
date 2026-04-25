import { useEffect, useMemo, useState } from 'react'

type UserRole = 'student' | 'instructor'

type AuthResult = {
  success?: boolean
  redirectTo?: string
  error?: string
  student?: {
    studentId: string
    email: string
    name?: string | null
  }
}

type HubHealth = {
  backendHealth: 'loading' | 'online' | 'offline' | 'error'
  message: string
  responseTimeMs?: number
  lastCheckedAt?: string
}

type LiveTelemetry = {
  manikinId: string
  manikinName?: string
  timestamp: string
  depthMm: number
  rateCpm: number
  recoilOk: boolean
  pauses: number
  batteryLevel: number
  connectionStatus: string
  flags?: string[]
}

type ActiveSession = {
  sessionId: string
  manikinId: string
  traineeId: string
  startedAt: string
  endedAt?: string | null
  status: 'active' | 'ended'
}

type SessionSummary = {
  sessionId: string
  manikinId: string
  traineeId: string
  startedAt: string
  endedAt: string
  sampleCount: number
  avgDepthMm: number
  avgRateCpm: number
  recoilOkPct: number
  compliancePct?: number
  pausesDetected?: number
  longestPauseSec?: number
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload?.error ?? 'Request failed.'
    throw new Error(message)
  }

  return payload as T
}

function toDateLabel(value: string) {
  return new Date(value).toLocaleString()
}

export default function App() {
  const [role, setRole] = useState<UserRole>('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [studentId, setStudentId] = useState('')
  const [loginError, setLoginError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [health, setHealth] = useState<HubHealth>({ backendHealth: 'loading', message: 'Checking hub status...' })
  const [telemetry, setTelemetry] = useState<LiveTelemetry[]>([])
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [selectedManikinId, setSelectedManikinId] = useState<string | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')

  useEffect(() => {
    if (!loggedIn) return

    let cancelled = false

    const loadAll = async () => {
      try {
        const [healthData, liveData, activeData, summaryData] = await Promise.all([
          requestJson<HubHealth>('/api/hub/health'),
          requestJson<LiveTelemetry[]>('/api/mock/live'),
          requestJson<{ activeSession: ActiveSession | null }>('/api/mock/session/active'),
          requestJson<SessionSummary | null>('/api/mock/session/last-summary'),
        ])

        if (cancelled) return

        setHealth(healthData)
        setTelemetry(liveData)
        setActiveSession(activeData.activeSession)
        setSummary(summaryData)
        setSelectedManikinId((current) => current ?? activeData.activeSession?.manikinId ?? liveData[0]?.manikinId ?? null)
      } catch (error) {
        if (!cancelled) {
          setHealth({ backendHealth: 'error', message: error instanceof Error ? error.message : 'Unable to load hub data.' })
        }
      }
    }

    void loadAll()
    const intervalId = window.setInterval(loadAll, 5000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [loggedIn])

  useEffect(() => {
    if (activeSession?.manikinId) {
      setSelectedManikinId(activeSession.manikinId)
    }
  }, [activeSession?.manikinId])

  const selectedTelemetry = useMemo(
    () => telemetry.find((item) => item.manikinId === selectedManikinId) ?? null,
    [telemetry, selectedManikinId]
  )

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setLoginError('')

    try {
      const result = await requestJson<AuthResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ role, email, password, studentId }),
      })

      if (!result.success) {
        throw new Error(result.error ?? 'Login failed.')
      }

      setLoggedIn(true)
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to log in.')
    } finally {
      setBusy(false)
    }
  }

  const handleStartSession = async () => {
    setSessionMessage('')
    try {
      const result = await requestJson<{ activeSession: ActiveSession }>('/api/mock/session/start', {
        method: 'POST',
        body: JSON.stringify({ manikinId: selectedManikinId, traineeId: 'trainee-local' }),
      })
      setActiveSession(result.activeSession)
      setSessionMessage('Session started.')
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : 'Unable to start session.')
    }
  }

  const handleEndSession = async () => {
    if (!activeSession) return
    setSessionMessage('')
    try {
      const result = await requestJson<{ activeSession: ActiveSession; summary: SessionSummary }>('/api/mock/session/end', {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession.sessionId }),
      })
      setActiveSession(null)
      setSummary(result.summary)
      setSessionMessage('Session ended and summary saved.')
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : 'Unable to end session.')
    }
  }

  if (!loggedIn) {
    return (
      <main className="shell">
        <section className="card auth-card">
          <div className="auth-copy">
            <p className="eyebrow">ResQ Training Hub</p>
            <h1>Welcome</h1>
            <p>React + Vite frontend with a Spring Boot API and real database-backed data.</p>
          </div>

          <form className="stack" onSubmit={handleLogin}>
            <div className="toggle-row">
              <button type="button" className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>Student</button>
              <button type="button" className={role === 'instructor' ? 'active' : ''} onClick={() => setRole('instructor')}>Instructor</button>
            </div>

            {role === 'student' && (
              <label>
                Student ID
                <input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="EG/2020/0001" />
              </label>
            )}

            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>

            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </label>

            {loginError && <div className="error-box">{loginError}</div>}

            <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign In'}</button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="shell dashboard">
      <header className="card header-card">
        <div>
          <p className="eyebrow">Backend Health</p>
          <h1>Instructor Dashboard</h1>
          <p>{health.message}</p>
        </div>
        <div className="pill">{health.backendHealth}{typeof health.responseTimeMs === 'number' ? ` · ${health.responseTimeMs} ms` : ''}</div>
      </header>

      <section className="grid-2">
        <div className="card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Live Multi-Manikin Grid</p>
              <h2>{telemetry.length} manikins online</h2>
            </div>
          </div>

          <div className="manikin-grid">
            {telemetry.map((item) => (
              <button key={item.manikinId} type="button" className={`manikin ${item.manikinId === selectedManikinId ? 'selected' : ''}`} onClick={() => setSelectedManikinId(item.manikinId)}>
                <strong>{item.manikinName ?? item.manikinId}</strong>
                <span>{item.manikinId}</span>
                <span>{item.connectionStatus}</span>
                <span>Battery {item.batteryLevel}%</span>
                <span>Depth {item.depthMm} mm</span>
                <span>Rate {item.rateCpm} /min</span>
                <span>Recoil {item.recoilOk ? 'OK' : 'Check'}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Session Control</p>
                <h2>{activeSession ? 'Active session' : 'No live session'}</h2>
              </div>
            </div>
            <p>{selectedTelemetry ? `Selected: ${selectedTelemetry.manikinName ?? selectedTelemetry.manikinId}` : 'Select a manikin to start.'}</p>
            <div className="row-actions">
              <button type="button" onClick={handleStartSession} disabled={!selectedManikinId || Boolean(activeSession)}>Start Session</button>
              <button type="button" onClick={handleEndSession} disabled={!activeSession}>End Session</button>
            </div>
            {activeSession && (
              <div className="meta-block">
                <div><strong>Session</strong><span>{activeSession.sessionId}</span></div>
                <div><strong>Started</strong><span>{toDateLabel(activeSession.startedAt)}</span></div>
              </div>
            )}
            {sessionMessage && <div className="info-box">{sessionMessage}</div>}
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Latest Summary</p>
                <h2>{summary ? summary.sessionId : 'No summary yet'}</h2>
              </div>
            </div>
            {summary ? (
              <div className="summary-list">
                <div><span>Avg depth</span><strong>{summary.avgDepthMm} mm</strong></div>
                <div><span>Avg rate</span><strong>{summary.avgRateCpm} /min</strong></div>
                <div><span>Recoil OK</span><strong>{summary.recoilOkPct}%</strong></div>
                <div><span>Compliance</span><strong>{summary.compliancePct ?? 0}%</strong></div>
              </div>
            ) : (
              <p>No session summary available.</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  )
}
