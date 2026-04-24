export const mockSession = {
  deviceId: 'manikin-03',
  sessionStatus: 'SESSION_ACTIVE',
  topics: {
    telemetry: 'resq/manikins/manikin-03/telemetry',
    events: 'resq/manikins/manikin-03/events',
    status: 'resq/manikins/manikin-03/status',
    heartbeat: 'resq/manikins/manikin-03/heartbeat',
  },
  averageDepth: 52,
  rate: 110,
  recoilAccuracy: 94,
  pressure: 42,
  timeElapsedSeconds: 120,
  handPlacementAccuracy: 73,
  incompleteRecoil: 12,
  longestPause: 3.1,
  handsOffTime: 12.6,
  pausesDetected: 5,
  handPlacement: {
    errorAtCenterMm: 4,
    offCenterStreaks: 3,
    angleTiltIndicator: 2,
  },
  finalVerdict: {
    status: 'PASS',
    score: 92,
  },
  performance: {
    depth: [2.1, 2.8, 3.2, 2.9, 3.0, 3.3, 2.7],
    rate: [110, 108, 112, 115, 109],
    pauses: [0, 1, 0, 2, 0],
  },
  compressions: [
    51.6, 51.5, 51.7, 54.1, 51.6, 47.5, 53, 51.2, 51.3, 52.3, 52.7, 55.5, 54, 52.3, 49.8, 49, 52.7, 55.9, 52.1, 51.7, 53.6, 47.6, 51.1, 53.5, 54.6, 51.3, 53.1, 52.7, 54.3, 48.7, 53.7, 47.5, 45, 50.2, 49.3, 54.6, 54, 48.3, 54.5, 49, 51.7, 51.1, 52.3, 54.5, 53.9, 53, 53.9, 53.4, 50.1, 49.8, 50.6, 53.5, 51.2, 59, 49.5, 48.7, 54.3, 56.3, 53.5, 54.5, 56.3, 51.7, 47.7, 50.4, 54.9, 47.7, 52.1, 52.8, 51.1, 54.2, 53.7, 59, 53.9, 50.2, 50.3, 49.5, 54.9, 50.3, 51.8, 54.2, 49.8, 51.1, 46.5, 48.8, 50.3, 53.2, 55.6, 51.9, 52.8, 52.5, 55.3, 54.7, 52.8, 49, 54.7, 53.1, 55.7, 51.9, 57.9, 50.9,
  ],
} as const
