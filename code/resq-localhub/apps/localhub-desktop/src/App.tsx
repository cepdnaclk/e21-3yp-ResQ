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
  const [page, setPage] = useState<Page>("home");
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
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__brand">
          <div className="app-shell__logo-wrap" aria-hidden="true">
            <img
              src="/resq-logo-dark-512.png"
              alt=""
              className="app-shell__logo"
            />
          </div>
          <div>
            <p className="app-shell__kicker">ResQ Local Hub</p>
            <h1 className="app-shell__title">Command Center</h1>
            <p className="app-shell__subtitle">
              Train smarter with local-first control, live session workflows, and real-time device diagnostics.
            </p>
          </div>
        </div>
        <div className="app-shell__userbar">
          <span className={`role-pill role-pill--${currentUser.role.toLowerCase()}`}>{currentUser.role}</span>
          <span className="app-shell__user">{currentUser.displayName}</span>
          <button type="button" className="button button--ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <nav className="app-shell__nav" aria-label="Desktop navigation">
        <button type="button" className={navClass(page === "home")} onClick={() => setPage("home")}>Home</button>
        <button type="button" className={navClass(page === "instructor")} onClick={() => setPage("instructor")}>Instructor</button>
        <button type="button" className={navClass(page === "trainee")} onClick={() => setPage("trainee")}>Trainee</button>
        <button type="button" className={navClass(page === "setup")} onClick={() => setPage("setup")}>Setup</button>
        {currentUser.role === "ADMIN" ? <button type="button" className={navClass(page === "users")} onClick={() => setPage("users")}>Users</button> : null}
        {currentUser.role === "ADMIN" ? <button type="button" className={navClass(page === "diagnostics")} onClick={() => setPage("diagnostics")}>Diagnostics</button> : null}
      </nav>

      <main className="app-shell__main">
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


function navClass(active: boolean): string {
  return active ? "nav-chip nav-chip--active" : "nav-chip";
}
