import { useState, type FormEvent } from "react";
import { loginCloudUser } from "../api/cloudApi";
import { saveAuthSession, type CloudAuthSession } from "../auth/authStorage";

export function LoginPage({ onLogin }: { onLogin: (session: CloudAuthSession) => void }) {
  const [email, setEmail] = useState("admin@resq.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const session = await loginCloudUser(email.trim(), password);
      saveAuthSession(session);
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-card">
        <p className="eyebrow">Local cloud access</p>
        <h1>Sign in to ResQ Cloud Review</h1>
        <p>Use a local cloud account to review synced training records.</p>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button" disabled={isLoading}>
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <small>Local development authentication only. No AWS or Cognito is used.</small>
      </section>
    </div>
  );
}
