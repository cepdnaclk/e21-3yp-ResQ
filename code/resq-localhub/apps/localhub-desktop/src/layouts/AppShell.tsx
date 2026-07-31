import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../types/auth";

type AppShellProps = {
  currentUser: AuthUser;
  connectionHealthy: boolean;
  lastApiSuccessAt: number | null;
  onLogout: () => void;
  page: string;
  setPage: (page: any) => void;
  contentMode?: "document" | "dashboard";
  children: ReactNode;
};

type NavItem = {
  key: string;
  label: string;
};

export function AppShell({
  currentUser,
  connectionHealthy,
  lastApiSuccessAt,
  onLogout,
  page,
  setPage,
  contentMode = "document",
  children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  const navItems = useMemo<NavItem[]>(() => {
    const instructorItems: NavItem[] = [
      { key: "home", label: "Overview" },
      { key: "instructor", label: "Manikins" },
      { key: "start-session", label: "Training" },
      { key: "sessions", label: "Sessions" },
      { key: "courses", label: "Courses" },
    ];

    if (currentUser.role === "ADMIN") {
      const adminItems: NavItem[] = [
        ...instructorItems,
        { key: "users", label: "Users" },
        { key: "diagnostics", label: "Diagnostics" },
      ];

      if (import.meta.env.DEV) {
        adminItems.push({ key: "demo-checklist", label: "Demo Checklist" });
      }

      return adminItems;
    }

    if (currentUser.role === "INSTRUCTOR") {
      if (import.meta.env.DEV) {
        return [...instructorItems, { key: "demo-checklist", label: "Demo Checklist" }];
      }

      return instructorItems;
    }

    return [{ key: "home", label: "Overview" }];
  }, [currentUser.role]);

  const roleLabel =
    currentUser.role === "ADMIN"
      ? "Administrator"
      : currentUser.role === "INSTRUCTOR"
        ? "Instructor"
        : currentUser.role;

  function handleNavigate(key: string) {
    setPage(key);
    setNavOpen(false);
  }

  const connectionLabel = connectionHealthy ? "LocalHub Connected" : "LocalHub Unavailable";

  return (
    <div className="h-screen min-h-0 overflow-hidden bg-[#f5f7f8] flex flex-col md:flex-row font-sans antialiased text-slate-800">
      <aside className="hidden md:flex h-full w-[232px] xl:w-[248px] bg-[#09242c] flex-col justify-between shrink-0 text-slate-300">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-teal-600 flex items-center justify-center p-1.5 shrink-0 shadow-sm">
              <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white tracking-tight leading-tight truncate">ResQ Local Hub</h1>
              <p className="text-xs text-teal-300 font-medium mt-0.5">CPR Training Suite</p>
            </div>
          </div>

          <nav className="px-3 py-5 space-y-1 overflow-y-auto" aria-label="Primary navigation">
            {navItems.map((item) => {
              const isActive = page === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  className={`w-full flex items-center px-3 py-2.5 text-sm font-semibold rounded-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-teal-300/50 ${
                    isActive
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-slate-300 hover:bg-white/8 hover:text-white"
                  }`}
                  onClick={() => handleNavigate(item.key)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 bg-[#071d24] flex flex-col gap-3">
          <div className="px-1">
            <div className="text-sm font-semibold text-white truncate">{currentUser.displayName}</div>
            <div className="text-xs text-teal-300 font-medium">{roleLabel}</div>
          </div>
          <button
            type="button"
            className="w-full py-2.5 text-center text-sm font-semibold bg-white/8 hover:bg-white/12 text-slate-100 rounded-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-teal-300/50"
            onClick={onLogout}
          >
            Sign Out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <header className="shrink-0 bg-white border-b border-slate-200/70 px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="md:hidden text-slate-500 hover:text-slate-800 p-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
            <div className="md:hidden w-8 h-8 rounded-[10px] bg-teal-600 flex items-center justify-center p-1.5">
              <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="relative group flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm font-medium text-slate-700"
              aria-live="polite"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  connectionHealthy ? "bg-emerald-500" : "bg-rose-500"
                }`}
                aria-hidden="true"
              />
              <span>{connectionLabel}</span>
              <div className="absolute right-0 top-full mt-2 w-60 hidden group-hover:block bg-slate-900 text-white text-xs p-3 rounded-[10px] shadow-lg leading-relaxed pointer-events-none z-50">
                {connectionHealthy
                  ? `LocalHub API ready. Last verified: ${
                      lastApiSuccessAt ? new Date(lastApiSuccessAt).toLocaleTimeString() : "Just now"
                    }`
                  : "Unable to reach the LocalHub service."}
              </div>
            </div>

            <div className="hidden sm:block text-right">
              <div className="text-sm font-semibold text-slate-800 leading-tight truncate max-w-[160px]">
                {currentUser.displayName}
              </div>
              <div className="text-xs text-slate-500 leading-tight">{roleLabel}</div>
            </div>
          </div>
        </header>

        <main
          data-content-mode={contentMode}
          className={
            contentMode === "dashboard"
              ? "flex-1 min-h-0 min-w-0 overflow-hidden p-3 sm:p-4 w-full"
              : "flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5 lg:p-6 w-full"
          }
        >
          {children}
        </main>
      </div>

      {navOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-sm flex justify-end"
          onClick={() => setNavOpen(false)}
        >
          <div
            className="w-72 max-w-[86vw] bg-[#09242c] text-slate-300 h-full p-4 flex flex-col justify-between shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-h-0">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-white">Navigation</h2>
                <button
                  type="button"
                  className="p-2 rounded-lg text-slate-300 hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-300/50"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close navigation"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <nav className="space-y-1 overflow-y-auto" aria-label="Mobile primary navigation">
                {navItems.map((item) => {
                  const isActive = page === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      className={`w-full text-left px-3 py-2.5 text-sm font-semibold rounded-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-teal-300/50 ${
                        isActive
                          ? "bg-teal-600 text-white"
                          : "text-slate-300 hover:bg-white/8 hover:text-white"
                      }`}
                      onClick={() => handleNavigate(item.key)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="space-y-3 pt-4 border-t border-white/10">
              <div className="px-1">
                <div className="text-sm font-semibold text-white truncate">{currentUser.displayName}</div>
                <div className="text-xs text-teal-300 font-medium">{roleLabel}</div>
              </div>
              <button
                type="button"
                className="w-full py-2.5 bg-white/8 hover:bg-white/12 text-white text-sm font-semibold rounded-[10px] transition-colors focus:outline-none focus:ring-2 focus:ring-teal-300/50"
                onClick={onLogout}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppShell;
