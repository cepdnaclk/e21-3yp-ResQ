"use client"

import type { LiveTelemetry } from '@/lib/hubTypes'

type Props = {
  telemetry: LiveTelemetry[]
  loading: boolean
  error: string | null
  activeManikinId: string | null
  selectedManikinId: string | null
  onSelectManikin: (manikinId: string) => void
}

function statusTone(status: string) {
  if (status === 'online') {
    return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  }

  if (status === 'degraded') {
    return 'bg-amber-100 text-amber-800 border-amber-200'
  }

  return 'bg-rose-100 text-rose-800 border-rose-200'
}

function batteryTone(level: number) {
  if (level >= 70) return 'text-emerald-700'
  if (level >= 40) return 'text-amber-700'
  return 'text-rose-700'
}

export default function ManikinGrid({
  telemetry,
  loading,
  error,
  activeManikinId,
  selectedManikinId,
  onSelectManikin,
}: Props) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Live Multi-Manikin Grid</h2>
          <p className="mt-1 text-sm text-slate-500">Tile view for live telemetry, battery, and connection state.</p>
        </div>
        <div className="text-sm text-slate-500">
          {loading ? 'Refreshing telemetry...' : `${telemetry.length} manikins online`}
        </div>
      </div>

      {error && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {telemetry.map((item) => {
          const isActive = item.manikinId === activeManikinId
          const isSelected = item.manikinId === selectedManikinId

          return (
            <button
              key={item.manikinId}
              type="button"
              onClick={() => onSelectManikin(item.manikinId)}
              className={`relative rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                isActive
                  ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200'
                  : isSelected
                    ? 'border-sky-300 bg-sky-50 ring-2 ring-sky-100'
                    : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.manikinName ?? item.manikinId}</div>
                  <div className="text-xs text-slate-500">{item.manikinId}</div>
                </div>
                {isActive && (
                  <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                    Active session
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusTone(item.connectionStatus)}`}>
                  {item.connectionStatus}
                </span>
                <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${batteryTone(item.batteryLevel)}`}>
                  Battery {item.batteryLevel}%
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-white/80 p-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Depth</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{item.depthMm} mm</dd>
                </div>
                <div className="rounded-xl bg-white/80 p-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Rate</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{item.rateCpm} /min</dd>
                </div>
                <div className="rounded-xl bg-white/80 p-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Recoil</dt>
                  <dd className={`mt-1 font-semibold ${item.recoilOk ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {item.recoilOk ? 'OK' : 'Check'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-white px-2.5 py-1">Pauses: {item.pauses}</span>
                <span className="rounded-full bg-white px-2.5 py-1">Last update: {new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>

              {item.flags?.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {item.flags.map((flag) => (
                    <span key={flag} className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white">
                      {flag}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}