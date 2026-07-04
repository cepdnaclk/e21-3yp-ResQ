import { useEffect, useState, type ReactNode } from "react";
import { fetchCloudHealth, type CloudHealth, type CloudUser } from "../api/cloudApi";
import { navigate } from "../router";

interface AppShellProps {
  currentPath: string;
  user: CloudUser;
  onLogout: () => void;
  children: ReactNode;
}

export function AppShell({ currentPath, user, onLogout, children }: AppShellProps) {
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
          <p className="header-subtitle">Protected records from the ResQ cloud session archive.</p>
        </div>
        <div className="header-actions">
          <div className={`health-pill ${healthError ? "health-pill--down" : "health-pill--up"}`}>
            <span className="health-dot" aria-hidden="true" />
            {healthError ? "API unavailable" : health ? `${health.status} | ${health.storageMode}` : "Checking API"}
          </div>
          <div className="user-menu">
            <span><strong>{user.displayName}</strong><small>{user.role}</small></span>
            <button onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </header>

      <nav className="main-nav" aria-label="Cloud review navigation">
        {user.role !== "TRAINEE" ? (
          <>
            <NavLink href="/sessions" active={currentPath.startsWith("/sessions")}>Sessions</NavLink>
            <NavLink href="/reports" active={currentPath === "/reports"}>Session Reports</NavLink>
            <NavLink href="/analytics" active={currentPath === "/analytics"}>Analytics</NavLink>
            <NavLink href="/management/courses" active={currentPath.startsWith("/management/courses")}>Courses</NavLink>
          </>
        ) : (
          <>
            <NavLink href="/reports" active={currentPath === "/reports"}>Session Reports</NavLink>
          </>
        )}
        {user.role === "ADMIN" ? (
          <>
            <span className="nav-divider" aria-hidden="true" />
            <NavLink href="/management/users" active={currentPath === "/management/users"}>Users</NavLink>
          </>
        ) : null}
        <NavLink href="/me" active={currentPath === "/me"}>
          {user.role === "TRAINEE" ? "My History" : "My Account"}
        </NavLink>
      </nav>

      <div className="development-notice">
        Local development auth/RBAC MVP - production identity integration is not enabled.
      </div>

      <main>{children}</main>

      <footer>
        Live training and device control remain in LocalHub.
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
