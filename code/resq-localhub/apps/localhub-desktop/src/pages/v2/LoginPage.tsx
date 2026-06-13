import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import AuthLayout from "../../layouts/AuthLayout";
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
    // If the system bootstrap indicates first admin is needed, redirect there
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
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900">
            Sign in to ResQ
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your local hub account to access training courses.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="username" className="block text-sm font-semibold text-gray-700">
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
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
              placeholder="e.g. nurse_smith"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
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
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 border border-red-200">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          )}

          <div>
            <Button
              type="submit"
              loading={busy}
              className="w-full flex justify-center py-2"
            >
              Sign In
            </Button>
          </div>
        </form>

        <div className="text-center text-xs text-gray-400 mt-4">
          Local-only secure environment.
        </div>
      </div>
    </AuthLayout>
  );
}

export default LoginPage;
