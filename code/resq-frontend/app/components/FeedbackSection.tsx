'use client'

import { mockSession } from '../data/mockSession'

const TARGET_MIN = 50
const TARGET_MAX = 60
const HIGH_ACCURACY_THRESHOLD = 85 // recoil % considered "high"
const TARGET_ZONE_RATIO = 0.5 // % of compressions in 50-60mm for "excellent"
const SHALLOW_AVG_MM = 50 // average depth below this = shallow

type SessionData = {
  averageDepth: number
  recoilAccuracy: number
  compressions: readonly number[]
}

function getTargetZonePercent(compressions: readonly number[]): number {
  if (compressions.length === 0) return 0
  const inZone = compressions.filter((d) => d >= TARGET_MIN && d < TARGET_MAX).length
  return (inZone / compressions.length) * 100
}

function getFeedbackMessages(session: SessionData): { type: 'success' | 'improve'; text: string }[] {
  const messages: { type: 'success' | 'improve'; text: string }[] = []
  const targetPercent = getTargetZonePercent(session.compressions)
  const isHighAccuracy =
    session.recoilAccuracy >= HIGH_ACCURACY_THRESHOLD && targetPercent >= TARGET_ZONE_RATIO * 100
  const isShallow = session.averageDepth < SHALLOW_AVG_MM

  if (isHighAccuracy) {
    messages.push({ type: 'success', text: 'Excellent consistency!' })
  }
  if (isShallow) {
    messages.push({
      type: 'improve',
      text: 'Focus on pressing deeper in your next session.',
    })
  }
  if (!isHighAccuracy && !isShallow) {
    messages.push({
      type: 'improve',
      text: 'Aim to keep more compressions in the 50–60 mm target zone for better consistency.',
    })
  }
  return messages
}

export default function FeedbackSection() {
  const messages = getFeedbackMessages(mockSession)

  if (messages.length === 0) return null

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-800 mb-3">Feedback</h2>
      <ul className="space-y-2">
        {messages.map((m, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 text-sm ${
              m.type === 'success'
                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                : 'text-amber-800 bg-amber-50 border border-amber-200'
            } rounded-lg px-3 py-2`}
          >
            <span
              className="shrink-0 mt-0.5"
              aria-hidden
            >
              {m.type === 'success' ? '✓' : '→'}
            </span>
            <span>{m.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
