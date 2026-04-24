export interface LiveTelemetry {
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

export interface HubHealth {
  backendHealth: 'loading' | 'online' | 'offline' | 'error'
  message: string
  responseTimeMs?: number
  lastCheckedAt?: string
}

export interface ActiveSession {
  sessionId: string
  manikinId: string
  traineeId: string
  startedAt: string
  endedAt?: string | null
  status: 'active' | 'ended'
}

export interface SessionSummary {
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
  handPlacementPct?: number
  pausesDetected?: number
  longestPauseSec?: number
}