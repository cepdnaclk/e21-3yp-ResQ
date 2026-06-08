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
  | { name: "redirect" } {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return { name: "redirect" };
  if (normalized === "/sessions") return { name: "sessions" };
  if (normalized === "/analytics") return { name: "analytics" };
  const detailMatch = normalized.match(/^\/sessions\/([^/]+)$/);
  if (detailMatch) return { name: "detail", cloudSessionId: decodeURIComponent(detailMatch[1]) };
  return { name: "redirect" };
}
