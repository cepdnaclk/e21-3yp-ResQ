import { useEffect, useState, type ReactNode } from "react";
import { fetchCloudHealth, type CloudHealth } from "../api/cloudApi";
import { navigate } from "../router";

interface AppShellProps {
  currentPath: string;
  children: ReactNode;
}

export function AppShell({ currentPath, children }: AppShellProps) {
  const [health, setHealth] = useState<CloudHealth | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCloudHealth()
      .then((response) => {
        if (active) {
          setHealth(response);
          setHealthError(false);
        }
      })
      .catch(() => {
        if (active) {
          setHealth(null);
          setHealthError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [currentPath]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Synced training review</p>
          <h1>ResQ Cloud Review</h1>
          <p className="header-subtitle">Read-only records from the ResQ cloud session archive.</p>
        </div>
        <div className={`health-pill ${healthError ? "health-pill--down" : "health-pill--up"}`}>
          <span className="health-dot" aria-hidden="true" />
          {healthError ? "API unavailable" : health ? `${health.status} · ${health.storageMode}` : "Checking API"}
        </div>
      </header>

      <nav className="main-nav" aria-label="Cloud review navigation">
        <NavLink href="/sessions" active={currentPath.startsWith("/sessions")}>Sessions</NavLink>
        <NavLink href="/analytics" active={currentPath === "/analytics"}>Analytics</NavLink>
      </nav>

      <main>{children}</main>

      <footer>
        Cloud review is read-only. Live training and device control remain in LocalHub.
      </footer>
    </div>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={active ? "nav-link nav-link--active" : "nav-link"}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
