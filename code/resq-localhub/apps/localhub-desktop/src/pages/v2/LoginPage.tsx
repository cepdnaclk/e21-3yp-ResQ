import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import Button from "../../components/ui/Button";

export function LoginPage() {
  const { currentUser, login, bootstrap } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    if (bootstrap?.requiresFirstAdmin) {
      window.location.assign("/setup");
    }
  }, [bootstrap]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (!username.trim() || !password) {
        throw new Error("Please enter both username and password.");
      }

      await login({ username, password });
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Access denied. Please check your credentials.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans">
      {/* Left Branding Panel */}
      <div className="hidden md:flex md:w-1/2 bg-[#0a232c] flex-col justify-between p-12 text-white relative overflow-hidden">
        {/* Parallax background glow */}
        <div className="absolute -left-1/4 -top-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -right-1/4 -bottom-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center p-2 shadow-md shadow-teal-500/10">
            <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-white leading-none">ResQ</h1>
            <p className="text-[10px] text-teal-400 font-extrabold uppercase tracking-widest mt-0.5">CPR Training Suite</p>
          </div>
        </div>

        <div className="space-y-4 max-w-md my-auto relative z-10">
          <h2 className="text-3xl font-black tracking-tight leading-tight text-white">
            Supervise Live CPR Training from a Local Station.
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed font-normal">
            Verify chest compression depth, monitor real-time rate, and calculate recoil percentages. Keep track of course records and manage certifications effortlessly.
          </p>
        </div>

        <div className="text-xs text-slate-500 relative z-10">
          © ResQ Medical Training Hub. All rights reserved.
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="flex-1 flex items-center justify-center p-8 sm:p-12 bg-slate-50">
        <div className="w-full max-w-md bg-white border border-slate-100 p-8 sm:p-10 rounded-3xl shadow-[0_10px_30px_rgba(15,23,42,0.02)] space-y-6">
          <div className="text-center md:text-left space-y-1">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-none">
              Sign In
            </h2>
            <p className="text-xs text-slate-400 font-normal leading-relaxed">
              Enter your clinical account credentials to access course dashboards.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
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
                placeholder="e.g. nurse_smith"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs font-semibold text-rose-700 leading-normal">
                {error}
              </div>
            )}

            <Button
              type="submit"
              loading={busy}
              className="w-full py-3 mt-2 font-bold"
            >
              Sign In
            </Button>
          </form>

          <div className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2">
            🛡 Secure Local-Only Host Connection
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
