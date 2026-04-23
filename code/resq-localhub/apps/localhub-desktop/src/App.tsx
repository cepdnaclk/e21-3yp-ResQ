import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import SetupPage from "./pages/SetupPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import InstructorDashboard from "./pages/InstructorDashboard";
import TraineeDashboard from "./pages/TraineeDashboard";
import { MANUAL_LAN_IP_STORAGE_KEY, sanitizeManualLanIp } from "./lib/accessHost";

type Page = "home" | "setup" | "diagnostics";
type RouteType = "desktop" | "instructor" | "trainee";

function getRouteFromPathname(): RouteType {
  const pathname = window.location.pathname;
  if (pathname === "/instructor" || pathname === "/instructor/") {
    return "instructor";
  }
  if (pathname === "/trainee" || pathname === "/trainee/") {
    return "trainee";
  }
  return "desktop";
}

export default function App() {
  const [route, setRoute] = useState<RouteType>("desktop");
  const [page, setPage] = useState<Page>("home");
  const [manualLanIpOverride, setManualLanIpOverride] = useState<string | null>(null);

  useEffect(() => {
    // Determine which route to render based on pathname
    setRoute(getRouteFromPathname());

    const saved = window.localStorage.getItem(MANUAL_LAN_IP_STORAGE_KEY);
    setManualLanIpOverride(sanitizeManualLanIp(saved ?? ""));
  }, []);

  // Render browser-safe dashboard pages that don't use Tauri APIs
  if (route === "instructor") {
    return <InstructorDashboard />;
  }

  if (route === "trainee") {
    return <TraineeDashboard />;
  }

  // Render desktop shell with Tauri-dependent pages
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

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em" }}>ResQ Local Hub</h1>
        <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "0.95rem", fontWeight: 400 }}>
          Windows-first local-first instructor desktop
        </p>
      </header>

      <nav style={styles.nav}>
        {/* Simple tab-like buttons keep the starter app easy to follow. */}
        <button style={tabStyle(page === "home")} onClick={() => setPage("home")}>Home</button>
        <button style={tabStyle(page === "setup")} onClick={() => setPage("setup")}>Setup</button>
        <button style={tabStyle(page === "diagnostics")} onClick={() => setPage("diagnostics")}>Diagnostics</button>
      </nav>

      <main style={styles.main}>
        {page === "home" && <HomePage manualLanIpOverride={manualLanIpOverride} />}
        {page === "setup" && (
          <SetupPage
            manualLanIpOverride={manualLanIpOverride}
            onApplyManualLanIpOverride={handleApplyManualLanIpOverride}
            onClearManualLanIpOverride={handleClearManualLanIpOverride}
          />
        )}
        {page === "diagnostics" && <DiagnosticsPage />}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "32px 24px",
    color: "#0f172a",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    minHeight: "100vh"
  },
  header: {
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "1px solid #e5e7eb"
  },
  nav: {
    display: "flex",
    gap: "12px",
    marginBottom: "24px",
    flexWrap: "wrap"
  },
  main: {
    background: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)"
  }
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#0f172a" : "#ffffff",
    color: active ? "#f8fafc" : "#0f172a",
    border: "1px solid " + (active ? "#0f172a" : "#e5e7eb"),
    borderRadius: "8px",
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.95rem",
    transition: "all 0.2s ease-in-out",
    boxShadow: active ? "0 2px 8px rgba(15, 23, 42, 0.12)" : "none",
  };
}
