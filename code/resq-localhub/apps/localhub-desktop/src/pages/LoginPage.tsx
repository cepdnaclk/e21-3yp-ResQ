import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CreateFirstAdminRequest, LoginRequest, UserRole } from "@resq/shared";
import { useAuth } from "../auth/AuthContext";

type LoginPageProps = {
  firstRunRequired?: boolean;
};

type FormMode = "login" | "setup";

export default function LoginPage({ firstRunRequired = false }: LoginPageProps) {
  const { bootstrap, currentUser, login, setupFirstAdmin } = useAuth();
  const [mode, setMode] = useState<FormMode>(firstRunRequired ? "setup" : "login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (firstRunRequired) {
      setMode("setup");
    }
  }, [firstRunRequired]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const target = currentUser.role === "TRAINEE" ? "/trainee" : "/instructor";
    window.location.assign(target);
  }, [currentUser]);

  const helperText = useMemo(() => {
    if (mode === "setup") {
      return "Create the first ADMIN account for this local hub.";
    }

    return "Sign in with your local hub account.";
  }, [mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === "setup") {
        const request: CreateFirstAdminRequest = {
          username,
          displayName,
          password,
        };
        const response = await setupFirstAdmin(request);
        const target = response.user.role === "TRAINEE" ? "/trainee" : "/instructor";
        window.location.assign(target);
        return;
      }

      const request: LoginRequest = { username, password };
      const response = await login(request);
      const target = response.user.role === "TRAINEE" ? "/trainee" : "/instructor";
      window.location.assign(target);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  const firstRunMessage = bootstrap?.firstRunRequired
    ? "No users exist yet. Create the first ADMIN account to continue."
    : null;

  return (
    <section style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)" }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: "440px", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "24px", background: "#ffffff", boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)", display: "grid", gap: "14px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em" }}>ResQ Local Hub</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "0.95rem" }}>{helperText}</p>
        </div>

        {firstRunMessage ? (
          <div style={{ padding: "12px", borderRadius: "10px", background: "#fef3c7", color: "#92400e", fontSize: "0.9rem" }}>
            {firstRunMessage}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" onClick={() => setMode("login")} disabled={mode === "login" || firstRunRequired} style={tabButtonStyle(mode === "login" || firstRunRequired)}>
            Login
          </button>
          <button type="button" onClick={() => setMode("setup")} disabled={mode === "setup" || !firstRunRequired} style={tabButtonStyle(mode === "setup" || !firstRunRequired)}>
            First Run Setup
          </button>
        </div>

        <label style={fieldStyle()}>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} type="text" autoComplete="username" style={inputStyle} placeholder="admin" />
        </label>

        {mode === "setup" ? (
          <label style={fieldStyle()}>
            Display Name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} type="text" autoComplete="name" style={inputStyle} placeholder="Admin User" />
          </label>
        ) : null}

        <label style={fieldStyle()}>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} style={inputStyle} placeholder="••••••••" />
        </label>

        {error ? (
          <div style={{ padding: "12px", borderRadius: "10px", background: "#fee2e2", color: "#991b1b", fontSize: "0.9rem" }}>
            {error}
          </div>
        ) : null}

        <button type="submit" disabled={busy} style={primaryButtonStyle(busy)}>
          {busy ? "Working..." : mode === "setup" ? "Create ADMIN Account" : "Sign In"}
        </button>

        <p style={{ margin: 0, color: "#64748b", fontSize: "0.82rem", lineHeight: 1.5 }}>
          Local-only authentication. No cloud identity provider, no external sync.
        </p>
      </form>
    </section>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    display: "grid",
    gap: "6px",
    fontSize: "0.9rem",
    color: "#0f172a",
    fontWeight: 600,
  };
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  fontFamily: "inherit",
  fontSize: "0.95rem",
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid " + (active ? "#0f172a" : "#cbd5e1"),
    background: active ? "#0f172a" : "#ffffff",
    color: active ? "#ffffff" : "#0f172a",
    fontWeight: 600,
    cursor: active ? "default" : "pointer",
    opacity: active ? 1 : 0.9,
  };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #0f172a",
    background: disabled ? "#94a3b8" : "#0f172a",
    color: "#ffffff",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
