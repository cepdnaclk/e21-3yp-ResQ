import { useEffect, useState } from "react";
import StatusCard from "../components/StatusCard";
import QrPanel from "../components/QrPanel";
import LogPanel from "../components/LogPanel";
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
  const qrUnavailableMessage = chosenLanIp
    ? "Unable to generate URLs for unknown reason."
    : "No selected LAN IP source yet. Open Setup to auto-detect or manually set an IP.";

  function handleOpenInstructorDashboard() {
    window.location.assign("/instructor");
  }

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <div>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.01em" }}>Home</h2>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.95rem" }}>
          Local service status and quick operational overview.
        </p>
        <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            style={buttonStyle(false)}
            onClick={handleOpenInstructorDashboard}
          >
            Open Instructor Dashboard (In-App)
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        <StatusCard
          title="API Status"
          status={apiStatusLabel}
          detail={formatApiDetail(apiHealth)}
          statusTone={apiHealth.status === "healthy" ? "healthy" : apiService.running ? "running" : "stopped"}
        />
        <StatusCard
          title="Broker Status"
          status={brokerStatusLabel}
          detail={brokerUiState.detail}
          statusTone={brokerUiState.status === "running" ? "running" : brokerUiState.status === "checking" ? "checking" : "stopped"}
        />
        <StatusCard 
          title="LAN Info" 
          status={lanStatusLabel} 
          detail={lanDetail}
          statusTone={lanStatusLabel === "Ready" ? "ready" : lanInfo.status === "checking" ? "checking" : "error"}
        />
      </div>

      <QrPanel instructorUrl={instructorUrl} unavailableMessage={qrUnavailableMessage} />
      <LogPanel />
    </div>
  );
}
