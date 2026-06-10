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
  const [lastApiSuccessAt, setLastApiSuccessAt] = useState<number | null>(() => Date.now());
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
    return <TraineeDashboard embeddedInDesktop={false} initialSessionId={traineeSessionId} />;
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
    <div className={`command-shell ${page === "home" ? "command-shell--home" : ""}`}>
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
            <span className="command-shell__status-value">
              {liveTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>

          {!currentUser ? (
            <div className="command-shell__status-chip">
              <span className="command-shell__status-label">Admin</span>
              <span className="command-shell__status-value">Loading...</span>
            </div>
          ) : currentUser.role === "ADMIN" ? (
            <div className="command-shell__status-chip">
              <span className="command-shell__status-label">Admin</span>
              <span className="command-shell__status-value">
                {currentUser.displayName || currentUser.username}
              </span>
            </div>
          ) : null}

          <div className="status-indicator" tabIndex={0}>
            <div className={`status-indicator__wrapper status-indicator__wrapper--${connectionHealthy ? "healthy" : "offline"}`}>
              {connectionHealthy ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="3" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="13" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="7" x2="6.01" y2="7" />
                    <line x1="6" y1="17" x2="6.01" y2="17" />
                  </svg>
                  <span className="status-indicator__dot status-indicator__dot--healthy" />
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span className="status-indicator__dot status-indicator__dot--offline" />
                </>
              )}
            </div>
            <div className="status-indicator__tooltip" role="tooltip">
              {connectionHealthy
                ? `Healthy - Last update: ${lastApiSuccessAt ? new Date(lastApiSuccessAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                : "Offline - Unable to reach backend"}
            </div>
          </div>
          <button type="button" className="button button--ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="command-shell__body">
        <main className="command-shell__main">
          <div key={`${page}-${pageTransitionKey}`} className="command-shell__page command-shell__page--enter">
            {page === "home" && (
              <HomePage
                manualLanIpOverride={manualLanIpOverride}
                onOpenInstructorDashboard={() => setPage("instructor")}
                onOpenTraineeDashboard={() => setPage("trainee")}
              />
            )}
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

      {/* Invisible backdrop to dismiss menu on click outside */}
      {quickActionsOpen && (
        <div
          className="assistive-touch-backdrop"
          onClick={() => setQuickActionsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1050,
            background: "transparent",
            cursor: "default",
          }}
        />
      )}

      {/* AssistiveTouch Floating Menu Wrapper */}
      <div className={`assistive-touch ${quickActionsOpen ? "assistive-touch--open" : ""}`}>
        {/* Floating Circle Trigger Button */}
        <button
          type="button"
          className="assistive-touch__fab"
          onClick={() => setQuickActionsOpen(true)}
          aria-label="Open quick actions"
          title="Open quick actions"
        >
          <div className="assistive-touch__ring" />
        </button>

        {/* Expanded 2x2 Grid Menu */}
        <div className="assistive-touch__menu">
          <div className="assistive-touch__grid">
            {/* 1. Go Home */}
            <button
              type="button"
              className="assistive-touch__item"
              onClick={() => {
                goHome();
                setQuickActionsOpen(false);
              }}
            >
              <div className="assistive-touch__icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <span className="assistive-touch__label">Home</span>
            </button>

            {/* 2. Refresh All */}
            <button
              type="button"
              className="assistive-touch__item"
              onClick={() => {
                refreshAll();
                setQuickActionsOpen(false);
              }}
            >
              <div className="assistive-touch__icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
              </div>
              <span className="assistive-touch__label">Refresh</span>
            </button>

            {/* 3. Copy Diagnostics */}
            <button
              type="button"
              className="assistive-touch__item"
              onClick={() => {
                copyDiagnostics();
                setQuickActionsOpen(false);
              }}
            >
              <div className="assistive-touch__icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </div>
              <span className="assistive-touch__label">Diagnostics</span>
            </button>

            {/* 4. Collapse/Close */}
            <button
              type="button"
              className="assistive-touch__item"
              onClick={() => setQuickActionsOpen(false)}
            >
              <div className="assistive-touch__icon-wrap">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <span className="assistive-touch__label">Close</span>
            </button>
          </div>
        </div>
      </div>

      {/* Floating Navigation Menu Toggle Button */}
      <button
        type="button"
        className="floating-nav-toggle"
        onClick={() => setNavOpen(true)}
        aria-label="Open navigation menu"
        title="Open navigation menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="6" x2="20" y2="6"></line>
          <line x1="4" y1="18" x2="20" y2="18"></line>
        </svg>
      </button>

      {/* Navigation Overlay and Modal */}
      <div className={`floating-nav-overlay ${navOpen ? "floating-nav-overlay--open" : ""}`} onClick={() => setNavOpen(false)}>
        <div className="floating-nav-popup" onClick={(e) => e.stopPropagation()}>
          <h2 className="floating-nav-popup__title">Navigation</h2>
          <div className="floating-nav-popup__list">
            {commandPages.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`floating-nav-popup__item ${page === item.key ? "floating-nav-popup__item--active" : ""}`}
                onClick={() => {
                  setPage(item.key);
                  setNavOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="floating-nav-popup__close" onClick={() => setNavOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
