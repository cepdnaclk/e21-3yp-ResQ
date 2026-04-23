import { useEffect, useState } from "react";
import StatusCard from "../components/StatusCard";
import QrPanel from "../components/QrPanel";
import LogPanel from "../components/LogPanel";
import {
  fetchHubHealth,
  getApiServiceStatus,
  getBrokerServiceStatus,
  startApiService,
  startBrokerService,
  stopApiService,
  stopBrokerService,
  type ApiServiceStatus,
  type BrokerServiceStatus,
  type HubHealthResponse,
} from "../lib/tauriApi";

type ApiHealthState = {
  status: "checking" | "healthy" | "unreachable";
  detail: string;
  service?: string;
  timestamp?: string;
};

const STARTUP_CHECK_DELAY_MS = 2000;

type BrokerUiState = {
  status: "checking" | "running" | "stopped";
  detail: string;
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function HomePage() {
  const [apiService, setApiService] = useState<ApiServiceStatus>({
    running: false,
    pid: null,
  });
  const [apiHealth, setApiHealth] = useState<ApiHealthState>({
    status: "checking",
    detail: "Checking...",
  });
  const [actionState, setActionState] = useState<"idle" | "starting" | "stopping">("idle");
  const [brokerActionState, setBrokerActionState] = useState<"idle" | "starting" | "stopping">("idle");
  const [brokerState, setBrokerState] = useState<BrokerServiceStatus>({
    running: false,
    pid: null,
    message: "Checking broker status...",
  });
  const [brokerUiState, setBrokerUiState] = useState<BrokerUiState>({
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
    const service = await getBrokerServiceStatus();
    updateBrokerUi(service);
  }

  async function syncApiState() {
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

    try {
      const health = await fetchHubHealth();
      setApiHealth(getApiHealthState(health));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      setApiHealth({
        status: "unreachable",
        detail: `Unable to reach the backend. ${message}`,
      });
    }
  }

  useEffect(() => {
    let isActive = true;

    async function loadApiState() {
      try {
        await Promise.all([syncApiState(), syncBrokerState()]);
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unknown error";

        setApiService({
          running: false,
          pid: null,
        });
        setApiHealth({
          status: "unreachable",
          detail: `Unable to query backend process state. ${message}`,
        });

        setBrokerUiState({
          status: "stopped",
          detail: `Unable to query broker process state. ${message}`,
        });
      }
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

  async function handleStartApi() {
    if (actionState !== "idle") {
      return;
    }

    setActionState("starting");

    try {
      const service = await startApiService();
      setApiService(service);
      setApiHealth({
        status: "checking",
        detail: "Checking...",
      });

      await sleep(STARTUP_CHECK_DELAY_MS);
      await syncApiState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      setApiService({
        running: false,
        pid: null,
      });
      setApiHealth({
        status: "unreachable",
        detail: `Unable to start the backend. ${message}`,
      });
    } finally {
      setActionState("idle");
    }
  }

  async function handleStopApi() {
    if (actionState !== "idle") {
      return;
    }

    setActionState("stopping");

    try {
      const service = await stopApiService();
      setApiService(service);
      setApiHealth({
        status: "unreachable",
        detail: "Backend process is stopped.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      setApiHealth({
        status: "unreachable",
        detail: `Unable to stop the backend. ${message}`,
      });
    } finally {
      setActionState("idle");
    }
  }

  async function handleStartBroker() {
    if (brokerActionState !== "idle") {
      return;
    }

    setBrokerActionState("starting");
    setBrokerUiState({
      status: "checking",
      detail: "Checking...",
    });

    try {
      const service = await startBrokerService();
      updateBrokerUi(service);
      await syncBrokerState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      setBrokerUiState({
        status: "stopped",
        detail: message,
      });
    } finally {
      setBrokerActionState("idle");
    }
  }

  async function handleStopBroker() {
    if (brokerActionState !== "idle") {
      return;
    }

    setBrokerActionState("stopping");

    try {
      const service = await stopBrokerService();
      updateBrokerUi(service);
      await syncBrokerState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      setBrokerUiState({
        status: "stopped",
        detail: message,
      });
    } finally {
      setBrokerActionState("idle");
    }
  }

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <h2 style={{ margin: 0 }}>Home</h2>
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        Local service status and quick operational overview.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
        <StatusCard
          title="API Status"
          status={apiStatusLabel}
          detail={formatApiDetail(apiHealth)}
          actions={
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleStartApi}
                disabled={actionState !== "idle" || apiService.running}
              >
                Start API
              </button>
              <button
                type="button"
                onClick={handleStopApi}
                disabled={actionState !== "idle" || !apiService.running}
              >
                Stop API
              </button>
            </div>
          }
        />
        <StatusCard
          title="Broker Status"
          status={brokerStatusLabel}
          detail={brokerUiState.detail}
          actions={
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleStartBroker}
                disabled={brokerActionState !== "idle" || brokerState.running}
              >
                Start Broker
              </button>
              <button
                type="button"
                onClick={handleStopBroker}
                disabled={brokerActionState !== "idle" || !brokerState.running}
              >
                Stop Broker
              </button>
            </div>
          }
        />
        <StatusCard title="LAN Info" status="Pending" detail="Display local IP and host metadata later." />
      </div>

      <QrPanel />
      <LogPanel />
    </div>
  );
}
