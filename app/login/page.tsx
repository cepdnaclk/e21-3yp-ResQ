'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type UserRole = 'student' | 'instructor'

export default function LoginPage() {
  const router = useRouter()
  const [role, setRole] = useState<UserRole>('student')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Mock authentication: validate email and password format
    if (!email || !password) {
      setError('Please enter both email and password')
      setIsLoading(false)
      return
    }

    if (!email.includes('@')) {
      setError('Please enter a valid email address')
      setIsLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setIsLoading(false)
      return
    }

    // Mock successful authentication
    // Clear form
    setEmail('')
    setPassword('')

    // Redirect based on role
    if (role === 'student') {
      router.push('/student/dashboard')
    } else {
      router.push('/dashboard/instructor')
    }
  }

  return (
    <main className="min-h-screen bg-resq-navy flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo Section */}
        <div className="mb-12 flex justify-center">
          <Image
            src="/resq-logo-dark-512.png"
            alt="ResQ - Training Hands, Saving Lives"
            width={200}
            height={120}
            priority
            className="object-contain"
          />
        </div>

        {/* Login Card */}
        <div className="rounded-xl border border-resq-blue bg-medical-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-8 bg-medical-white border-b border-resq-blue/10">
            <h1 className="text-2xl font-semibold text-resq-navy">Welcome</h1>
            <p className="text-resq-navy/60 text-sm mt-1">Enter your credentials to continue</p>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-5">
            {/* Role Selector */}
            <div className="space-y-2">
              <label htmlFor="role" className="block text-sm font-medium text-resq-navy">
                Identity
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole('student')}
                  className={`py-2.5 px-3 rounded-xl font-medium text-sm transition-all border-2 ${
                    role === 'student'
                      ? 'border-resq-blue bg-resq-blue text-white'
                      : 'border-resq-blue/30 bg-transparent text-resq-navy hover:border-resq-blue/50'
                  }`}
                >
                  Student
                </button>
                <button
                  type="button"
                  onClick={() => setRole('instructor')}
                  className={`py-2.5 px-3 rounded-xl font-medium text-sm transition-all border-2 ${
                    role === 'instructor'
                      ? 'border-resq-blue bg-resq-blue text-white'
                      : 'border-resq-blue/30 bg-transparent text-resq-navy hover:border-resq-blue/50'
                  }`}
                >
                  Instructor
                </button>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Email Field */}
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-resq-navy">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-resq-blue/20 bg-medical-white text-resq-navy placeholder-resq-navy/40 transition-colors focus:outline-none focus:border-resq-blue focus:ring-2 focus:ring-resq-blue/20"
                />
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-resq-navy">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-resq-blue/20 bg-medical-white text-resq-navy placeholder-resq-navy/40 transition-colors focus:outline-none focus:border-resq-blue focus:ring-2 focus:ring-resq-blue/20"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </div>
              )}

              {/* Login Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-resq-blue text-white font-semibold transition-all hover:bg-resq-blue/90 hover:shadow-lg hover:shadow-resq-blue/30 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-resq-blue focus:ring-offset-2"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            {/* Demo Hint */}
            <div className="pt-2 border-t border-resq-blue/10">
              <p className="text-xs text-resq-navy/60 text-center">
                Demo credentials: any email with password 6+ characters
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-medical-white/70 mt-8">
          Training Hands, Saving Lives.
        </p>
      </div>
    </main>
  )
}
