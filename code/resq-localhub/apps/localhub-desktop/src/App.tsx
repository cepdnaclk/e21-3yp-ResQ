import { useEffect, useState } from "react";
import { ROUTE_ROLE_RULES, type UserRole } from "@resq/shared";
import { useAuth } from "./auth/AuthContext";
import AccessDeniedPage from "./pages/AccessDeniedPage";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import SetupPage from "./pages/SetupPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import InstructorDashboard from "./pages/InstructorDashboard";
import TraineeDashboard from "./pages/TraineeDashboard";
import { MANUAL_LAN_IP_STORAGE_KEY, sanitizeManualLanIp } from "./lib/accessHost";
import ProtectedRoute from "./auth/ProtectedRoute";
import RoleBasedRoute from "./auth/RoleBasedRoute";

type Page = "home" | "setup" | "diagnostics" | "users" | "instructor" | "trainee";
type RouteType = "desktop" | "login" | "access-denied" | "instructor" | "trainee";

function getRouteFromPathname(): RouteType {
  const pathname = window.location.pathname;
  if (pathname === "/login" || pathname === "/login/") {
    return "login";
  }
  if (pathname === "/access-denied" || pathname === "/access-denied/") {
    return "access-denied";
  }
  if (pathname === "/instructor" || pathname === "/instructor/") {
    return "instructor";
  }
  if (pathname === "/trainee" || pathname === "/trainee/") {
    return "trainee";
  }
  return "desktop";
}

export default function App() {
  const { currentUser, isLoading, bootstrap, logout } = useAuth();
  const [route] = useState<RouteType>(() => getRouteFromPathname());
  const [page, setPage] = useState<Page>("instructor");
  const [manualLanIpOverride, setManualLanIpOverride] = useState<string | null>(null);
  const [traineeSessionId, setTraineeSessionId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(MANUAL_LAN_IP_STORAGE_KEY);
    setManualLanIpOverride(sanitizeManualLanIp(saved ?? ""));
  }, []);

  if (isLoading) {
    return (
      <div style={{ padding: "24px", fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif" }}>
        Loading authentication...
      </div>
    );
  }

  if (!currentUser || route === "login") {
    return <LoginPage firstRunRequired={bootstrap?.requiresFirstAdmin ?? false} />;
  }

  if (route === "access-denied") {
    return <AccessDeniedPage />;
  }

  if (route === "instructor") {
    return (
      <RoleBasedRoute allowedRoles={ROUTE_ROLE_RULES.instructor}>
        <InstructorDashboard manualLanIpOverride={manualLanIpOverride} />
      </RoleBasedRoute>
    );
  }

  if (route === "trainee") {
    return (
      <ProtectedRoute allowedRoles={ROUTE_ROLE_RULES.trainee}>
        <TraineeDashboard />
      </ProtectedRoute>
    );
  }

  if (currentUser.role === "TRAINEE") {
    return <TraineeDashboard embeddedInDesktop={true} initialSessionId={traineeSessionId} />;
  }

  function handleApplyManualLanIpOverride(value: string) {
    const normalized = sanitizeManualLanIp(value);
    setManualLanIpOverride(normalized);

    if (normalized) {
      window.localStorage.setItem(MANUAL_LAN_IP_STORAGE_KEY, normalized);
      return;
    }

    window.localStorage.removeItem(MANUAL_LAN_IP_STORAGE_KEY);
  }

  function handleClearManualLanIpOverride() {
    setManualLanIpOverride(null);
    window.localStorage.removeItem(MANUAL_LAN_IP_STORAGE_KEY);
  }

  async function handleLogout() {
    await logout();
    window.location.assign("/login");
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em" }}>ResQ Local Hub</h1>
            <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "0.95rem", fontWeight: 400 }}>
              Windows-first local-first instructor desktop
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#e2e8f0", color: "#334155", fontSize: "0.8rem", fontWeight: 700 }}>
              {currentUser.role}
            </span>
            <span style={{ color: "#475569", fontSize: "0.9rem", fontWeight: 600 }}>
              {currentUser.displayName}
            </span>
            <button type="button" onClick={handleLogout} style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", fontWeight: 600, cursor: "pointer" }}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <nav style={styles.nav}>
        {/* Simple tab-like buttons keep the starter app easy to follow. */}
        <button style={tabStyle(page === "home")} onClick={() => setPage("home")}>Home</button>
        <button style={tabStyle(page === "instructor")} onClick={() => setPage("instructor")}>Instructor</button>
        <button style={tabStyle(page === "trainee")} onClick={() => setPage("trainee")}>Trainee</button>
        <button style={tabStyle(page === "setup")} onClick={() => setPage("setup")}>Setup</button>
        {currentUser.role === "ADMIN" ? <button style={tabStyle(page === "users")} onClick={() => setPage("users")}>Users</button> : null}
        {currentUser.role === "ADMIN" ? <button style={tabStyle(page === "diagnostics")} onClick={() => setPage("diagnostics")}>Diagnostics</button> : null}
      </nav>

      <main style={styles.main}>
        {page === "home" && <HomePage manualLanIpOverride={manualLanIpOverride} />}
        {page === "instructor" && (
          <InstructorDashboard
            embeddedInDesktop={true}
            manualLanIpOverride={manualLanIpOverride}
            onOpenTraineeDashboard={(sessionId) => {
              setTraineeSessionId(sessionId);
              setPage("trainee");
            }}
          />
        )}
        {page === "trainee" && (
          <TraineeDashboard
            embeddedInDesktop={true}
            initialSessionId={traineeSessionId}
          />
        )}
        {page === "setup" && (
          <SetupPage
            manualLanIpOverride={manualLanIpOverride}
            onApplyManualLanIpOverride={handleApplyManualLanIpOverride}
            onClearManualLanIpOverride={handleClearManualLanIpOverride}
          />
        )}
        {page === "users" && currentUser.role === "ADMIN" && <AdminUsersPage />}
        {page === "diagnostics" && currentUser.role === "ADMIN" && <DiagnosticsPage />}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "32px 24px",
    color: "#0f172a",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    minHeight: "100vh"
  },
  header: {
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "1px solid #e5e7eb"
  },
  nav: {
    display: "flex",
    gap: "12px",
    marginBottom: "24px",
    flexWrap: "wrap"
  },
  main: {
    background: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)"
  }
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#0f172a" : "#ffffff",
    color: active ? "#f8fafc" : "#0f172a",
    border: "1px solid " + (active ? "#0f172a" : "#e5e7eb"),
    borderRadius: "8px",
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.95rem",
    transition: "all 0.2s ease-in-out",
    boxShadow: active ? "0 2px 8px rgba(15, 23, 42, 0.12)" : "none",
  };
}
