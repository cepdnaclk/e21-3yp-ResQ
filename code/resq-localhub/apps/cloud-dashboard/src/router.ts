export function navigate(path: string) {
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function routeFromPath(pathname: string):
  | { name: "sessions" }
  | { name: "detail"; cloudSessionId: string }
  | { name: "analytics" }
  | { name: "users" }
  | { name: "courses" }
  | { name: "course-detail"; courseId: string }
  | { name: "login" }
  | { name: "profile" }
  | { name: "redirect" } {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return { name: "redirect" };
  if (normalized === "/login") return { name: "login" };
  if (normalized === "/me") return { name: "profile" };
  if (normalized === "/sessions") return { name: "sessions" };
  if (normalized === "/analytics") return { name: "analytics" };
  if (normalized === "/management/users") return { name: "users" };
  if (normalized === "/management/courses") return { name: "courses" };
  const courseDetailMatch = normalized.match(/^\/management\/courses\/([^/]+)$/);
  if (courseDetailMatch) return { name: "course-detail", courseId: decodeURIComponent(courseDetailMatch[1]) };
  const detailMatch = normalized.match(/^\/sessions\/([^/]+)$/);
  if (detailMatch) return { name: "detail", cloudSessionId: decodeURIComponent(detailMatch[1]) };
  return { name: "redirect" };
}
