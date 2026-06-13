import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { MANUAL_LAN_IP_STORAGE_KEY, sanitizeManualLanIp } from "./lib/accessHost";

// Import V2 Pages
import V2LoginPage from "./pages/v2/LoginPage";
import V2SetupFirstAdminPage from "./pages/v2/SetupFirstAdminPage";
import V2LocalHubHomePage from "./pages/v2/LocalHubHomePage";
import V2InstructorDashboardPage from "./pages/v2/InstructorDashboardPage";
import V2PairManikinPage from "./pages/v2/PairManikinPage";
import V2ManikinReadinessPage from "./pages/v2/ManikinReadinessPage";
import V2InstructorLiveSessionPage from "./pages/v2/InstructorLiveSessionPage";
import V2TraineeLiveSessionPage from "./pages/v2/TraineeLiveSessionPage";
import V2RecentSessionsPage from "./pages/v2/RecentSessionsPage";
import V2SessionReviewPage from "./pages/v2/SessionReviewPage";
import V2AdminUsersPage from "./pages/v2/AdminUsersPage";
import V2TechnicianDiagnosticsPage from "./pages/v2/TechnicianDiagnosticsPage";
import V2AccessDeniedPage from "./pages/v2/AccessDeniedPage";
import V2CoursesPage from "./pages/v2/CoursesPage";
import V2StartSessionWizardPage from "./pages/v2/StartSessionWizardPage";
import V2ActiveSessionsPage from "./pages/v2/ActiveSessionsPage";

// Import Legacy Pages
import LegacyInstructorDashboard from "./pages/InstructorDashboard";
import LegacyTraineeDashboard from "./pages/TraineeDashboard";

// Import Layout
import AppShell from "./layouts/AppShell";

type RouteState =
  | { name: "home" }
  | { name: "login" }
  | { name: "setup" }
  | { name: "courses" }
  | { name: "start-session" }
  | { name: "live-sessions" }
  | { name: "instructor" }
  | { name: "pair-manikin" }
  | { name: "readiness"; deviceId: string }
  | { name: "instructor-live"; sessionId: string }
  | { name: "trainee-live"; sessionId: string }
  | { name: "sessions" }
  | { name: "session-review"; sessionId: string }
  | { name: "admin-users" }
  | { name: "diagnostics" }
  | { name: "access-denied" }
  | { name: "legacy-instructor" }
  | { name: "legacy-trainee" };

function parseRoute(path: string): RouteState {
  const p = path.replace(/\/$/, "") || "/";

  if (p === "/login") return { name: "login" };
  if (p === "/setup") return { name: "setup" };
  if (p === "/courses") return { name: "courses" };
  if (p === "/start-session") return { name: "start-session" };
  if (p === "/live-sessions") return { name: "live-sessions" };
  if (p === "/instructor") return { name: "instructor" };
  if (p === "/instructor/pair") return { name: "pair-manikin" };
  if (p === "/sessions") return { name: "sessions" };
  if (p === "/admin/users") return { name: "admin-users" };
  if (p === "/diagnostics") return { name: "diagnostics" };
  if (p === "/access-denied") return { name: "access-denied" };
  if (p === "/legacy/instructor") return { name: "legacy-instructor" };
  if (p === "/legacy/trainee") return { name: "legacy-trainee" };

  // /instructor/manikins/:deviceId/readiness
  const readinessMatch = p.match(/^\/instructor\/manikins\/([^/]+)\/readiness$/);
  if (readinessMatch) return { name: "readiness", deviceId: decodeURIComponent(readinessMatch[1]) };

  // /instructor/sessions/:sessionId/live
  const instLiveMatch = p.match(/^\/instructor\/sessions\/([^/]+)\/live$/);
  if (instLiveMatch) return { name: "instructor-live", sessionId: decodeURIComponent(instLiveMatch[1]) };

  // /trainee/sessions/:sessionId/live
  const traLiveMatch = p.match(/^\/trainee\/sessions\/([^/]+)\/live$/);
  if (traLiveMatch) return { name: "trainee-live", sessionId: decodeURIComponent(traLiveMatch[1]) };

  // /sessions/:sessionId
  const sessionReviewMatch = p.match(/^\/sessions\/([^/]+)$/);
  if (sessionReviewMatch) return { name: "session-review", sessionId: decodeURIComponent(sessionReviewMatch[1]) };

  if (p === "/") return { name: "home" };
  return { name: "home" };
}

export default function App() {
  const { currentUser, isLoading, bootstrap, logout } = useAuth();
  const [currentRoute, setCurrentRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [manualLanIpOverride, setManualLanIpOverride] = useState<string | null>(null);
  const [connectionHealthy, setConnectionHealthy] = useState(true);
  const [lastApiSuccessAt, setLastApiSuccessAt] = useState<number | null>(() => Date.now());
  const fetchPatchedRef = useRef(false);

  // Sync popstate (back/forward browser buttons)
  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(parseRoute(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(path: string) {
    window.history.pushState({}, "", path);
    setCurrentRoute(parseRoute(path));
  }

  useEffect(() => {
    const saved = window.localStorage.getItem(MANUAL_LAN_IP_STORAGE_KEY);
    setManualLanIpOverride(sanitizeManualLanIp(saved ?? ""));
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

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  // 1. Loading state
  if (isLoading) {
    return (
      <div className="p-6 font-sans text-gray-700">
        Loading authentication...
      </div>
    );
  }

  // 2. Unauthenticated flows
  if (!currentUser) {
    if (bootstrap?.requiresFirstAdmin) {
      return <V2SetupFirstAdminPage />;
    }
    return <V2LoginPage />;
  }

  // 3. Role enforcement rules (Correction 8 / TASK 2)
  const isInstructorOrAdmin = currentUser.role === "ADMIN" || currentUser.role === "INSTRUCTOR";
  const isAdmin = currentUser.role === "ADMIN";
  const isTrainee = currentUser.role === "TRAINEE";

  // ADMIN only routes
  if (currentRoute.name === "admin-users" && !isAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "diagnostics" && !isAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }

  // ADMIN or INSTRUCTOR only routes
  if (currentRoute.name === "instructor" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "courses" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "start-session" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "live-sessions" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "instructor-live" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "readiness" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "pair-manikin" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }
  if (currentRoute.name === "legacy-instructor" && !isInstructorOrAdmin) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }

  // TRAINEE only routes (redirect ADMIN/INSTRUCTOR to /live-sessions)
  if (currentRoute.name === "trainee-live" && !isTrainee) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/live-sessions")} />;
  }
  if (currentRoute.name === "legacy-trainee" && !isTrainee) {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/live-sessions")} />;
  }

  // 4. Trainee role quick-routing (if trainee enters dashboard, route to legacy-trainee by default)
  if (currentUser.role === "TRAINEE" && currentRoute.name !== "trainee-live" && currentRoute.name !== "legacy-trainee" && currentRoute.name !== "session-review") {
    return <LegacyTraineeDashboard embeddedInDesktop={true} legacy={false} navigate={navigate} />;
  }

  // 5. Standalone full screen V2 routes (not wrapped in standard AppShell)
  if (currentRoute.name === "trainee-live") {
    return (
      <V2TraineeLiveSessionPage
        sessionId={currentRoute.sessionId}
        onSessionEnded={() => navigate("/")}
      />
    );
  }

  // 6. Standalone legacy routes
  if (currentRoute.name === "legacy-instructor") {
    return <LegacyInstructorDashboard manualLanIpOverride={manualLanIpOverride} />;
  }
  if (currentRoute.name === "legacy-trainee") {
    return <LegacyTraineeDashboard embeddedInDesktop={false} legacy={true} navigate={navigate} />;
  }
  if (currentRoute.name === "access-denied") {
    return <V2AccessDeniedPage onBackToHome={() => navigate("/")} />;
  }

  // 7. Map current route to AppShell key highlighting
  let activeShellKey = "home";
  if (
    currentRoute.name === "instructor" ||
    currentRoute.name === "pair-manikin" ||
    currentRoute.name === "readiness" ||
    currentRoute.name === "instructor-live"
  ) {
    activeShellKey = "instructor";
  } else if (currentRoute.name === "sessions" || currentRoute.name === "session-review") {
    activeShellKey = "sessions";
  } else if (currentRoute.name === "admin-users") {
    activeShellKey = "users";
  } else if (currentRoute.name === "diagnostics") {
    activeShellKey = "diagnostics";
  } else if (currentRoute.name === "courses") {
    activeShellKey = "courses";
  } else if (currentRoute.name === "start-session") {
    activeShellKey = "start-session";
  } else if (currentRoute.name === "live-sessions") {
    activeShellKey = "live-sessions";
  }

  const handlePageChange = (key: string) => {
    if (key === "home") navigate("/");
    else if (key === "instructor") navigate("/instructor");
    else if (key === "sessions") navigate("/sessions");
    else if (key === "users") navigate("/admin/users");
    else if (key === "diagnostics") navigate("/diagnostics");
    else if (key === "courses") navigate("/courses");
    else if (key === "start-session") navigate("/start-session");
    else if (key === "live-sessions") navigate("/live-sessions");
  };

  return (
    <AppShell
      currentUser={currentUser}
      connectionHealthy={connectionHealthy}
      lastApiSuccessAt={lastApiSuccessAt}
      onLogout={handleLogout}
      page={activeShellKey}
      setPage={handlePageChange}
    >
      {currentRoute.name === "home" && (
        <V2LocalHubHomePage
          onOpenInstructorDashboard={() => navigate("/instructor")}
          onOpenTraineeDashboard={() => navigate("/legacy/trainee")}
        />
      )}
      {currentRoute.name === "instructor" && (
        <V2InstructorDashboardPage
          onStartSession={(sid) => navigate(`/instructor/sessions/${sid}/live`)}
          onRunReadinessCheck={(did) => navigate(`/instructor/manikins/${did}/readiness`)}
          onPairNewManikin={() => navigate("/instructor/pair")}
          onViewRecentSessions={() => navigate("/sessions")}
        />
      )}
      {currentRoute.name === "pair-manikin" && (
        <V2PairManikinPage onBack={() => navigate("/instructor")} />
      )}
      {currentRoute.name === "readiness" && (
        <V2ManikinReadinessPage
          deviceId={currentRoute.deviceId}
          onBack={() => navigate("/instructor")}
        />
      )}
      {currentRoute.name === "instructor-live" && (
        <V2InstructorLiveSessionPage
          sessionId={currentRoute.sessionId}
          onSessionEnded={(sid) => navigate(`/sessions/${sid}`)}
        />
      )}
      {currentRoute.name === "sessions" && (
        <V2RecentSessionsPage onSelectSession={(sid) => navigate(`/sessions/${sid}`)} />
      )}
      {currentRoute.name === "session-review" && (
        <V2SessionReviewPage
          sessionId={currentRoute.sessionId}
          onBack={() => navigate("/sessions")}
        />
      )}
      {currentRoute.name === "admin-users" && <V2AdminUsersPage />}
      {currentRoute.name === "diagnostics" && <V2TechnicianDiagnosticsPage />}
      {currentRoute.name === "courses" && <V2CoursesPage />}
      {currentRoute.name === "start-session" && <V2StartSessionWizardPage />}
      {currentRoute.name === "live-sessions" && (
        <V2ActiveSessionsPage
          onViewLive={(sid) => navigate(`/instructor/sessions/${sid}/live`)}
          onNavigateHome={() => navigate("/")}
        />
      )}
    </AppShell>
  );
}
