import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchBrowserHealth } from "../lib/browserHealthApi";
import { fetchManikinRegistry } from "../lib/browserManikinRegistryApi";
import { fetchCompletedSessions } from "../lib/browserSessionsApi";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";

// The shape of a quick action card shown in the actions grid
type QuickAction = {
  id: string;
  title: string;
  description: string;
  buttonLabel: string;
  variant: "primary" | "secondary" | "ghost";
  onClick: () => void;
  // Only show this action for these roles. Empty means show to all.
  roles?: string[];
};

export default function HomePage({
  manualLanIpOverride: _unused,
}: {
  manualLanIpOverride: string | null;
}) {
  const { currentUser } = useAuth();

  // Simple system readiness — just green or red, no technical detail
  const [systemReady, setSystemReady] = useState<boolean | null>(null);

  // Stats shown in the summary row
  const [manikinCount, setManikinCount] = useState<number | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Help popup
  const [helpOpen, setHelpOpen] = useState(false);

  // Welcome popup shown on first visit (stored in localStorage)
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  // Load system status and stats on mount
  useEffect(() => {
    async function loadAll() {
      setStatsLoading(true);

      // Check if the system backend is reachable — shown as simple Ready/Not Ready
      try {
        const health = await fetchBrowserHealth();
        setSystemReady(health.ok);
      } catch {
        setSystemReady(false);
      }

      // Load manikin counts
      try {
        const manikins = await fetchManikinRegistry();
        setManikinCount(manikins.length);
        setOnlineCount(manikins.filter((m) => m.online).length);
      } catch {
        setManikinCount(0);
        setOnlineCount(0);
      }

      // Load recent session count
      try {
        const sessions = await fetchCompletedSessions();
        setSessionCount(sessions.length);
      } catch {
        setSessionCount(0);
      }

      setStatsLoading(false);
    }

    void loadAll();

    // Show welcome popup on first visit ever
    const hasVisited = localStorage.getItem("resq_home_visited");
    if (!hasVisited) {
      setWelcomeOpen(true);
      localStorage.setItem("resq_home_visited", "true");
    }
  }, []);

  function navigateTo(path: string) {
    window.location.assign(path);
  }

  // Quick action cards — each one navigates somewhere or opens a popup.
  // Filtered by role so instructors see instructor actions, etc.
  const quickActions: QuickAction[] = [
    {
      id: "help",
      title: "Help & Getting Started",
      description:
        "New to ResQ? Learn how to pair a manikin, start a session, and read your results.",
      buttonLabel: "View Guide",
      variant: "ghost",
      onClick: () => setHelpOpen(true),
    },
  ];

  // Filter actions based on the current user's role
  const visibleActions = quickActions.filter(
    (action) =>
      !action.roles ||
      action.roles.includes(currentUser?.role ?? "")
  );

  // Greeting message based on time of day — makes it feel personal
  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  return (
    <div className="home-dashboard">

      {/* ── Welcome section ───────────────────────────────────────────── */}
      <section className="panel hero-layout">
        <div className="panel hero-panel">
          <p className="panel__description">
            {getGreeting()},{" "}
            <strong>{currentUser?.displayName ?? "there"}</strong>!
            Welcome to ResQ — your local CPR training hub.
          </p>

          {/* System readiness indicator — plain language, no tech jargon */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "12px 0" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "999px",
                fontWeight: 600,
                fontSize: "0.9rem",
                background: systemReady === null
                  ? "#e2e8f0"
                  : systemReady
                  ? "#dcfce7"
                  : "#fee2e2",
                color: systemReady === null
                  ? "#334155"
                  : systemReady
                  ? "#166534"
                  : "#991b1b",
              }}
            >
              {/* Simple coloured dot */}
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: systemReady === null
                    ? "#94a3b8"
                    : systemReady
                    ? "#16a34a"
                    : "#dc2626",
                }}
              />
              {systemReady === null
                ? "Checking system..."
                : systemReady
                ? "System ready"
                : "System offline — check connections"}
            </span>
          </div>

          <div className="hero-panel__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() =>
                navigateTo(
                  currentUser?.role === "TRAINEE" ? "/trainee" : "/instructor"
                )
              }
            >
              {currentUser?.role === "TRAINEE"
                ? "Open My Dashboard"
                : "Open Instructor Dashboard"}
            </button>      
          </div>
        </div>

        {/* Stats snapshot — counts only, no technical labels */}
        <div className="quick-card">
          <h3 className="quick-card__title">At a glance</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "12px",
              margin: "14px 0",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {statsLoading ? "—" : onlineCount ?? 0}
              </p>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>
                Manikins online
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {statsLoading ? "—" : manikinCount ?? 0}
              </p>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>
                Total manikins
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {statsLoading ? "—" : sessionCount ?? 0}
              </p>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>
                Sessions logged
              </p>
            </div>
          </div>

          {/* Role badge */}
          <div style={{ marginTop: "8px" }}>
            <span
              className={`status-chip status-chip--${
                currentUser?.role === "ADMIN"
                  ? "healthy"
                  : currentUser?.role === "INSTRUCTOR"
                  ? "running"
                  : "checking"
              }`}
            >
              {currentUser?.role ?? "Unknown role"}
            </span>
          </div>
        </div>
      </section>

      {/* ── Quick action cards ────────────────────────────────────────── */}
      <section className="metric-grid" style={{ marginTop: "20px" }}>
        {visibleActions.map((action) => (
          <article key={action.id} className="metric-card">
            <p className="metric-card__label">{action.title}</p>
            <p
              className="metric-card__detail"
              style={{ minHeight: "48px" }}
            >
              {action.description}
            </p>
            <div style={{ marginTop: "12px" }}>
              <Button variant={action.variant} onClick={action.onClick}>
                {action.buttonLabel}
              </Button>
            </div>
          </article>
        ))}
      </section>

      {/* ── Role-specific tip ─────────────────────────────────────────── */}
      <section style={{ marginTop: "20px" }}>
        <Card style={{ padding: "16px 20px" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "#475569",
              lineHeight: 1.6,
            }}
          >
            {currentUser?.role === "ADMIN" && (
              <>
                As an <strong>Admin</strong>, you can manage users, pair
                manikins, start sessions, and export reports. Use the
                navigation above to access all features.
              </>
            )}
            {currentUser?.role === "INSTRUCTOR" && (
              <>
                As an <strong>Instructor</strong>, open the Instructor
                Dashboard to pair manikins, start training sessions, and
                monitor live CPR performance for your trainees.
              </>
            )}
            {currentUser?.role === "TRAINEE" && (
              <>
                As a <strong>Trainee</strong>, your instructor will start a
                session for you. Once active, open the Trainee Dashboard or
                scan the QR code shown by your instructor to see live
                feedback.
              </>
            )}
            {!currentUser?.role && (
              <>
                Use the navigation above to access the dashboards and tools
                available to you.
              </>
            )}
          </p>
        </Card>
      </section>

      {/* ── Help popup ────────────────────────────────────────────────── */}
      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Getting Started with ResQ"
        description="A quick guide to running your first training session"
      >
        <div style={{ display: "grid", gap: "16px" }}>
          <div>
            <p
              style={{
                margin: "0 0 4px 0",
                fontWeight: 600,
                fontSize: "0.95rem",
                color: "#0f172a",
              }}
            >
              Step 1 — Pair a manikin
            </p>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#475569" }}>
              Go to the Instructor Dashboard and find the "Pair New Manikin"
              section. Enter the Device ID printed on the manikin and click
              Generate Pairing QR. The person setting up the manikin scans
              the QR code to complete the connection.
            </p>
          </div>

          <div>
            <p
              style={{
                margin: "0 0 4px 0",
                fontWeight: 600,
                fontSize: "0.95rem",
                color: "#0f172a",
              }}
            >
              Step 2 — Start a session
            </p>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#475569" }}>
              Once a manikin shows as Online in the Live Manikins section,
              select a trainee and click Start Session. The manikin will
              begin recording compressions immediately.
            </p>
          </div>

          <div>
            <p
              style={{
                margin: "0 0 4px 0",
                fontWeight: 600,
                fontSize: "0.95rem",
                color: "#0f172a",
              }}
            >
              Step 3 — Share the trainee link
            </p>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#475569" }}>
              After starting a session, a QR code appears on screen. The
              trainee scans it with their phone to open the live feedback
              dashboard showing their depth, rate, and coaching cues in
              real time.
            </p>
          </div>

          <div>
            <p
              style={{
                margin: "0 0 4px 0",
                fontWeight: 600,
                fontSize: "0.95rem",
                color: "#0f172a",
              }}
            >
              Step 4 — Review and export
            </p>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#475569" }}>
              End the session when done. A summary appears immediately with
              scores, average depth, rate, and recoil results. You can
              download the full session report as CSV or JSON for records.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="primary" onClick={() => setHelpOpen(false)}>
            Got it
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── First-visit welcome popup ─────────────────────────────────── */}
      <Dialog
        open={welcomeOpen}
        onOpenChange={setWelcomeOpen}
        title={`Welcome to ResQ, ${currentUser?.displayName ?? "there"}!`}
        description="Your local-first CPR training hub is ready"
      >
        <div style={{ display: "grid", gap: "12px" }}>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "#475569" }}>
            ResQ lets you run CPR training sessions with instrumented
            manikins, give trainees real-time feedback on their technique,
            and export results for review — all without needing an internet
            connection.
          </p>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "#475569" }}>
            You're logged in as{" "}
            <strong>{currentUser?.role ?? "a user"}</strong>.{" "}
            {currentUser?.role === "TRAINEE"
              ? "Your instructor will guide you from here."
              : "Use the navigation above to get started."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setHelpOpen(true)}>
            Show me how it works
          </Button>
          <Button variant="primary" onClick={() => setWelcomeOpen(false)}>
            Let's go
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}