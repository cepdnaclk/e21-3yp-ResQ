import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import AuthLayout from "../../layouts/AuthLayout";
import Button from "../../components/ui/Button";

export function SetupFirstAdminPage() {
  const { currentUser, setupFirstAdmin, bootstrap } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // If we already have a user, redirect
    if (currentUser) {
      if (currentUser.role === "TRAINEE") {
        window.location.assign("/trainee");
      } else {
        window.location.assign("/");
      }
    }
  }, [currentUser]);

  useEffect(() => {
    // If backend doesn't require first admin setup (i.e. already has users), redirect to login
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

      // Redirect home upon successful setup
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the administrator account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900">
            Set up Administrator
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            This is the first time running this hub. Create the initial administrator account.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="displayName" className="block text-sm font-semibold text-gray-700">
              Display Name
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
              placeholder="e.g. Dr. Alex Mercer"
            />
          </div>

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
              placeholder="e.g. admin"
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700">
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
              Create Admin Account & Log In
            </Button>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}

export default SetupFirstAdminPage;
