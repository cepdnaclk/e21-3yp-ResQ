import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";

export function SetupFirstAdminPage() {
  const { currentUser, setupFirstAdmin, bootstrap } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === "TRAINEE") {
        window.location.assign("/trainee");
      } else {
        window.location.assign("/");
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (bootstrap && !bootstrap.requiresFirstAdmin) {
      window.location.assign("/login");
    }
  }, [bootstrap]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (!username.trim() || !displayName.trim() || !password) {
        throw new Error("All fields are required to setup the administrator account.");
      }

      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      await setupFirstAdmin({
        username,
        displayName,
        password,
      });

      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the administrator account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6f8] flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-xl space-y-6">
        {/* Wizard Branding */}
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center p-2 mx-auto shadow-md shadow-teal-500/10">
            <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-none mt-2">
            ResQ Configuration Wizard
          </h2>
          <p className="text-xs text-slate-400 font-normal leading-relaxed max-w-sm mx-auto">
            This is the first time running this hub server. Follow the steps below to setup the clinical system.
          </p>
        </div>

        {/* Progress Tracker */}
        <div className="bg-white border border-slate-100/80 rounded-2xl p-5 shadow-[0_4px_16px_rgba(0,0,0,0.01)]">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span className="text-teal-600">1. Admin Credentials</span>
            <span>2. System Launch</span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-teal-600 h-full w-1/2 rounded-full transition-all duration-300" />
          </div>
        </div>

        {/* Credentials Wizard Form Card */}
        <Card className="shadow-[0_8px_30px_rgba(15,23,42,0.02)] border border-slate-100 p-8 sm:p-10 rounded-3xl">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-800 tracking-tight">Step 1: Admin Configuration</h3>
            <p className="text-xs text-slate-400 mt-1">Configure username credentials for the system administrator.</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="displayName" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Display Name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                  placeholder="e.g. Dr. Jane Smith"
                />
              </div>

              <div>
                <label htmlFor="username" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                  placeholder="e.g. admin"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="password" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-100 text-xs font-semibold text-rose-700 leading-normal">
                {error}
              </div>
            )}

            <Button
              type="submit"
              loading={busy}
              className="w-full py-3 mt-2 font-bold"
            >
              Create Account & Start System
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default SetupFirstAdminPage;
