import { mockSession } from './mockSession'

/** Session metrics with pressure (derived/mock for dashboard display) */
export const studentSessionMetrics = {
  ...mockSession,
  pressure: 42, // force in kg (mock value for display)
  timeElapsedSeconds: 120,
} as const

/** Recoil status from recoilAccuracy */
export function getRecoilStatus(recoilAccuracy: number): 'Full Recoil' | 'Incomplete' {
  return recoilAccuracy >= 90 ? 'Full Recoil' : 'Incomplete'
}

/** Mock list of students currently performing (for instructor dashboard) */
export const mockLiveStudents = [
  {
    id: '1',
    name: 'Alex Chen',
    live: true,
    averageDepth: 52,
    pressure: 42,
    recoilAccuracy: 94,
    timeElapsedSeconds: 120,
  },
  {
    id: '2',
    name: 'Jordan Smith',
    live: true,
    averageDepth: 48,
    pressure: 38,
    recoilAccuracy: 82,
    timeElapsedSeconds: 95,
  },
  {
    id: '3',
    name: 'Sam Rivera',
    live: true,
    averageDepth: 55,
    pressure: 46,
    recoilAccuracy: 96,
    timeElapsedSeconds: 145,
  },
  {
    id: '4',
    name: 'Casey Lee',
    live: true,
    averageDepth: 51,
    pressure: 41,
    recoilAccuracy: 91,
    timeElapsedSeconds: 88,
  },
  {
    id: '5',
    name: 'Riley Brown',
    live: true,
    averageDepth: 47,
    pressure: 39,
    recoilAccuracy: 78,
    timeElapsedSeconds: 110,
  },
] as const

export type LiveStudent = (typeof mockLiveStudents)[number]
