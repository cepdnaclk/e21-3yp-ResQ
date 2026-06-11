import { useEffect, useState } from "react";
import { fetchCurrentCloudUser, logoutCloudUser, type CloudUserRole } from "./api/cloudApi";
import {
  AUTH_CHANGED_EVENT,
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
  type CloudAuthSession,
} from "./auth/authStorage";
import { AppShell } from "./components/AppShell";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { CoursesPage } from "./pages/CoursesPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { SessionReportsPage } from "./pages/SessionReportsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { UsersPage } from "./pages/UsersPage";
import { navigate, routeFromPath } from "./router";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<CloudAuthSession | null>(loadAuthSession);
  const [authReady, setAuthReady] = useState(false);
  const route = routeFromPath(path);

  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    const handleAuthChange = () => setSession(loadAuthSession());
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChange);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChange);
    };
  }, []);

  useEffect(() => {
    const stored = loadAuthSession();
    if (!stored) {
      setAuthReady(true);
      return;
    }
    fetchCurrentCloudUser()
      .then((user) => {
        const refreshed = { ...stored, user };
        saveAuthSession(refreshed);
        setSession(refreshed);
      })
      .catch(() => {
        clearAuthSession();
        setSession(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  const homePath = session?.user.role === "TRAINEE" ? "/me" : "/sessions";
  const routeAllowed = session ? isRouteAllowed(route.name, session.user.role) : false;

  useEffect(() => {
    if (!authReady) return;
    if (!session && route.name !== "login") {
      navigate("/login");
    } else if (session && (route.name === "login" || route.name === "redirect" || !routeAllowed)) {
      navigate(homePath);
    }
  }, [authReady, homePath, route.name, routeAllowed, session]);

  if (!authReady) {
    return <div className="route-loading">Checking cloud access...</div>;
  }

  if (!session) {
    return <LoginPage onLogin={(nextSession) => {
      setSession(nextSession);
      navigate(nextSession.user.role === "TRAINEE" ? "/me" : "/sessions");
    }} />;
  }

  return (
    <AppShell
      currentPath={route.name === "redirect" ? homePath : path}
      user={session.user}
      onLogout={() => {
        void logoutCloudUser().catch(() => undefined).finally(() => {
          clearAuthSession();
          setSession(null);
          navigate("/login");
        });
      }}
    >
      {route.name === "sessions" ? <SessionsPage /> : null}
      {route.name === "detail" ? <SessionDetailPage cloudSessionId={route.cloudSessionId} /> : null}
      {route.name === "analytics" ? <AnalyticsPage /> : null}
      {route.name === "users" ? <UsersPage /> : null}
      {route.name === "courses" ? <CoursesPage readOnly={session.user.role !== "ADMIN"} /> : null}
      {route.name === "course-detail"
        ? <CourseDetailPage courseId={route.courseId} readOnly={session.user.role !== "ADMIN"} />
        : null}
      {route.name === "profile" ? <ProfilePage user={session.user} /> : null}
      {route.name === "reports" ? <SessionReportsPage user={session.user} /> : null}
      {route.name === "redirect" || route.name === "login"
        ? <div className="route-loading">Opening cloud review...</div>
        : null}
    </AppShell>
  );
}

function isRouteAllowed(routeName: ReturnType<typeof routeFromPath>["name"], role: CloudUserRole) {
  if (routeName === "login" || routeName === "redirect" || routeName === "profile" || routeName === "reports") return true;
  if (role === "TRAINEE") return false;
  if (role === "INSTRUCTOR") return routeName !== "users";
  return true;
}
