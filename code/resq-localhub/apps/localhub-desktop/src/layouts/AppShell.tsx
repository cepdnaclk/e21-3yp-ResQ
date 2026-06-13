import { useEffect, useState, useMemo } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../types/auth";

type AppShellProps = {
  currentUser: AuthUser;
  connectionHealthy: boolean;
  lastApiSuccessAt: number | null;
  onLogout: () => void;
  page: string;
  setPage: (page: any) => void;
  children: ReactNode;
};

export function AppShell({
  currentUser,
  connectionHealthy,
  lastApiSuccessAt,
  onLogout,
  page,
  setPage,
  children,
}: AppShellProps) {
  const [liveTime, setLiveTime] = useState(new Date());
  const [navOpen, setNavOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveTime(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const navItems = useMemo(() => {
    if (currentUser?.role === "ADMIN") {
      return [
        { key: "home" as const, label: "Home" },
        { key: "users" as const, label: "Users" },
        { key: "courses" as const, label: "Courses" },
        { key: "sessions" as const, label: "Session History" },
        { key: "diagnostics" as const, label: "Diagnostics" },
      ];
    } else if (currentUser?.role === "INSTRUCTOR") {
      return [
        { key: "home" as const, label: "Home" },
        { key: "courses" as const, label: "My Courses" },
        { key: "start-session" as const, label: "Start Training" },
        { key: "live-sessions" as const, label: "Active Sessions" },
        { key: "instructor" as const, label: "Manikins" },
        { key: "sessions" as const, label: "Recent Sessions" },
      ];
    } else {
      return [
        { key: "home" as const, label: "Home" },
      ];
    }
  }, [currentUser]);

  function copyDiagnostics() {
    const payload = {
      user: currentUser?.displayName ?? "unknown",
      role: currentUser?.role ?? "unknown",
      page,
      time: liveTime.toISOString(),
      connectionHealthy,
      lastApiSuccessAt,
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    alert("Diagnostics snapshot copied to clipboard.");
  }

  return (
    <div className="min-h-screen bg-[#f4f6f8] flex flex-col md:flex-row font-sans antialiased text-slate-800">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex w-64 bg-[#0a232c] flex-col justify-between shrink-0 text-slate-300">
        <div className="flex flex-col">
          {/* Logo & Title area */}
          <div className="p-6 border-b border-[#11313c] flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center p-1.5 shrink-0 shadow-md shadow-teal-500/20">
              <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
            </div>
            <div>
              <h1 className="text-sm font-black text-white tracking-tight leading-tight">ResQ Local Hub</h1>
              <p className="text-[9px] text-teal-400 font-extrabold uppercase tracking-widest mt-0.5">CPR Training Suite</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5 mt-4">
            <div className="px-3.5 py-1 text-[9px] font-bold text-teal-500 uppercase tracking-widest mb-2">
              Menu Directory
            </div>
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`w-full flex items-center px-4 py-3 text-xs font-bold rounded-xl transition-all duration-200 ${
                  page === item.key
                    ? "bg-teal-600 text-white font-extrabold shadow-md shadow-teal-500/10"
                    : "text-slate-400 hover:bg-[#11313c] hover:text-white"
                }`}
                onClick={() => setPage(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* User Card at bottom of Sidebar */}
        <div className="p-4 border-t border-[#11313c] bg-[#081d25] flex flex-col gap-2">
          <div className="px-2">
            <div className="text-xs font-bold text-white truncate">{currentUser.displayName}</div>
            <div className="text-[10px] text-teal-400 font-semibold uppercase tracking-wider">{currentUser.role}</div>
          </div>
          <button
            type="button"
            className="w-full mt-1.5 py-2.5 text-center text-xs font-bold bg-[#11313c] hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 rounded-xl transition-all duration-200"
            onClick={onLogout}
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Right Content Area Wrapper */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-100 shadow-[0_2px_8px_rgba(15,23,42,0.01)] px-6 py-4.5 flex items-center justify-between">
          <div className="flex items-center gap-3 md:hidden">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center p-1.5">
              <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain brightness-0 invert" />
            </div>
            <h1 className="text-sm font-black text-slate-800">ResQ Local Hub</h1>
          </div>

          <div className="hidden md:block">
            <span className="text-xs font-bold text-slate-400 bg-slate-50 border border-slate-100 rounded-full px-3 py-1">
              Active Instructor Session
            </span>
          </div>

          {/* Header Action Bar */}
          <div className="flex items-center gap-3">
            {/* Live Clock */}
            <div className="hidden sm:flex items-center px-3 py-1 bg-slate-50 border border-slate-100 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {liveTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </div>

            {/* Connection badge */}
            <div className="relative group flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-100 rounded-full text-xs font-semibold text-slate-600">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionHealthy ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                }`}
              />
              <span>{connectionHealthy ? "Live Connection" : "Service Offline"}</span>
              <div className="absolute right-0 top-full mt-2 w-56 hidden group-hover:block bg-slate-800 text-white text-[10px] p-2.5 rounded-xl shadow-xl leading-relaxed pointer-events-none z-50">
                {connectionHealthy
                  ? `LocalHub API ready. Last verified: ${
                      lastApiSuccessAt ? new Date(lastApiSuccessAt).toLocaleTimeString() : "Just now"
                    }`
                  : "Unable to reach training host. Check connection state."}
              </div>
            </div>

            {/* Mobile Nav Toggle */}
            <button
              type="button"
              className="md:hidden text-slate-500 hover:text-slate-800 p-1.5"
              onClick={() => setNavOpen(true)}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 p-6 sm:p-8 lg:p-10 max-w-7xl mx-auto w-full transition-all duration-300">
          {children}
        </main>
      </div>

      {/* Drawer Overlay for Mobile */}
      {navOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex justify-end"
          onClick={() => setNavOpen(false)}
        >
          <div
            className="w-64 bg-[#0a232c] text-slate-300 h-full p-6 flex flex-col justify-between shadow-2xl animate-slideLeft"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-xs font-bold text-teal-500 uppercase tracking-widest mb-6">Menu Directory</h2>
              <div className="space-y-1.5">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all duration-150 ${
                      page === item.key
                        ? "bg-teal-600 text-white"
                        : "text-slate-400 hover:bg-[#11313c] hover:text-white"
                    }`}
                    onClick={() => {
                      setPage(item.key);
                      setNavOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="w-full py-3 bg-[#11313c] hover:bg-[#184453] text-white text-xs font-bold rounded-xl transition-colors"
              onClick={() => setNavOpen(false)}
            >
              Close Menu
            </button>
          </div>
        </div>
      )}

      {/* Floating Assistive Ring (Diagnostics helper) */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-900 text-white shadow-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition-all hover:scale-105"
          onClick={() => setQuickActionsOpen(!quickActionsOpen)}
          title="Quick Actions"
        >
          <span className="text-lg font-bold">⌘</span>
        </button>

        {quickActionsOpen && (
          <div className="absolute bottom-12 right-0 bg-white border border-slate-100 rounded-2xl shadow-2xl p-3.5 w-52 flex flex-col gap-1 animate-fadeIn">
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 rounded-lg transition-colors font-semibold"
              onClick={() => {
                setPage("home");
                setQuickActionsOpen(false);
              }}
            >
              Go to Home Page
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 rounded-lg transition-colors font-semibold"
              onClick={() => {
                copyDiagnostics();
                setQuickActionsOpen(false);
              }}
            >
              Copy Technical Snapshot
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors font-semibold border-t border-slate-100 mt-2.5 pt-2"
              onClick={() => {
                onLogout();
                setQuickActionsOpen(false);
              }}
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AppShell;
