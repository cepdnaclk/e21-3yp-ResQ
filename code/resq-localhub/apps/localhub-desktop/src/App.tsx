import { useState } from "react";
import HomePage from "./pages/HomePage";
import SetupPage from "./pages/SetupPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";

type Page = "home" | "setup" | "diagnostics";

export default function App() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={{ margin: 0 }}>ResQ Local Hub</h1>
        <p style={{ margin: "6px 0 0", color: "#4b5563" }}>
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
        {page === "home" && <HomePage />}
        {page === "setup" && <SetupPage />}
        {page === "diagnostics" && <DiagnosticsPage />}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    fontFamily: "Segoe UI, sans-serif",
    padding: "20px",
    color: "#111827",
    background: "#f9fafb",
    minHeight: "100vh"
  },
  header: {
    marginBottom: "16px"
  },
  nav: {
    display: "flex",
    gap: "8px",
    marginBottom: "18px"
  },
  main: {
    background: "#ffffff",
    borderRadius: "10px",
    border: "1px solid #e5e7eb",
    padding: "16px"
  }
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    border: "1px solid #d1d5db",
    background: active ? "#e5e7eb" : "#ffffff",
    color: "#111827",
    borderRadius: "8px",
    padding: "8px 12px",
    cursor: "pointer"
  };
}
