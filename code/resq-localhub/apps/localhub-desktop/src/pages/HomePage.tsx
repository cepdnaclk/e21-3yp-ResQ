import { useEffect, useState } from "react";
import { generateAccessUrls } from "../lib/accessUrls";
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

  useEffect(() => {
    let isActive = true;

    async function loadApiState() {
      if (!isActive) {
        return;
      }

      await Promise.all([syncApiState(), syncBrokerState(), syncLanInfoState()]);
    }

    loadApiState();

    return () => {
      isActive = false;
    };
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
  const { instructorUrl } = generateAccessUrls(chosenLanIp);
  const summaryCards = [
    {
      label: "REST contracts",
      value: String(apiContracts.length),
      detail: "Frontend aligned with the profile endpoints in the attached API baseline.",
    },
    {
      label: "Session surface",
      value: "5",
      detail: "Start, end, list, inspect, and export completed sessions.",
    },
    {
      label: "Auth surface",
      value: "4",
      detail: "Login, logout, current user, and first-run admin setup.",
    },
    {
      label: "Device ops",
      value: "4",
      detail: "Manikin, live stream, and device diagnostics entry points.",
    },
  ];

  const apiTone = apiHealth.status === "healthy" ? "healthy" : apiService.running ? "running" : "stopped";
  const brokerTone = brokerUiState.status === "running" ? "running" : brokerUiState.status === "checking" ? "checking" : "stopped";
  const lanTone = lanInfo.status === "checking" ? "checking" : manualLanIpOverride || lanInfo.status === "ready" ? "ready" : "error";

  function handleOpenInstructorDashboard() {
    window.location.assign("/instructor");
  }

  function handleOpenTraineeDashboard() {
    window.location.assign("/trainee");
  }

  async function loadAllState() {
    await Promise.all([syncApiState(), syncBrokerState(), syncLanInfoState()]);
  }

  return (
    <div className="home-dashboard">
      <section className="panel hero-layout">
        <div className="panel hero-panel">
          <p className="panel__eyebrow">10. API and MQTT Contracts</p>
          <h2 className="panel__title">10.1 Backend REST API Baseline</h2>
          <p className="panel__description">
            A contract-first control surface for local authentication, manikin pairing, session control, exports, and diagnostics.
          </p>

          <div className="hero-panel__actions">
            <button type="button" className="button button--primary" onClick={handleOpenInstructorDashboard}>
              Open Instructor Dashboard
            </button>
            <button type="button" className="button button--secondary" onClick={handleOpenTraineeDashboard}>
              Open Trainee Dashboard
            </button>
            <button type="button" className="button button--ghost" onClick={loadAllState}>
              Refresh Status
            </button>
          </div>
        </div>

        <div className="quick-card">
          <span className={`status-chip status-chip--${apiTone}`}>{apiStatusLabel}</span>
          <h3 className="quick-card__title">Live service snapshot</h3>
          <p className="quick-card__copy">{formatApiDetail(apiHealth)}</p>
          <p className="quick-card__copy">Broker: {brokerUiState.detail}</p>
          <p className="quick-card__copy">LAN IP: {chosenLanIp ?? "Not detected"}</p>
          <p className="quick-card__copy">Source: {manualLanIpOverride ? "Manual override" : "Auto-detected host"}</p>
          <div className="hero-panel__actions">
            <span className={`status-chip status-chip--${brokerTone}`}>{brokerStatusLabel}</span>
            <span className={`status-chip status-chip--${lanTone}`}>{lanStatusLabel}</span>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="metric-card">
            <p className="metric-card__label">{card.label}</p>
            <p className="metric-card__value">{card.value}</p>
            <p className="metric-card__detail">{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="panel table-panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Backend REST API baseline</p>
            <h3 className="panel__title">Relevant API calls for the frontend profile</h3>
            <p className="panel__description">
              The table mirrors the routes in the contract screenshot and keeps the frontend focused on the same local-first workflow.
            </p>
          </div>
          <span className="panel__tag">{apiContracts.length} endpoints</span>
        </div>

        <div className="table-wrap">
          <table className="contracts-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Auth</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {apiContracts.map((contract) => (
                <tr key={`${contract.method}-${contract.path}`}>
                  <td><span className={`method-badge method-badge--${contract.method.toLowerCase()}`}>{contract.method}</span></td>
                  <td><code>{contract.path}</code></td>
                  <td><span className="auth-badge">{contract.auth}</span></td>
                  <td>{contract.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-grid">
        <article className="quick-card">
          <h3 className="quick-card__title">API readiness</h3>
          <p className="quick-card__copy">{apiStatusLabel}</p>
          <span className={`status-chip status-chip--${apiTone}`}>
            {apiHealth.status === "healthy" ? "Backend reachable" : apiService.running ? "Backend process up" : "Backend stopped"}
          </span>
          <p className="quick-card__copy">{apiHealth.detail}</p>
        </article>

        <article className="quick-card">
          <h3 className="quick-card__title">Broker readiness</h3>
          <p className="quick-card__copy">MQTT / local broker status for device traffic.</p>
          <span className={`status-chip status-chip--${brokerTone}`}>{brokerStatusLabel}</span>
          <p className="quick-card__copy">{brokerUiState.detail}</p>
        </article>

        <article className="quick-card">
          <h3 className="quick-card__title">LAN access</h3>
          <p className="quick-card__copy">{lanDetail}</p>
          <span className={`status-chip status-chip--${lanTone}`}>{lanStatusLabel}</span>
          <p className="quick-card__copy">Instructor URL: {instructorUrl ?? "Not available yet"}</p>
        </article>
      </section>
    </div>
  );
}
