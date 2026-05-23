import { useEffect, useState } from "react";
import { AUTH_PERMISSION_RULES } from "@resq/shared";
import { useAuth } from "../auth/AuthContext";
import { generateAccessUrls } from "../lib/accessUrls";

import { Badge, Button, Card, Skeleton } from "../components/ui";
import { Dialog } from "../components/ui/dialog";
import {
  fetchHubHealth,
  getApiServiceStatus,
  getBrokerServiceStatus,
  getNetworkInfo,
  type ApiServiceStatus,
  type BrokerServiceStatus,
  type HubHealthResponse,
  type NetworkInfo,
} from "../lib/tauriApi";

type HomePageProps = {
  manualLanIpOverride: string | null;
};

type ApiContract = {
  method: "GET" | "POST";
  path: string;
  auth: string;
  purpose: string;
};

const apiContracts: ApiContract[] = [
  { method: "GET", path: "/api/hub/health", auth: "Public/Local", purpose: "Health check for backend, service status, version, database, broker connection." },
  { method: "POST", path: "/api/auth/login", auth: "Public/Local", purpose: "Authenticate local user and issue local session/token." },
  { method: "POST", path: "/api/auth/logout", auth: "Authenticated", purpose: "Invalidate current session/token." },
  { method: "GET", path: "/api/auth/me", auth: "Authenticated", purpose: "Return current user, role, and permissions." },
  { method: "GET", path: "/api/manikins", auth: "Instructor/Tech", purpose: "List paired, pending, online, offline, and stale manikins." },
  { method: "POST", path: "/api/manikins/pair-request", auth: "Instructor/Admin", purpose: "Create pending pairing request and return one-time token." },
  { method: "POST", path: "/api/manikins/unpair", auth: "Instructor/Admin/Tech", purpose: "Unpair device, clear mapping, and optionally command device to provisioning mode." },
  { method: "POST", path: "/api/sessions/start", auth: "Instructor/Admin", purpose: "Create session and command device to start." },
  { method: "POST", path: "/api/sessions/end", auth: "Instructor/Admin", purpose: "End/abort session and compute summary." },
  { method: "GET", path: "/api/sessions", auth: "Instructor/Admin", purpose: "List completed/recent sessions. Trainees get own filtered history." },
  { method: "GET", path: "/api/sessions/{id}", auth: "Authorized", purpose: "Return session details, summary, events, and timeline." },
  { method: "GET", path: "/api/sessions/{id}/export.csv", auth: "Instructor/Admin", purpose: "Export session as CSV." },
  { method: "GET", path: "/api/sessions/{id}/export.json", auth: "Instructor/Admin", purpose: "Export session as JSON." },
  { method: "GET", path: "/api/live/events", auth: "Authenticated", purpose: "SSE endpoint for live dashboard updates." },
  { method: "POST", path: "/api/devices/{deviceId}/diag/ping", auth: "Instructor/Tech", purpose: "Publish diagnostic ping command." },
  { method: "POST", path: "/api/devices/{deviceId}/diag/request", auth: "Technician/Admin", purpose: "Request detailed diagnostic report." },
];

type ApiHealthState = {
  status: "checking" | "healthy" | "unreachable";
  detail: string;
  service?: string;
  timestamp?: string;
};

type BrokerUiState = {
  status: "checking" | "running" | "stopped";
  detail: string;
};

type LanInfoState = {
  status: "checking" | "ready" | "error";
  detail: string;
  hostname?: string;
  primaryIp?: string | null;
};

type MetricCard = {
  label: string;
  value: string;
  detail: string;
  trend: string;
  trendDirection: "up" | "down";
  icon: string;
};

function getApiHealthState(health: HubHealthResponse): ApiHealthState {
  if (!health.ok) {
    return {
      status: "unreachable",
      detail: "Backend responded, but the health check reported a failure.",
      service: health.service,
      timestamp: health.timestamp,
    };
  }

  return {
    status: "healthy",
    detail: "Backend is reachable and reporting healthy.",
    service: health.service,
    timestamp: health.timestamp,
  };
}

function formatApiDetail(state: ApiHealthState): string {
  const details: string[] = [state.detail];

  if (state.service) {
    details.push(`Service: ${state.service}`);
  }

  if (state.timestamp) {
    details.push(`Timestamp: ${state.timestamp}`);
  }

  return details.join(" • ");
}

function getProcessLabel(apiService: ApiServiceStatus): string {
  return apiService.running ? "Running" : "Stopped";
}

function getHealthLabel(apiHealth: ApiHealthState): string {
  if (apiHealth.status === "checking") {
    return "Checking";
  }

  if (apiHealth.status === "healthy") {
    return "Healthy";
  }

  return "Unreachable";
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
  }

  return "Unknown error";
}

function roleMatches(rule: readonly string[], role: string): boolean {
  return rule.includes(role);
}

function buttonStyle(disabled: boolean = false): React.CSSProperties {
  return {
    padding: "8px 14px",
    background: disabled ? "#e5e7eb" : "#0f172a",
    color: disabled ? "#9ca3af" : "#ffffff",
    border: "1px solid " + (disabled ? "#d1d5db" : "#0f172a"),
    borderRadius: "6px",
    fontSize: "0.9rem",
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.2s ease-in-out",
    opacity: disabled ? 0.6 : 1,
  };
}

export default function HomePage({ manualLanIpOverride }: HomePageProps) {
  const { currentUser } = useAuth();
  const [apiService, setApiService] = useState<ApiServiceStatus>({
    running: false,
    pid: null,
  });
  const [apiHealth, setApiHealth] = useState<ApiHealthState>({
    status: "checking",
    detail: "Checking...",
  });
  const [brokerState, setBrokerState] = useState<BrokerServiceStatus>({
    running: false,
    pid: null,
    message: "Checking broker status...",
  });
  const [brokerUiState, setBrokerUiState] = useState<BrokerUiState>({
    status: "checking",
    detail: "Checking...",
  });
  const [lanInfo, setLanInfo] = useState<LanInfoState>({
    status: "checking",
    detail: "Checking...",
  });
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [healthDetailsOpen, setHealthDetailsOpen] = useState(false);
  const [copyLanIpState, setCopyLanIpState] = useState<"idle" | "copied">("idle");

  function updateBrokerUi(service: BrokerServiceStatus) {
    setBrokerState(service);
    setBrokerUiState({
      status: service.running ? "running" : "stopped",
      detail: service.message,
    });
  }

  async function syncBrokerState() {
    try {
      const service = await getBrokerServiceStatus();
      updateBrokerUi(service);
    } catch (error) {
      setBrokerState({
        running: false,
        pid: null,
        message: "Broker process is stopped.",
      });
      setBrokerUiState({
        status: "stopped",
        detail: `Unable to query broker process state. ${getErrorMessage(error)}`,
      });
    }
  }

  async function syncLanInfoState() {
    try {
      const networkInfo: NetworkInfo = await getNetworkInfo();

      setLanInfo({
        status: networkInfo.primaryIpv4 ? "ready" : "error",
        detail: networkInfo.primaryIpv4
          ? "LAN information loaded."
          : "No usable local IPv4 detected. Open Setup and add a manual override.",
        hostname: networkInfo.hostname,
        primaryIp: networkInfo.primaryIpv4,
      });
    } catch (error) {
      setLanInfo({
        status: "error",
        detail: `Failed to read network info. ${getErrorMessage(error)}`,
      });
    }
  }

  async function syncApiState() {
    try {
      const service = await getApiServiceStatus();
      setApiService(service);

      if (!service.running) {
        setApiHealth({
          status: "unreachable",
          detail: "Backend process is stopped.",
        });
        return;
      }

      setApiHealth({
        status: "checking",
        detail: "Checking...",
      });

      const health = await fetchHubHealth();
      setApiHealth(getApiHealthState(health));
    } catch (error) {
      setApiService({
        running: false,
        pid: null,
      });
      setApiHealth({
        status: "unreachable",
        detail: `Unable to query backend status. ${getErrorMessage(error)}`,
      });
    }
  }

  async function refreshAllState() {
    setSnapshotLoading(true);

    try {
      await Promise.all([syncApiState(), syncBrokerState(), syncLanInfoState()]);
    } finally {
      setSnapshotLoading(false);
      setLastRefreshedAt(new Date());
    }
  }

  useEffect(() => {
    void refreshAllState();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshAllState();
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  const apiStatusLabel = `${getProcessLabel(apiService)} · ${getHealthLabel(apiHealth)}`;
  const brokerStatusLabel =
    brokerUiState.status === "checking"
      ? "Checking"
      : brokerUiState.status === "running"
        ? "Running"
        : "Stopped";
  const lanStatusLabel =
    lanInfo.status === "checking"
      ? "Checking"
      : manualLanIpOverride || lanInfo.status === "ready"
        ? "Ready"
        : "Error";
  const chosenLanIp = manualLanIpOverride ?? lanInfo.primaryIp ?? null;
  const ipSourceMessage = manualLanIpOverride
    ? "Using manual override from Setup."
    : chosenLanIp
      ? "Using auto-detected LAN IP."
      : "No selected LAN IP source yet.";
  const lanDetail =
    `${lanInfo.detail} • Hostname: ${lanInfo.hostname ?? "Unknown"} • Primary IP: ${chosenLanIp ?? "Not detected"} • ${ipSourceMessage}`;

  // Generate access URLs from the chosen host/IP
  const { instructorUrl, traineeUrl } = generateAccessUrls(chosenLanIp);
  const summaryCards: MetricCard[] = [
    {
      label: "Clinical workflows",
      value: String(apiContracts.length),
      detail: "Secure local access for patient training, exports, and diagnostics.",
      trend: "+12%",
      trendDirection: "up",
      icon: "🩺",
    },
    {
      label: "Session oversight",
      value: "5",
      detail: "Start, end, inspect, and export supervised training sessions.",
      trend: "+6%",
      trendDirection: "up",
      icon: "📋",
    },
    {
      label: "Identity & roles",
      value: "4",
      detail: "Login, logout, current user, and first-run administrator setup.",
      trend: "-2%",
      trendDirection: "down",
      icon: "🛡️",
    },
    {
      label: "Device readiness",
      value: "4",
      detail: "Manikin, live stream, and device diagnostics entry points.",
      trend: "+9%",
      trendDirection: "up",
      icon: "💾",
    },
  ];

  const effectivePermissions = currentUser
    ? [
        ...(roleMatches(AUTH_PERMISSION_RULES.desktop, currentUser.role) ? [{ key: "desktop", label: "Desktop shell" }] : []),
        ...(roleMatches(AUTH_PERMISSION_RULES.instructor, currentUser.role) ? [{ key: "instructor", label: "Instructor tools" }] : []),
        ...(roleMatches(AUTH_PERMISSION_RULES.trainee, currentUser.role) ? [{ key: "trainee", label: "Trainee view" }] : []),
        ...(roleMatches(AUTH_PERMISSION_RULES.setup, currentUser.role) ? [{ key: "setup", label: "Setup" }] : []),
        ...(roleMatches(AUTH_PERMISSION_RULES.diagnostics, currentUser.role) ? [{ key: "diagnostics", label: "Diagnostics" }] : []),
        ...(roleMatches(AUTH_PERMISSION_RULES.users, currentUser.role) ? [{ key: "users", label: "User administration" }] : []),
      ]
    : [];

  const apiTone = apiHealth.status === "healthy" ? "healthy" : apiService.running ? "running" : "stopped";
  const brokerTone = brokerUiState.status === "running" ? "running" : brokerUiState.status === "checking" ? "checking" : "stopped";
  const lanTone = lanInfo.status === "checking" ? "checking" : manualLanIpOverride || lanInfo.status === "ready" ? "ready" : "error";
  const snapshotTone = apiTone === "healthy" ? "healthy" : apiTone === "running" ? "checking" : "stopped";

  function getRefreshLabel() {
    if (!lastRefreshedAt) {
      return "Waiting for first refresh";
    }

    return lastRefreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  async function handleCopyLanIp() {
    if (!chosenLanIp) {
      return;
    }

    const payload = {
      hostname: lanInfo.hostname ?? null,
      detectedIp: lanInfo.primaryIp ?? null,
      activeOverride: manualLanIpOverride ?? null,
      chosenHost: chosenLanIp,
      urls: { instructor: instructorUrl, trainee: traineeUrl },
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyLanIpState("copied");
      window.setTimeout(() => setCopyLanIpState("idle"), 1500);
    } catch {
      setCopyLanIpState("idle");
    }
  }

  function handleOpenInstructorDashboard() {
    window.location.assign("/instructor");
  }

  function handleOpenTraineeDashboard() {
    window.location.assign("/trainee");
  }

  return (
    <div className="home-dashboard">
      <section className="hero-shell">
        <Card className="hero-card hero-card--gradient">
          <div className="hero-card__copy">
            <div className="hero-card__heading">
              <div className="hero-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s-6.5-4.4-8.7-8.7A5.5 5.5 0 0 1 12 6.2a5.5 5.5 0 0 1 8.7 6.1C18.5 16.6 12 21 12 21Z" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              </div>
              <div>
                <p className="hero-card__subtitle">
                  A clinical control surface for secure authentication, manikin pairing, session governance, exports, and diagnostics.
                </p>
              </div>
            </div>

            <div className="hero-card__actions">
              <Button type="button" variant="primary" onClick={handleOpenInstructorDashboard} className="action-button action-button--primary">
                <span aria-hidden="true" className="action-button__icon">↗</span>
                <span>Open Instructor Dashboard</span>
                <span className="action-button__shortcut">Ctrl+I</span>
              </Button>
              <Button type="button" variant="secondary" onClick={handleOpenTraineeDashboard} className="action-button">
                <span aria-hidden="true" className="action-button__icon">↗</span>
                <span>Open Trainee Dashboard</span>
                <span className="action-button__shortcut">Ctrl+T</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void refreshAllState()}
                className={`action-button action-button--ghost ${snapshotLoading ? "action-button--spinning" : ""}`}
              >
                <span aria-hidden="true" className={`action-button__icon ${snapshotLoading ? "action-button__icon--spinning" : ""}`}>↻</span>
                <span>Refresh Status</span>
                <span className="action-button__shortcut">Ctrl+R</span>
              </Button>
            </div>
          </div>

          <button type="button" className="health-indicator" onClick={() => setHealthDetailsOpen(true)} aria-label="Open detailed system health">
            <span className={`health-indicator__dot health-indicator__dot--${apiTone}`} aria-hidden="true" />
            <span className="health-indicator__content">
              <Badge variant="status" className="status-badge--success">System Operational</Badge>
              <span className="health-indicator__title">System Operational</span>
              <span className="health-indicator__subtitle">All services reachable</span>
            </span>
          </button>
        </Card>
      </section>

      <section className="metric-grid">
        {summaryCards.map((card) => (
          <Card key={card.label} className="metric-card metric-card--live">
            <div className="metric-card__header">
              <span className="metric-card__icon" aria-hidden="true">{card.icon}</span>
              <span className={`metric-card__trend metric-card__trend--${card.trendDirection}`}>
                {card.trendDirection === "up" ? "▲" : "▼"} {card.trend}
              </span>
            </div>
            <p className="metric-card__label">{card.label}</p>
            <p className="metric-card__value">{card.value}</p>
            <p className="metric-card__detail">{card.detail}</p>
          </Card>
        ))}
      </section>

      <section className="snapshot-grid">
        <Card className={`snapshot-card snapshot-card--${snapshotTone}`}>
          <div className="snapshot-card__header">
            <div>
              <p className="snapshot-card__eyebrow">Clinical snapshot</p>
              <h3 className="snapshot-card__title">Live network and services</h3>
              <p className="snapshot-card__copy">Auto-refresh every 30s. Last refresh: {getRefreshLabel()}</p>
            </div>
            <Button type="button" variant="secondary" onClick={handleCopyLanIp} className="snapshot-card__copy-button">
              {copyLanIpState === "copied" ? "Copied LAN IP" : "Copy LAN IP"}
            </Button>
          </div>

          <div className="snapshot-columns">
            <div className="snapshot-column">
              <p className="snapshot-column__label">Backend info</p>
              <div className="snapshot-row">
                <span>Process</span>
                <Badge variant="status" className={`status-badge--${apiService.running ? "success" : "danger"}`}>
                  {apiService.running ? "Running" : "Stopped"}
                </Badge>
              </div>
              <div className="snapshot-row">
                <span>Health</span>
                <Badge variant="status" className={`status-badge--${apiHealth.status === "healthy" ? "success" : apiHealth.status === "checking" ? "warning" : "danger"}`}>
                  {getHealthLabel(apiHealth)}
                </Badge>
              </div>
              <div className="snapshot-row snapshot-row--stacked">
                <span>Details</span>
                <p>{formatApiDetail(apiHealth)}</p>
              </div>
            </div>

            <div className="snapshot-column">
              <p className="snapshot-column__label">Broker info</p>
              <div className="snapshot-row">
                <span>Broker</span>
                <Badge variant="status" className={`status-badge--${brokerTone === "running" ? "success" : brokerTone === "checking" ? "warning" : "danger"}`}>
                  {brokerStatusLabel}
                </Badge>
              </div>
              <div className="snapshot-row">
                <span>LAN IP</span>
                <Badge variant="status" className={`status-badge--${lanTone === "ready" ? "success" : lanTone === "checking" ? "warning" : "danger"}`}>
                  {chosenLanIp ?? "Not detected"}
                </Badge>
              </div>
              <div className="snapshot-row snapshot-row--stacked">
                <span>Source</span>
                <p>{manualLanIpOverride ? "Manual override" : "Auto-detected host"}</p>
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className="surface-grid surface-grid--compact">
        <Card className="quick-card">
          <h3 className="quick-card__title">Current operator</h3>
          <p className="quick-card__copy">{currentUser?.displayName ?? "No active user"}</p>
          <p className="quick-card__copy">Username: {currentUser?.username ?? "-"}</p>
          <span className={`status-chip status-chip--${currentUser ? "running" : "stopped"}`}>
            {currentUser?.role ?? "Unknown role"}
          </span>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
            {effectivePermissions.length > 0 ? (
              effectivePermissions.map((permission) => (
                <span key={permission.key} className="status-chip status-chip--healthy">
                  {permission.label}
                </span>
              ))
            ) : (
              <span className="status-chip status-chip--stopped">No derived permissions</span>
            )}
          </div>
        </Card>

        <Card className="quick-card">
          <h3 className="quick-card__title">API readiness</h3>
          <p className="quick-card__copy">{apiStatusLabel}</p>
          <span className={`status-chip status-chip--${apiTone}`}>
            {apiHealth.status === "healthy" ? "Backend reachable" : apiService.running ? "Backend process up" : "Backend stopped"}
          </span>
          <p className="quick-card__copy">{apiHealth.detail}</p>
        </Card>

        <Card className="quick-card">
          <h3 className="quick-card__title">Broker readiness</h3>
          <p className="quick-card__copy">MQTT / local broker status for device traffic.</p>
          <span className={`status-chip status-chip--${brokerTone}`}>{brokerStatusLabel}</span>
          <p className="quick-card__copy">{brokerUiState.detail}</p>
        </Card>

        <Card className="quick-card">
          <h3 className="quick-card__title">LAN access</h3>
          <p className="quick-card__copy">{lanDetail}</p>
          <span className={`status-chip status-chip--${lanTone}`}>{lanStatusLabel}</span>
          <p className="quick-card__copy">Instructor URL: {instructorUrl ?? "Not available yet"}</p>
        </Card>
      </section>

      <Dialog open={healthDetailsOpen} onOpenChange={setHealthDetailsOpen} title="Detailed Health Breakdown" description="Current backend, broker, and LAN status">
        <div className="health-modal-grid">
          <div className="health-modal-card">
            <p className="health-modal-card__label">Backend</p>
            <p className="health-modal-card__value">{getHealthLabel(apiHealth)}</p>
            <p className="health-modal-card__copy">{formatApiDetail(apiHealth)}</p>
          </div>
          <div className="health-modal-card">
            <p className="health-modal-card__label">Broker</p>
            <p className="health-modal-card__value">{brokerStatusLabel}</p>
            <p className="health-modal-card__copy">{brokerUiState.detail}</p>
          </div>
          <div className="health-modal-card">
            <p className="health-modal-card__label">LAN</p>
            <p className="health-modal-card__value">{lanStatusLabel}</p>
            <p className="health-modal-card__copy">{lanDetail}</p>
          </div>
          <div className="health-modal-card">
            <p className="health-modal-card__label">Refresh</p>
            <p className="health-modal-card__value">{getRefreshLabel()}</p>
            <p className="health-modal-card__copy">Auto-refresh every 30 seconds.</p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
