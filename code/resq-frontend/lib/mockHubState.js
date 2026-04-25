const nowIso = () => new Date().toISOString()

const liveTelemetrySeed = [
  {
    manikinId: 'manikin-01',
    manikinName: 'Manikin Alpha',
    timestamp: nowIso(),
    depthMm: 52,
    rateCpm: 110,
    recoilOk: true,
    pauses: 1,
    batteryLevel: 87,
    connectionStatus: 'online',
    flags: ['On target'],
  },
  {
    manikinId: 'manikin-02',
    manikinName: 'Manikin Bravo',
    timestamp: nowIso(),
    depthMm: 47,
    rateCpm: 103,
    recoilOk: false,
    pauses: 3,
    batteryLevel: 64,
    connectionStatus: 'online',
    flags: ['Depth low', 'Recoil lag'],
  },
  {
    manikinId: 'manikin-03',
    manikinName: 'Manikin Charlie',
    timestamp: nowIso(),
    depthMm: 55,
    rateCpm: 114,
    recoilOk: true,
    pauses: 0,
    batteryLevel: 92,
    connectionStatus: 'online',
    flags: ['Stable'],
  },
  {
    manikinId: 'manikin-04',
    manikinName: 'Manikin Delta',
    timestamp: nowIso(),
    depthMm: 49,
    rateCpm: 98,
    recoilOk: false,
    pauses: 2,
    batteryLevel: 38,
    connectionStatus: 'degraded',
    flags: ['Battery low'],
  },
]

let sessionSequence = 3

let activeSession = {
  sessionId: 'session-1024',
  manikinId: 'manikin-03',
  traineeId: 'trainee-0007',
  startedAt: '2026-04-23T09:15:00.000Z',
  endedAt: null,
  status: 'active',
}

let lastSummary = {
  sessionId: 'session-1023',
  manikinId: 'manikin-03',
  traineeId: 'trainee-0007',
  startedAt: '2026-04-23T08:45:00.000Z',
  endedAt: '2026-04-23T09:00:00.000Z',
  sampleCount: 128,
  avgDepthMm: 52,
  avgRateCpm: 110,
  recoilOkPct: 94,
  compliancePct: 88,
  handPlacementPct: 73,
  pausesDetected: 5,
  longestPauseSec: 3.1,
}

function computeHealth() {
  return {
    backendHealth: 'online',
    message: 'Local hub online and serving mock telemetry.',
    responseTimeMs: 18,
    lastCheckedAt: nowIso(),
  }
}

function enrichTelemetry() {
  return liveTelemetrySeed.map((item) => ({
    ...item,
    timestamp: nowIso(),
    flags: activeSession?.manikinId === item.manikinId ? ['Active session', ...(item.flags ?? [])] : item.flags,
  }))
}

function getActiveSession() {
  return activeSession
}

function getLastSummary() {
  return lastSummary
}

function startSession({ manikinId, traineeId }) {
  sessionSequence += 1

  const nextSession = {
    sessionId: `session-${1000 + sessionSequence}`,
    manikinId: manikinId || 'manikin-01',
    traineeId: traineeId || 'trainee-local',
    startedAt: nowIso(),
    endedAt: null,
    status: 'active',
  }

  activeSession = nextSession

  return nextSession
}

function endSession({ sessionId } = {}) {
  if (!activeSession) {
    return null
  }

  if (sessionId && sessionId !== activeSession.sessionId) {
    return null
  }

  const activeTelemetry = liveTelemetrySeed.find((item) => item.manikinId === activeSession.manikinId) ?? liveTelemetrySeed[0]
  const endedAt = nowIso()

  lastSummary = {
    sessionId: activeSession.sessionId,
    manikinId: activeSession.manikinId,
    traineeId: activeSession.traineeId,
    startedAt: activeSession.startedAt,
    endedAt,
    sampleCount: 128,
    avgDepthMm: activeTelemetry.depthMm,
    avgRateCpm: activeTelemetry.rateCpm,
    recoilOkPct: activeTelemetry.recoilOk ? 94 : 78,
    compliancePct: activeTelemetry.recoilOk ? 89 : 71,
    handPlacementPct: activeTelemetry.connectionStatus === 'degraded' ? 68 : 82,
    pausesDetected: activeTelemetry.pauses,
    longestPauseSec: activeTelemetry.pauses ? Number((activeTelemetry.pauses * 0.9 + 1).toFixed(1)) : 0,
  }

  activeSession = {
    ...activeSession,
    endedAt,
    status: 'ended',
  }

  const closedSession = activeSession
  activeSession = null

  return { activeSession: closedSession, summary: lastSummary }
}

module.exports = {
  computeHealth,
  enrichTelemetry,
  endSession,
  getActiveSession,
  getLastSummary,
  startSession,
}