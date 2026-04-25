"use client"

import { useEffect, useState } from 'react'
import type { HubHealth } from '@/lib/hubTypes'

const initialState: HubHealth = {
  backendHealth: 'loading',
  message: 'Checking local hub status...',
}

export default function HealthBanner() {
  const [health, setHealth] = useState<HubHealth>(initialState)

  useEffect(() => {
    let cancelled = false

    const loadHealth = async () => {
      try {
        const response = await fetch('/api/hub/health', { cache: 'no-store' })
        const data = await response.json()

        if (!cancelled) {
          setHealth({
            backendHealth: response.ok ? data.backendHealth ?? 'online' : 'error',
            message: response.ok ? data.message ?? 'Local hub online.' : data.message ?? 'Unable to read hub status.',
            responseTimeMs: data.responseTimeMs,
            lastCheckedAt: data.lastCheckedAt,
          })
        }
      } catch {
        if (!cancelled) {
          setHealth({
            backendHealth: 'error',
            message: 'Unable to reach the local hub health endpoint.',
          })
        }
      }
    }

    void loadHealth()
    const intervalId = window.setInterval(loadHealth, 5000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const toneClasses = {
    loading: 'border-slate-200 bg-slate-50 text-slate-700',
    online: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    offline: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
  }[health.backendHealth]

  const dotClasses = {
    loading: 'bg-slate-400',
    online: 'bg-emerald-500',
    offline: 'bg-amber-500',
    error: 'bg-rose-500',
  }[health.backendHealth]

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClasses}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${dotClasses}`} aria-hidden />
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em]">Backend Health</div>
            <div className="text-sm opacity-90">{health.message}</div>
          </div>
        </div>
        <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-80">
          {health.backendHealth}
          {typeof health.responseTimeMs === 'number' ? ` · ${health.responseTimeMs} ms` : ''}
        </div>
      </div>
    </div>
  )
}