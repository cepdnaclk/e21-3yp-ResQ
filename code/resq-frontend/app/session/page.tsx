'use client'

import Link from 'next/link'
import CompressionDepthChart from '../components/CompressionDepthChart'
import CompressionDepthFrequencyChart from '../components/CompressionDepthFrequencyChart'
import FeedbackSection from '../components/FeedbackSection'

export default function SessionPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-800">Session summary</h1>
          <Link
            href="/"
            className="text-sm text-resq-blue hover:underline font-medium"
          >
            ← Back to login
          </Link>
        </header>

        <FeedbackSection />

        <section>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Compression depth over time</h2>
          <p className="text-sm text-slate-600 mb-4">
            From mockSession — target zone 50–60 mm shaded.
          </p>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <CompressionDepthChart />
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Depth consistency</h2>
          <p className="text-sm text-slate-600 mb-4">
            Frequency of compression depths by range. Aim for most compressions in the 50–60 mm target zone.
          </p>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <CompressionDepthFrequencyChart />
          </div>
        </section>
      </div>
    </main>
  )
}
