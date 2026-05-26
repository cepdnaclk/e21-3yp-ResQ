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
import { fetchBrowserHealth, type BrowserHealthResponse } from "./lib/browserHealthApi";
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
  const [displayPage, setDisplayPage] = useState<Page>("home");
  const [pageMotion, setPageMotion] = useState<"idle" | "out" | "in">("idle");
  const [manualLanIpOverride, setManualLanIpOverride] = useState<string | null>(null);
  const [traineeSessionId, setTraineeSessionId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("resq-theme") === "dark" ? "dark" : "light";
  });
  const [clock, setClock] = useState(() => new Date());
  const [connectionHealth, setConnectionHealth] = useState<BrowserHealthResponse | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem("resq-theme", theme);
  }, [theme]);

  useEffect(() => {
    setDisplayPage(page);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshHealth() {
      const health = await fetchBrowserHealth();
      if (!cancelled) {
        setConnectionHealth(health);
      }
    }

    void refreshHealth();
    const interval = window.setInterval(() => {
      void refreshHealth();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (page === displayPage) return;

    setPageMotion("out");
    const timeout = window.setTimeout(() => {
      setDisplayPage(page);
      setPageMotion("in");
      window.setTimeout(() => setPageMotion("idle"), 180);
    }, 140);

    return () => window.clearTimeout(timeout);
  }, [page, displayPage]);

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

  function handlePageChange(nextPage: Page) {
    if (nextPage === page) {
      return;
    }

    setActionsOpen(false);
    setPage(nextPage);
  }

  async function handleRefreshAll() {
    setActionsOpen(false);
    window.location.reload();
  }

  async function handleCopyDiagnostics() {
    setActionsOpen(false);
    const payload = {
      page,
      user: currentUser?.displayName ?? null,
      role: currentUser?.role ?? null,
      theme,
      time: clock.toISOString(),
      health: connectionHealth,
      manualLanIpOverride,
      traineeSessionId,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore clipboard failures in browser contexts
    }
  }

  const topBarTime = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const connectionHealthy = Boolean(connectionHealth?.ok);
  const roleText = String(currentUser.role ?? "UNKNOWN");
  const roleClassName = roleText.toLowerCase();

  const quickActions = [
    { label: "Refresh All", onClick: handleRefreshAll },
    { label: "Copy Diagnostics", onClick: handleCopyDiagnostics },
    { label: theme === "dark" ? "Light Theme" : "Dark Theme", onClick: () => setTheme((current) => (current === "dark" ? "light" : "dark")) },
  ];

  return (
    <div className="app-shell">
      <div className="app-shell__parallax" aria-hidden="true" />

      <header className="app-shell__topbar">
        <div className="app-shell__brand">
          <div className="app-shell__logo-wrap" aria-hidden="true">
            <img src="/resq-logo-dark-512.png" alt="" className="app-shell__logo" />
          </div>
          <div>
            <p className="app-shell__kicker">ResQ Local Hub</p>
            <h1 className="app-shell__title">Command Center</h1>
          </div>
        </div>

        <div className="app-shell__topbar-meta">
          <span className="app-shell__clock" aria-label="Current time">{topBarTime}</span>
          <button type="button" className="app-shell__theme-toggle" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} aria-label="Toggle theme">
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <span className={`health-pill ${connectionHealthy ? "health-pill--ok" : "health-pill--bad"}`}>
            <span className="health-pill__dot" />
            {connectionHealthy ? "Connected" : "Disconnected"}
          </span>
          <span className={`role-pill role-pill--${roleClassName}`}>{roleText}</span>
          <span className="app-shell__user">{currentUser.displayName}</span>
          <button type="button" className="button button--ghost" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="app-shell__workspace">
        <aside className="app-shell__sidebar" aria-label="Desktop navigation">
          <button type="button" className={navClass(page === "home")} onClick={() => handlePageChange("home")}>Home</button>
          <button type="button" className={navClass(page === "instructor")} onClick={() => handlePageChange("instructor")}>Instructor</button>
          <button type="button" className={navClass(page === "trainee")} onClick={() => handlePageChange("trainee")}>Trainee</button>
          <button type="button" className={navClass(page === "setup")} onClick={() => handlePageChange("setup")}>Setup</button>
          {currentUser.role === "ADMIN" ? <button type="button" className={navClass(page === "users")} onClick={() => handlePageChange("users")}>Users</button> : null}
          {currentUser.role === "ADMIN" ? <button type="button" className={navClass(page === "diagnostics")} onClick={() => handlePageChange("diagnostics")}>Diagnostics</button> : null}
        </aside>

        <main className="app-shell__main app-shell__main--grid">
          <div key={displayPage} className={`app-shell__page app-shell__page--${pageMotion}`}>
            {displayPage === "home" && <HomePage manualLanIpOverride={manualLanIpOverride} />}
            {displayPage === "instructor" && (
          <InstructorDashboard
            embeddedInDesktop={true}
            manualLanIpOverride={manualLanIpOverride}
            onOpenTraineeDashboard={(sessionId) => {
              setTraineeSessionId(sessionId);
              handlePageChange("trainee");
            }}
          />
            )}
            {displayPage === "trainee" && (
          <TraineeDashboard
            embeddedInDesktop={true}
            initialSessionId={traineeSessionId}
          />
            )}
            {displayPage === "setup" && (
          <SetupPage
            manualLanIpOverride={manualLanIpOverride}
            onApplyManualLanIpOverride={handleApplyManualLanIpOverride}
            onClearManualLanIpOverride={handleClearManualLanIpOverride}
          />
            )}
            {displayPage === "users" && currentUser.role === "ADMIN" && <AdminUsersPage />}
            {displayPage === "diagnostics" && currentUser.role === "ADMIN" && <DiagnosticsPage />}
          </div>
        </main>
      </div>

      <div className={`quick-actions ${actionsOpen ? "quick-actions--open" : ""}`}>
        <button type="button" className="quick-actions__fab" onClick={() => setActionsOpen((current) => !current)} aria-label="Quick actions">
          +
        </button>
        <div className="quick-actions__menu" aria-hidden={!actionsOpen}>
          {quickActions.map((action) => (
            <button key={action.label} type="button" className="quick-actions__item" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


function navClass(active: boolean): string {
  return active ? "nav-chip nav-chip--active" : "nav-chip";
}
