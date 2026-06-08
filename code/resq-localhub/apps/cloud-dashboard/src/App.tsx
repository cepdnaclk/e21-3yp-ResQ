import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { SessionsPage } from "./pages/SessionsPage";
import { UsersPage } from "./pages/UsersPage";
import { CoursesPage } from "./pages/CoursesPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { navigate, routeFromPath } from "./router";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const route = routeFromPath(path);

  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  useEffect(() => {
    if (route.name === "redirect") {
      navigate("/sessions");
    }
  }, [route.name]);

  return (
    <AppShell currentPath={route.name === "redirect" ? "/sessions" : path}>
      {route.name === "sessions" ? <SessionsPage /> : null}
      {route.name === "detail" ? <SessionDetailPage cloudSessionId={route.cloudSessionId} /> : null}
      {route.name === "analytics" ? <AnalyticsPage /> : null}
      {route.name === "users" ? <UsersPage /> : null}
      {route.name === "courses" ? <CoursesPage /> : null}
      {route.name === "course-detail" ? <CourseDetailPage courseId={route.courseId} /> : null}
      {route.name === "redirect" ? <div className="route-loading">Opening sessions…</div> : null}
    </AppShell>
  );
}
