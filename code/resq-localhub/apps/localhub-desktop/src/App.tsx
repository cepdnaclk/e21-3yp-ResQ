import { useEffect, useMemo, useRef, useState } from "react";
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
import ThemeToggle from "./theme/ThemeToggle";

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
  const [liveTime, setLiveTime] = useState(new Date());
  const [connectionHealthy, setConnectionHealthy] = useState(true);
  const [lastApiSuccessAt, setLastApiSuccessAt] = useState<number | null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [pageTransitionKey, setPageTransitionKey] = useState(0);
  const fetchPatchedRef = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(MANUAL_LAN_IP_STORAGE_KEY);
    setManualLanIpOverride(sanitizeManualLanIp(saved ?? ""));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveTime(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (fetchPatchedRef.current) {
      return;
    }

    fetchPatchedRef.current = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        setLastApiSuccessAt(Date.now());
        setConnectionHealthy(response.ok);
        return response;
      } catch (error) {
        setLastApiSuccessAt(Date.now());
        setConnectionHealthy(false);
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
      fetchPatchedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setPageTransitionKey((current) => current + 1);
    setQuickActionsOpen(false);
  }, [page]);

  const commandPages = useMemo(
    () => [
      { key: "home" as const, label: "Home" },
      { key: "instructor" as const, label: "Instructor" },
      { key: "trainee" as const, label: "Trainee" },
      { key: "setup" as const, label: "Setup" },
      ...(currentUser?.role === "ADMIN" ? [{ key: "users" as const, label: "Users" }, { key: "diagnostics" as const, label: "Diagnostics" }] : []),
    ],
    [currentUser?.role],
  );

  function copyDiagnostics() {
    const payload = {
      user: currentUser?.displayName ?? "unknown",
      role: currentUser?.role ?? "unknown",
      page,
      route,
      time: liveTime.toISOString(),
      connectionHealthy,
      lastApiSuccessAt,
      manualLanIpOverride,
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }

  function refreshAll() {
    window.location.reload();
  }

  function goHome() {
    setPage("home");
  }

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
    <div className="command-shell">
      <div className="command-shell__parallax" aria-hidden="true" />
      <header className="command-shell__topbar command-shell__topbar--sticky">
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
        <div className="command-shell__statusbar">
          <div className="command-shell__status-chip">
            <span className="command-shell__status-label">Time</span>
            <span className="command-shell__status-value">{liveTime.toLocaleTimeString()}</span>
          </div>
          <div className={`command-shell__status-chip command-shell__status-chip--${connectionHealthy ? "ok" : "bad"}`}>
            <span className={`command-shell__pulse ${connectionHealthy ? "command-shell__pulse--ok" : "command-shell__pulse--bad"}`} />
            <span className="command-shell__status-label">Connection</span>
            <span className="command-shell__status-value">{connectionHealthy ? "Healthy" : "Offline"}</span>
          </div>
          <ThemeToggle />
          <button type="button" className="button button--ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="command-shell__body">
        <aside className="command-shell__sidebar" aria-label="Desktop navigation">
          <div className="command-shell__sidebar-heading">Stations</div>
          {commandPages.map((item) => (
            <button key={item.key} type="button" className={navClass(page === item.key)} onClick={() => setPage(item.key)}>
              <span>{item.label}</span>
            </button>
          ))}
        </aside>

        <main className="command-shell__main">
          <div key={`${page}-${pageTransitionKey}`} className="command-shell__page command-shell__page--enter">
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
          </div>
        </main>
      </div>

      <div className="command-shell__quick-actions">
        <button type="button" className="command-shell__quick-actions-fab" onClick={() => setQuickActionsOpen((current) => !current)}>
          Quick Actions
        </button>
        <div className={`command-shell__quick-actions-panel ${quickActionsOpen ? "command-shell__quick-actions-panel--open" : ""}`}>
          <button type="button" className="command-shell__quick-action" onClick={refreshAll}>Refresh All</button>
          <button type="button" className="command-shell__quick-action" onClick={copyDiagnostics}>Copy Diagnostics</button>
          <button type="button" className="command-shell__quick-action" onClick={goHome}>Go Home</button>
        </div>
      </div>
    </div>
  );
}


function navClass(active: boolean): string {
  return active ? "nav-chip nav-chip--active" : "nav-chip";
}
