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
    const items = [
      { key: "home" as const, label: "Home" },
      { key: "instructor" as const, label: "Instructor Center" },
      { key: "sessions" as const, label: "Session History" },
      ...(currentUser?.role === "ADMIN"
        ? [
            { key: "users" as const, label: "User Management" },
            { key: "diagnostics" as const, label: "Technician Diagnostics" },
          ]
        : []),
    ];
    return items;
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
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center p-1.5 shrink-0">
            <img src="/resq-logo-dark-512.png" alt="ResQ Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">ResQ Local Hub</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Real-time local CPR clinical training dashboard</p>
          </div>
        </div>

        {/* Status / Actions bar */}
        <div className="flex items-center gap-3">
          {/* Time Display */}
          <div className="hidden md:flex items-center px-3 py-1 bg-gray-100 rounded-full text-xs font-semibold text-gray-600">
            {liveTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </div>

          {/* Connection status */}
          <div className="relative group flex items-center gap-1.5 px-3 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs font-medium text-gray-700">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionHealthy ? "bg-green-500 animate-pulse" : "bg-red-500"
              }`}
            />
            <span>{connectionHealthy ? "Connected" : "Offline"}</span>
            <div className="absolute right-0 top-full mt-2 w-48 hidden group-hover:block bg-gray-900 text-white text-[10px] p-2 rounded shadow-lg pointer-events-none z-50">
              {connectionHealthy
                ? `System healthy. Last checked: ${
                    lastApiSuccessAt ? new Date(lastApiSuccessAt).toLocaleTimeString() : "Just now"
                  }`
                : "Unable to contact local hub service. Please check connections."}
            </div>
          </div>

          {/* Logout */}
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 font-medium transition-colors"
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row relative">
        {/* Sidebar for screens medium and larger */}
        <aside className="hidden md:block w-64 bg-white border-r border-gray-200 shrink-0">
          <nav className="p-4 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  page === item.key
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                onClick={() => setPage(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>

      {/* Mobile Sticky Navigation Bar */}
      <nav className="md:hidden sticky bottom-0 z-30 bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-around">
        {navItems.slice(0, 3).map((item) => (
          <button
            key={item.key}
            type="button"
            className={`flex flex-col items-center gap-0.5 text-xs font-semibold ${
              page === item.key ? "text-blue-600" : "text-gray-500"
            }`}
            onClick={() => setPage(item.key)}
          >
            <span className="capitalize">{item.key === "sessions" ? "History" : item.key}</span>
          </button>
        ))}
        <button
          type="button"
          className="flex flex-col items-center gap-0.5 text-xs font-semibold text-gray-500"
          onClick={() => setNavOpen(true)}
        >
          <span>More</span>
        </button>
      </nav>

      {/* Navigation Overlay/Drawer for Mobile */}
      {navOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex justify-end"
          onClick={() => setNavOpen(false)}
        >
          <div
            className="w-64 bg-white h-full p-6 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-bold text-gray-900 mb-6">Navigation</h2>
              <div className="space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      page === item.key
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-50"
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
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-sm font-medium rounded-lg"
              onClick={() => setNavOpen(false)}
            >
              Close Menu
            </button>
          </div>
        </div>
      )}

      {/* Floating Assistive Ring (Diagnostics helper) */}
      <div className={`fixed bottom-16 right-4 z-40 md:bottom-6 md:right-6`}>
        <button
          type="button"
          className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all hover:scale-105"
          onClick={() => setQuickActionsOpen(!quickActionsOpen)}
          title="Quick Actions"
        >
          <span className="text-lg font-bold">⌘</span>
        </button>

        {quickActionsOpen && (
          <div className="absolute bottom-12 right-0 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-48 flex flex-col gap-1.5 animate-fadeIn">
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg transition-colors font-medium"
              onClick={() => {
                setPage("home");
                setQuickActionsOpen(false);
              }}
            >
              Go to Home Page
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg transition-colors font-medium"
              onClick={() => {
                copyDiagnostics();
                setQuickActionsOpen(false);
              }}
            >
              Copy Technical Snapshot
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium border-t border-gray-100 mt-1 pt-2"
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
