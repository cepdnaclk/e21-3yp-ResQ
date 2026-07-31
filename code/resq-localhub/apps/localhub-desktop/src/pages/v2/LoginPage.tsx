import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import Button from "../../components/ui/Button";
import { fetchHubHealth } from "../../lib/tauriApi";

type ConnectionState = "checking" | "connected" | "unavailable";

const invalidCredentialsMessage = "Incorrect username or password. Please try again.";
const unexpectedAuthMessage = "We could not sign you in. Please try again.";

function getAuthenticationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("incorrect") ||
    normalized.includes("invalid") ||
    normalized.includes("unauthorized") ||
    normalized.includes("bad credentials") ||
    normalized.includes("401")
  ) {
    return invalidCredentialsMessage;
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("health request")
  ) {
    return "LocalHub service unavailable. Start the LocalHub services and try again.";
  }

  return unexpectedAuthMessage;
}

export function LoginPage() {
  const { currentUser, login, bootstrap } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [connectionMessage, setConnectionMessage] = useState("Checking LocalHub connection...");

  const canSubmit = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && !busy;
  }, [busy, password, username]);

  const checkConnection = useCallback(async () => {
    setConnectionState("checking");
    setConnectionMessage("Checking LocalHub connection...");

    try {
      const health = await fetchHubHealth();
      if (health.ok) {
        setConnectionState("connected");
        setConnectionMessage("Connected to LocalHub");
      } else {
        setConnectionState("unavailable");
        setConnectionMessage("LocalHub service unavailable. Start the LocalHub services and try again.");
      }
    } catch {
      setConnectionState("unavailable");
      setConnectionMessage("LocalHub service unavailable. Start the LocalHub services and try again.");
    }
  }, []);

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

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (!username.trim() || !password) {
        throw new Error("Please enter both username and password.");
      }

      await login({ username, password });
      window.location.assign("/");
    } catch (err) {
      setError(getAuthenticationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function updateCapsLockState(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(event.getModifierState("CapsLock"));
  }

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden bg-slate-50 font-sans text-slate-900 md:flex">
      {/* Left Branding Panel */}
      <aside className="flex min-h-[220px] flex-col justify-between bg-[#0a232c] px-6 py-7 text-white sm:px-8 md:min-h-screen md:basis-[41%] md:px-10 md:py-10 xl:px-14">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 p-2 shadow-sm shadow-teal-950/20">
            <img src="/resq-logo-dark-512.png" alt="ResQ" className="h-full w-full object-contain brightness-0 invert" />
          </div>
          <div>
            <p className="text-base font-bold leading-none text-white">ResQ</p>
            <p className="mt-1 text-sm font-medium leading-tight text-teal-200">Local CPR Training System</p>
          </div>
        </div>

        <div className="my-8 max-w-md space-y-5 md:my-auto">
          <h1 className="text-[32px] font-bold leading-tight text-white sm:text-4xl md:text-[34px]">
            Manage CPR Training Locally
          </h1>
          <p className="max-w-[36rem] text-base leading-7 text-slate-200 md:max-w-sm">
            Monitor connected manikins, supervise live sessions, and review trainee performance&mdash;all from the local training network.
          </p>
        </div>

        <footer className="text-sm leading-6 text-slate-300">
          <p className="font-semibold text-white">ResQ</p>
          <p>Local CPR Training System</p>
        </footer>
      </aside>

      {/* Right Login Panel */}
      <main className="flex min-h-[calc(100vh-220px)] flex-1 items-start justify-center bg-slate-50 px-5 py-8 sm:px-8 md:min-h-screen md:basis-[59%] md:px-10 md:pt-[18vh] lg:px-14">
        <section className="w-full max-w-[460px] rounded-2xl border border-slate-200/70 bg-white p-8 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-10">
          <div className="mb-8 space-y-2 text-left">
            <h2 className="text-[28px] font-bold leading-tight text-slate-900">
              Welcome back
            </h2>
            <p className="text-base leading-6 text-slate-500">
              Sign in to continue to ResQ LocalHub.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-medium text-slate-700">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                value={username}
                disabled={busy}
                onChange={(e) => setUsername(e.target.value)}
                className="block h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 text-[15px] font-medium text-slate-900 transition-colors placeholder:text-slate-400 hover:bg-slate-50 focus:border-teal-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="admin"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => {
                    setPasswordFocused(true);
                  }}
                  onBlur={() => {
                    setPasswordFocused(false);
                    setCapsLockOn(false);
                  }}
                  onKeyDown={updateCapsLockState}
                  onKeyUp={updateCapsLockState}
                  className="block h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-4 pr-24 text-[15px] font-medium text-slate-900 transition-colors placeholder:text-slate-400 hover:bg-slate-50 focus:border-teal-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={busy}
                  className="absolute right-2 top-1/2 h-8 -translate-y-1/2 rounded-lg px-3 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {passwordFocused && capsLockOn ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800" aria-live="polite">
                  Caps Lock is on.
                </p>
              ) : null}
            </div>

            {error ? (
              <div role="alert" aria-live="assertive" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium leading-6 text-rose-800">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              loading={busy}
              disabled={!canSubmit}
              className="mt-1 h-12 w-full text-base font-bold"
            >
              {busy ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div
            className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
            role={connectionState === "unavailable" ? "alert" : "status"}
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                {connectionState === "connected" ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
                ) : connectionState === "checking" ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden="true" />
                )}
                {connectionState === "connected" ? "Connected to LocalHub" : connectionMessage}
              </p>
              {connectionState === "unavailable" ? (
                <button
                  type="button"
                  onClick={() => void checkConnection()}
                  className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
                >
                  Retry connection
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default LoginPage;
