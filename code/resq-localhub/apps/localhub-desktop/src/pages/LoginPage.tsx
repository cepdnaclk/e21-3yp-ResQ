import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CreateFirstAdminRequest, UserRole } from "@resq/shared";
import { useAuth } from "../auth/AuthContext";

type LoginPageProps = {
  firstRunRequired?: boolean;
};

type FormMode = "login" | "first-run";

export default function LoginPage({ firstRunRequired = false }: LoginPageProps) {
  const { bootstrap, currentUser, login, setupFirstAdmin } = useAuth();
  const [mode, setMode] = useState<FormMode>(firstRunRequired ? "first-run" : "login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forceFirstRun, setForceFirstRun] = useState(false);

  useEffect(() => {
    const allowed = (bootstrap?.requiresFirstAdmin ?? firstRunRequired) || forceFirstRun;
    if (allowed) {
      setMode("first-run");
    } else {
      setMode("login");
    }
  }, [firstRunRequired, bootstrap?.requiresFirstAdmin, forceFirstRun]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const target = currentUser.role === "TRAINEE" ? "/trainee" : "/";
    window.location.assign(target);
  }, [currentUser]);

  const helperText = useMemo(() => {
    if (mode === "first-run") {
      return "Create the first ADMIN account for this local hub.";
    }

    return "Sign in with your local hub account.";
  }, [mode]);

  const firstRunAllowed = (bootstrap?.requiresFirstAdmin ?? firstRunRequired) || forceFirstRun;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === "first-run") {
        if (!username.trim() || !displayName.trim() || !password) {
          throw new Error("All fields are required for creating the admin account.");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const request: CreateFirstAdminRequest = {
          username,
          displayName,
          password,
        };
        const response = await setupFirstAdmin(request);
        const target = response.user.role === "TRAINEE" ? "/trainee" : "/";
        window.location.assign(target);
        return;
      }

      if (!username.trim() || !password) {
        throw new Error("Username and password are required.");
      }

      await login({ username, password });
      window.location.assign("/");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  const firstRunMessage = bootstrap?.requiresFirstAdmin
    ? "No users exist yet. Create the first ADMIN account to continue."
    : bootstrap?.hasUsers === true
    ? "First admin already exists. Please sign in."
    : null;

  return (
    <section style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem", background: "#001a33" }}>
      {/* Logo - Enlarged */}
      <div style={{ position: "absolute", top: "1.5rem", left: "50%", transform: "translateX(-50%)" }}>
        <img src="/resq-logo-dark-512.png" alt="ResQ" style={{ height: "240px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      </div>

      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: "420px", border: "1px solid rgba(17, 38, 63, 0.08)", borderRadius: "1.5rem", padding: "1.25rem", background: "rgba(255, 255, 255, 0.92)", boxShadow: "0 24px 70px rgba(25, 62, 104, 0.08)", display: "grid", gap: "0.75rem", marginTop: "14rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>ResQ Local Hub</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: "0.9rem" }}>{helperText}</p>
        </div>

        {firstRunMessage ? (
          <div style={{ padding: "10px", borderRadius: "8px", background: "#fef3c7", color: "#92400e", fontSize: "0.85rem" }}>
            {firstRunMessage}
          </div>
        ) : null}

        {import.meta.env.DEV ? (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setForceFirstRun((v) => !v);
                setError(null);
              }}
              style={{ padding: "4px 8px", borderRadius: "6px", border: "1px solid #cbd5e1", background: forceFirstRun ? "#f8fafc" : "#ffffff", cursor: "pointer", fontSize: "0.75rem" }}
            >
              {forceFirstRun ? "Fresh" : "Dev"}
            </button>
          </div>
        ) : null}

        <div role="tablist" aria-label="Authentication tabs" style={{ display: "flex", gap: "6px" }}>
          <button
            role="tab"
            aria-pressed={mode === "login"}
            type="button"
            onClick={() => setMode("login")}
            disabled={mode === "login"}
            style={tabButtonStyle(mode === "login")}
          >
            Login
          </button>
          <button
            role="tab"
            aria-pressed={mode === "first-run"}
            type="button"
            onClick={() => setMode("first-run")}
            disabled={mode === "first-run" || !firstRunAllowed}
            style={tabButtonStyle(mode === "first-run")}
          >
            First Run Setup
          </button>
        </div>

        <label style={fieldStyle()}>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} type="text" autoComplete="username" style={inputStyle} placeholder="admin" />
        </label>

        {mode === "first-run" ? (
          <label style={fieldStyle()}>
            Display Name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} type="text" autoComplete="name" style={inputStyle} placeholder="Admin User" />
          </label>
        ) : null}

        <label style={fieldStyle()}>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "first-run" ? "new-password" : "current-password"} style={inputStyle} placeholder="••••••••" />
        </label>

        {mode === "first-run" ? (
          <label style={fieldStyle()}>
            Confirm Password
            <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" style={inputStyle} placeholder="••••••••" />
          </label>
        ) : null}

        {error ? (
          <div style={{ padding: "10px", borderRadius: "8px", background: "#fee2e2", color: "#991b1b", fontSize: "0.85rem" }}>
            {error}
          </div>
        ) : null}

        <button type="submit" disabled={busy} style={primaryButtonStyle(busy)}>
          {busy ? "Working..." : mode === "first-run" ? "Create ADMIN Account" : "Sign In"}
        </button>

        <p style={{ margin: 0, color: "#64748b", fontSize: "0.78rem", lineHeight: 1.4 }}>
          Local-only authentication. No cloud identity provider, no external sync.
        </p>
      </form>
    </section>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    display: "grid",
    gap: "0.35rem",
    fontSize: "0.9rem",
    color: "#21364d",
    fontWeight: 600,
  };
}

const inputStyle: React.CSSProperties = {
  padding: "0.7rem 0.9rem",
  borderRadius: "0.8rem",
  border: "1px solid #c9d9ea",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  background: "#fff",
  color: "#102033",
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "0.7rem 0.9rem",
    borderRadius: "0.8rem",
    border: "none",
    background: active ? "#1452d6" : "#e9f2ff",
    color: active ? "#ffffff" : "#12427c",
    fontWeight: 600,
    fontSize: "0.9rem",
    cursor: active ? "default" : "pointer",
    opacity: active ? 1 : 0.9,
  };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "0.8rem 1rem",
    borderRadius: "0.8rem",
    border: "none",
    background: disabled ? "#c9d9ea" : "#1452d6",
    color: disabled ? "#50657f" : "#ffffff",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "0.95rem",
  };
}
