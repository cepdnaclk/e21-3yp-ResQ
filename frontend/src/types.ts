export type UserRole = 'student' | 'instructor'

export type HubHealth = {
  backendHealth: 'loading' | 'online' | 'offline' | 'error'
  message: string
  responseTimeMs?: number
  lastCheckedAt?: string
}

export type LiveTelemetry = {
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

export type ActiveSession = {
  sessionId: string
  manikinId: string
  traineeId: string
  startedAt: string
  endedAt?: string | null
  status: 'active' | 'ended'
}

export type SessionSummary = {
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
