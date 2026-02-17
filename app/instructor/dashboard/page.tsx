'use client'

import { useState } from 'react'
import Link from 'next/link'
import { mockLiveStudents, getRecoilStatus, type LiveStudent } from '../../data/mockDashboard'

function StudentCard({
  student,
  onClick,
}: {
  student: LiveStudent
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-resq-blue hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-resq-blue focus:ring-offset-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-resq-navy">{student.name}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Live
        </span>
      </div>
    </button>
  )
}

function StudentDetailModal({
  student,
  onClose,
}: {
  student: LiveStudent
  onClose: () => void
}) {
  const recoilStatus = getRecoilStatus(student.recoilAccuracy)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-detail-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="student-detail-title" className="text-lg font-semibold text-resq-navy">
            {student.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-resq-blue"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-slate-600">Depth</span>
            <span className="font-semibold text-resq-navy">{student.averageDepth} mm</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-slate-600">Pressure</span>
            <span className="font-semibold text-resq-navy">{student.pressure} kg</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-slate-600">Recoil</span>
            <span className="font-semibold text-resq-navy">{recoilStatus}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-slate-600">Time elapsed</span>
            <span className="font-semibold text-resq-navy">{student.timeElapsedSeconds} s</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InstructorDashboardPage() {
  const [selectedStudent, setSelectedStudent] = useState<LiveStudent | null>(null)

  return (
    <main className="min-h-screen bg-[#f8fafc]">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <h1 className="text-2xl font-semibold text-resq-navy">Instructor dashboard</h1>
          <Link
            href="/"
            className="text-sm text-resq-blue hover:underline font-medium"
          >
            ← Back to login
          </Link>
        </header>

        <p className="text-slate-600 mb-6">
          Students currently performing. Click a card to view full session details.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockLiveStudents.map((student) => (
            <StudentCard
              key={student.id}
              student={student}
              onClick={() => setSelectedStudent(student)}
            />
          ))}
        </div>

        {selectedStudent && (
          <StudentDetailModal
            student={selectedStudent}
            onClose={() => setSelectedStudent(null)}
          />
        )}
      </div>
    </main>
  )
}
