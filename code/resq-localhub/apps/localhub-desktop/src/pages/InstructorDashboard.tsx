import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { LiveMetricsPanel } from "../components/LiveMetricsPanel";
import { fetchBrowserHealth, type BrowserHealthResponse } from "../lib/browserHealthApi";
import { MANUAL_LAN_IP_STORAGE_KEY, sanitizeManualLanIp } from "../lib/accessHost";
import { generateAccessUrls } from "../lib/accessUrls";
import {
  fetchLiveManikins,
  getLiveManikinsStreamUrl,
  type ManikinLiveSummary,
} from "../lib/browserManikinsApi";
import {
  fetchTrainees,
  createTrainee,
  type TraineeRecord,
} from "../lib/browserTraineesApi";
import {
  endSession,
  fetchCompletedSession,
  fetchCompletedSessions,
  startSession,
  type CompletedSession,
  type SessionStartResponse,
} from "../lib/browserSessionsApi";
import { useLiveSession } from "../hooks/useLiveSession";
import {
  buildEspProvisioningUrl,
  buildFirmwareProvisioningPayload,
  fetchHubServiceInfo,
  type FirmwareProvisioningPayload,
  type HubServiceInfoResponse,
} from "../lib/browserManikinsProvisionApi";
import {
  fetchManikinRegistry,
  type ManikinRegistryEntry,
} from "../lib/browserManikinRegistryApi";
import {
  cancelCalibration,
  getReadiness,
  startCalibration,
  type FirmwareCalibrationStartPayload,
  type FirmwareReadinessResponse,
} from "../lib/browserFirmwareApi";
import { FirmwareDiagnosticsPanel } from "../components/FirmwareDiagnosticsPanel";
import { CalibrationSettingsPanel } from "../components/CalibrationSettingsPanel";
import { LocalSessionReviewPanel } from "../components/LocalSessionReviewPanel";
import { QRCodeSVG as QR } from "qrcode.react";

/**
 * Browser-safe Instructor Dashboard.
 *
 * This page is served at http://<host>:1420/instructor and can be opened
 * in any browser on the LAN without depending on Tauri APIs.
 */

function HealthStatusBadge({ health }: { health: BrowserHealthResponse | null }) {
  if (!health) {
    return (
      <span style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: "#e2e8f0",
        color: "#334155",
      }}>
        Checking...
      </span>
    );
  }

  if (health.ok) {
    return (
      <span style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: "#dcfce7",
        color: "#166534",
      }}>
        Healthy
      </span>
    );
  }

  return (
    <span style={{
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "0.8rem",
      fontWeight: 600,
      background: "#fee2e2",
      color: "#991b1b",
    }}>
      Unreachable
    </span>
  );
}

function SessionStateBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.76rem",
        fontWeight: 700,
        background: active ? "#dbeafe" : "#e2e8f0",
        color: active ? "#1d4ed8" : "#334155",
      }}
    >
      {active ? "Session Active" : "No Session"}
    </span>
  );
}

function IndicatorBadge({
  label,
  status,
}: {
  label: string;
  status: "ok" | "warn" | "neutral";
}) {
  const palette = status === "ok"
    ? { background: "#dcfce7", color: "#166534" }
    : status === "warn"
      ? { background: "#fee2e2", color: "#991b1b" }
      : { background: "#e2e8f0", color: "#334155" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: "999px",
        fontSize: "0.76rem",
        fontWeight: 700,
        ...palette,
      }}
    >
      {label}
    </span>
  );
}

type SessionActionState = "idle" | "starting" | "ending";
type CalibrationActionState = "idle" | "starting" | "cancelling";
type LiveStreamState = "connecting" | "connected" | "reconnecting" | "unavailable";

type InstructorDashboardProps = {
  embeddedInDesktop?: boolean;
  onOpenTraineeDashboard?: (sessionId: string) => void;
  manualLanIpOverride?: string | null;
};

function InstructorLiveMetrics({
  deviceId,
  sessionId,
  active,
}: {
  deviceId: string;
  sessionId: string | null;
  active: boolean;
}) {
  const liveState = useLiveSession({
    deviceId,
    sessionId,
    enabled: active,
  });

  if (!active || !sessionId) {
    return (
      <div style={{ padding: "12px", borderRadius: "8px", border: "1px dashed #cbd5e1", background: "#f8fafc" }}>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.88rem" }}>
          Select or start a session to view live metrics.
        </p>
      </div>
    );
  }

  return <LiveMetricsPanel state={liveState} title="Selected Session Live Metrics" compact />;
}

function LiveStreamStatusBadge({ state }: { state: LiveStreamState }) {
  if (state === "connecting") {
    return (
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#e2e8f0", color: "#334155" }}>
        Connecting
      </span>
    );
  }

  if (state === "connected") {
    return (
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#dcfce7", color: "#166534" }}>
        Live stream connected
      </span>
    );
  }

  if (state === "reconnecting") {
    return (
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#fef3c7", color: "#92400e" }}>
        Reconnecting...
      </span>
    );
  }

  return (
    <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, background: "#fee2e2", color: "#991b1b" }}>
      Stream unavailable
    </span>
  );
}

export default function InstructorDashboard({
  embeddedInDesktop = false,
  onOpenTraineeDashboard,
  manualLanIpOverride = null,
}: InstructorDashboardProps) {
  const { currentUser, logout } = useAuth();
  const [health, setHealth] = useState<BrowserHealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [manikinsLoading, setManikinsLoading] = useState(true);
  const [manikinsError, setManikinsError] = useState<string | null>(null);
  const [manikinsStreamState, setManikinsStreamState] = useState<LiveStreamState>("connecting");
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);

  // Trainee selection state (per device)
  type SessionDraft = {
    traineeRecordId?: string;
    traineeMode: "select" | "quick" | "guest";
    quickTraineeName?: string;
    quickTraineeCode?: string;
    quickTraineeGroup?: string;
  };
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, SessionDraft>>({});

  // Trainee records management
  const [trainees, setTrainees] = useState<TraineeRecord[]>([]);
  const [traineesLoading, setTraineesLoading] = useState(true);
  const [traineesError, setTraineesError] = useState<string | null>(null);

  const [sessionCache, setSessionCache] = useState<Record<string, SessionStartResponse>>({});
  const [sessionActionByDevice, setSessionActionByDevice] = useState<Record<string, SessionActionState>>({});
  const [calibrationActionByDevice, setCalibrationActionByDevice] = useState<Record<string, CalibrationActionState>>({});
  const [readinessByDevice, setReadinessByDevice] = useState<Record<string, FirmwareReadinessResponse | null>>({});
  const [sessionMessageByDevice, setSessionMessageByDevice] = useState<Record<string, string | null>>({});
  const [recentSessions, setRecentSessions] = useState<CompletedSession[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(true);
  const [recentSessionsError, setRecentSessionsError] = useState<string | null>(null);
  const [latestEndedSession, setLatestEndedSession] = useState<CompletedSession | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedSessionDetail, setExpandedSessionDetail] = useState<CompletedSession | null>(null);
  const [expandedSessionLoading, setExpandedSessionLoading] = useState(false);
  const [expandedSessionError, setExpandedSessionError] = useState<string | null>(null);
  const [selectedCalibrationDeviceId, setSelectedCalibrationDeviceId] = useState<string | null>(null);
  // State for the "Pair New Manikin" panel
  const [espSetupBaseUrl, setEspSetupBaseUrl] = useState<string>("http://192.168.4.1");
  const [espProvisionPath, setEspProvisionPath] = useState<string>("/");
  const [provisioningWifiSsid, setProvisioningWifiSsid] = useState<string>("");
  const [provisioningWifiPassword, setProvisioningWifiPassword] = useState<string>("");
  const [provisioningBackendBaseUrl, setProvisioningBackendBaseUrl] = useState<string>("");
  const [provisioningAutoSave, setProvisioningAutoSave] = useState<boolean>(true);
  const [pairingLoading, setPairingLoading] = useState<boolean>(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [serviceInfo, setServiceInfo] = useState<HubServiceInfoResponse | null>(null);
  const [serviceInfoError, setServiceInfoError] = useState<string | null>(null);
  const [provisioningUrl, setProvisioningUrl] = useState<string | null>(null);
  const [provisioningPayload, setProvisioningPayload] = useState<FirmwareProvisioningPayload | null>(null);
  // State for the Device Registry panel
  const [registry, setRegistry] = useState<ManikinRegistryEntry[]>([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState<string | null>(null);

  useEffect(() => {
    if (manikins.length === 0) {
      if (selectedCalibrationDeviceId !== null) {
        setSelectedCalibrationDeviceId(null);
      }
      return;
    }

    const selectedStillExists = selectedCalibrationDeviceId && manikins.some((manikin) => manikin.deviceId === selectedCalibrationDeviceId);
    if (!selectedStillExists) {
      setSelectedCalibrationDeviceId(manikins[0].deviceId);
    }
  }, [manikins, selectedCalibrationDeviceId]);

  function applyManikinSnapshot(live: ManikinLiveSummary[]) {
    setManikins(live);
    setSessionDrafts((current) => {
      const next = { ...current };
      for (const manikin of live) {
        if (!next[manikin.deviceId]) {
          next[manikin.deviceId] = {
            traineeMode: "select",
          };
        }
      }
      return next;
    });
  }

  async function loadRecentSessions() {
    try {
      const sessions = await fetchCompletedSessions();
      setRecentSessions(sessions);
      setRecentSessionsError(null);
    } catch (error) {
      setRecentSessionsError(error instanceof Error ? error.message : "Failed to load completed sessions.");
    } finally {
      setRecentSessionsLoading(false);
    }
  }

  useEffect(() => {
    async function loadHealth() {
      setHealthLoading(true);
      const result = await fetchBrowserHealth();
      setHealth(result);
      setHealthLoading(false);
    }

    async function loadServiceInfo() {
      try {
        const info = await fetchHubServiceInfo();
        setServiceInfo(info);
        setServiceInfoError(null);
      } catch (error) {
        setServiceInfo(null);
        setServiceInfoError(error instanceof Error ? error.message : "LocalHub service info is unavailable.");
      }
    }

    async function loadManikins() {
      try {
        const live = await fetchLiveManikins();
        applyManikinSnapshot(live);
        setManikinsError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch live manikins.";
        setManikinsError(message);
      } finally {
        setManikinsLoading(false);
      }
    }

    async function loadTrainees() {
      try {
        const records = await fetchTrainees();
        setTrainees(records);
        setTraineesError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load trainee records.";
        setTraineesError(message);
      } finally {
        setTraineesLoading(false);
      }
    }
    async function loadRegistry() {
      try {
        const entries = await fetchManikinRegistry();
        setRegistry(entries);
        setRegistryError(null);
      } catch (error) {
        setRegistryError(
          error instanceof Error ? error.message : "Failed to load device registry."
        );
      } finally {
        setRegistryLoading(false);
      }
    }

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    function stopFallbackPolling() {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    }

    function startFallbackPolling() {
      if (fallbackInterval) {
        return;
      }

      fallbackInterval = setInterval(() => {
        loadManikins();
      }, 2000);
    }

    function safeParseManikins(raw: string): ManikinLiveSummary[] | null {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return null;
        }
        return parsed as ManikinLiveSummary[];
      } catch {
        return null;
      }
    }

    function connectManikinStream() {
      if (cancelled) {
        return;
      }

      if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
        setManikinsStreamState("unavailable");
        setManikinsError("Browser EventSource is not available.");
        startFallbackPolling();
        return;
      }

      setManikinsStreamState("connecting");
      const stream = new EventSource(getLiveManikinsStreamUrl(), { withCredentials: true });
      eventSource = stream;

      stream.onopen = () => {
        if (cancelled) {
          return;
        }

        setManikinsStreamState("connected");
        setManikinsError(null);
        stopFallbackPolling();
      };

      stream.addEventListener("manikins-live", (event) => {
        if (cancelled) {
          return;
        }

        const payload = safeParseManikins((event as MessageEvent<string>).data);
        if (!payload) {
          return;
        }

        applyManikinSnapshot(payload);
        setManikinsLoading(false);
      });

      stream.onerror = () => {
        if (cancelled) {
          return;
        }

        setManikinsStreamState("reconnecting");
        setManikinsError("Live stream disconnected. Reconnecting...");
        startFallbackPolling();

        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }

        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectManikinStream();
          }, 2000);
        }
      };
    }

    loadHealth();
    loadServiceInfo();
    loadManikins();
    loadRecentSessions();
    loadTrainees();
    loadRegistry();
    connectManikinStream();

    const healthInterval = setInterval(loadHealth, 5000);
    const serviceInfoInterval = setInterval(loadServiceInfo, 10000);
    const recentSessionsInterval = setInterval(loadRecentSessions, 10000);
    const registryInterval = setInterval(loadRegistry, 15000);
    
    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      stopFallbackPolling();
      clearInterval(healthInterval);
      clearInterval(serviceInfoInterval);
      clearInterval(recentSessionsInterval);
      clearInterval(registryInterval);
    };
  }, []);

  const manikinByDeviceId = useMemo(() => {
    return new Map(manikins.map((manikin) => [manikin.deviceId, manikin]));
  }, [manikins]);
  const deviceIdsKey = useMemo(() => manikins.map((manikin) => manikin.deviceId).sort().join("|"), [manikins]);

  useEffect(() => {
    if (!deviceIdsKey) {
      return;
    }

    let cancelled = false;
    const deviceIds = deviceIdsKey.split("|").filter(Boolean);

    async function loadReadiness() {
      const entries = await Promise.all(
        deviceIds.map(async (deviceId) => {
          try {
            const readiness = await getReadiness(deviceId);
            return [deviceId, readiness] as const;
          } catch {
            return [deviceId, null] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setReadinessByDevice((current) => {
        const next = { ...current };
        for (const [deviceId, readiness] of entries) {
          next[deviceId] = readiness;
        }
        return next;
      });
    }

    loadReadiness();
    const interval = window.setInterval(loadReadiness, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deviceIdsKey]);

  useEffect(() => {
    if (!serviceInfo?.backend_base_url) {
      return;
    }

    if (!provisioningBackendBaseUrl.trim()) {
      setProvisioningBackendBaseUrl(serviceInfo.backend_base_url);
    }
  }, [serviceInfo?.backend_base_url, provisioningBackendBaseUrl]);

  function formatLastSeen(value: string | null): string {
    if (!value) {
      return "No messages yet";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleTimeString();
  }

  function metric(value: number | null, suffix: string): string {
    if (value === null || value === undefined) {
      return "-";
    }

    return `${value.toFixed(1)} ${suffix}`;
  }

  function readinessKnown(readiness: FirmwareReadinessResponse | null | undefined): boolean {
    return Boolean(readiness?.firmwareState || readiness?.latestResult);
  }

  function startBlockedByReadiness(readiness: FirmwareReadinessResponse | null | undefined): boolean {
    if (!readinessKnown(readiness)) {
      return false;
    }

    const state = readiness?.firmwareState ?? "";
    return (
      !readiness?.readyForSession ||
      state === "CALIBRATING" ||
      state === "CALIBRATION_FAIL" ||
      state === "ERROR"
    );
  }

  function buildTraineeUrl(sessionId: string): string | null {
    const manualLanHost = sanitizeManualLanIp(manualLanIpOverride ?? window.localStorage.getItem(MANUAL_LAN_IP_STORAGE_KEY) ?? "");

    if (manualLanHost) {
      const { traineeUrl } = generateAccessUrls(manualLanHost);
      if (traineeUrl) {
        return `${traineeUrl}?sessionId=${encodeURIComponent(sessionId)}`;
      }
    }

    const protocol = window.location.protocol.toLowerCase();
    const canUseOrigin = protocol === "http:" || protocol === "https:";
    const originHost = window.location.hostname;
    const originIsLocalOnly =
      originHost === "localhost" ||
      originHost === "127.0.0.1" ||
      originHost === "::1";

    if (canUseOrigin && !originIsLocalOnly) {
      return `${window.location.origin}/trainee?sessionId=${encodeURIComponent(sessionId)}`;
    }

    return null;
  }

  function buildTraineeLandingUrl(): string {
    const manualLanHost = sanitizeManualLanIp(manualLanIpOverride ?? window.localStorage.getItem(MANUAL_LAN_IP_STORAGE_KEY) ?? "");

    if (manualLanHost) {
      const { traineeUrl } = generateAccessUrls(manualLanHost);
      if (traineeUrl) {
        return traineeUrl;
      }
    }

    const protocol = window.location.protocol.toLowerCase();
    const canUseOrigin = protocol === "http:" || protocol === "https:";
    const originHost = window.location.hostname;
    const originIsLocalOnly =
      originHost === "localhost" ||
      originHost === "127.0.0.1" ||
      originHost === "::1";

    if (canUseOrigin && !originIsLocalOnly) {
      return `${window.location.origin}/trainee`;
    }

    return "/trainee";
  }

  function navigateToDesktopHome() {
    window.location.assign("/");
  }

  function navigateToTraineeDashboard(sessionId: string) {
    if (onOpenTraineeDashboard) {
      onOpenTraineeDashboard(sessionId);
      return;
    }

    const url = `/trainee?sessionId=${encodeURIComponent(sessionId)}`;
    window.location.assign(url);
  }

  function formatSummaryTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
  }

  function formatSummaryDateTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function formatMetric(value: number, suffix: string): string {
    return `${value.toFixed(1)} ${suffix}`;
  }

  function getEffectiveSession(deviceId: string, manikin: ManikinLiveSummary): SessionStartResponse | null {
    const fromBackend = manikin.activeSessionId
      ? {
          sessionId: manikin.activeSessionId,
          deviceId: manikin.deviceId,
          traineeId: manikin.activeTraineeId,
          startedAt: manikin.activeSessionStartedAt ?? new Date().toISOString(),
          active: true,
          scenario: manikin.activeSessionScenario,
          notes: null,
        }
      : null;

    return fromBackend ?? sessionCache[deviceId] ?? null;
  }

  async function handleStartSession(deviceId: string) {
    const manikin = manikinByDeviceId.get(deviceId);
    if (!manikin) {
      return;
    }

    const draft = sessionDrafts[deviceId];
    if (!draft) {
      setSessionMessageByDevice((current) => ({ ...current, [deviceId]: "Please select a trainee mode." }));
      return;
    }

    setSessionActionByDevice((current) => ({ ...current, [deviceId]: "starting" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const request: any = {
        deviceId,
        scenario: manikin.activeSessionScenario ?? null,
        notes: null,
      };

      // Build trainee info based on selected mode
      if (draft.traineeMode === "select") {
        if (!draft.traineeRecordId) {
          throw new Error("Please select a trainee from the list.");
        }
        request.traineeRecordId = draft.traineeRecordId;
      } else if (draft.traineeMode === "quick") {
        if (!draft.quickTraineeName || !draft.quickTraineeCode) {
          throw new Error("Please enter trainee name and code for quick add.");
        }
        request.quickTrainee = {
          traineeCode: draft.quickTraineeCode,
          displayName: draft.quickTraineeName,
          groupName: draft.quickTraineeGroup || null,
        };
      } else if (draft.traineeMode === "guest") {
        request.guestLabel = "Guest Trainee";
      }

      const response = await startSession(request);
      setSessionCache((current) => ({ ...current, [deviceId]: response }));
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Started session ${response.sessionId}`,
      }));
    } catch (error) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: error instanceof Error ? error.message : "Failed to start session.",
      }));
    } finally {
      setSessionActionByDevice((current) => ({ ...current, [deviceId]: "idle" }));
    }
  }

  async function handleEndSession(deviceId: string, sessionId: string) {
    setSessionActionByDevice((current) => ({ ...current, [deviceId]: "ending" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const response = await endSession({ sessionId });
      setLatestEndedSession(response);
      setSessionCache((current) => {
        const next = { ...current };
        delete next[deviceId];
        return next;
      });
      setRecentSessions((current) => [response, ...current.filter((session) => session.sessionId !== response.sessionId)]);
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Ended session ${sessionId}`,
      }));
    } catch (error) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: error instanceof Error ? error.message : "Failed to end session.",
      }));
    } finally {
      setSessionActionByDevice((current) => ({ ...current, [deviceId]: "idle" }));
    }
  }

  async function refreshDeviceReadiness(deviceId: string) {
    try {
      const readiness = await getReadiness(deviceId);
      setReadinessByDevice((current) => ({ ...current, [deviceId]: readiness }));
    } catch {
      setReadinessByDevice((current) => ({ ...current, [deviceId]: null }));
    }
  }

  async function handleRunCalibration(deviceId: string, payload: FirmwareCalibrationStartPayload) {
    setCalibrationActionByDevice((current) => ({ ...current, [deviceId]: "starting" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const response = await startCalibration(deviceId, payload);
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Calibration requested (${response.requestId})`,
      }));
      await refreshDeviceReadiness(deviceId);
    } catch (error) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: error instanceof Error ? error.message : "Failed to start calibration.",
      }));
    } finally {
      setCalibrationActionByDevice((current) => ({ ...current, [deviceId]: "idle" }));
    }
  }

  async function handleCancelCalibration(deviceId: string) {
    setCalibrationActionByDevice((current) => ({ ...current, [deviceId]: "cancelling" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const response = await cancelCalibration(deviceId);
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Calibration cancel requested (${response.requestId})`,
      }));
      await refreshDeviceReadiness(deviceId);
    } catch (error) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: error instanceof Error ? error.message : "Failed to cancel calibration.",
      }));
    } finally {
      setCalibrationActionByDevice((current) => ({ ...current, [deviceId]: "idle" }));
    }
  }

  async function handleViewDetails(sessionId: string) {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      setExpandedSessionDetail(null);
      setExpandedSessionError(null);
      setExpandedSessionLoading(false);
      return;
    }

    setExpandedSessionId(sessionId);
    setExpandedSessionLoading(true);
    setExpandedSessionError(null);

    try {
      const detail = await fetchCompletedSession(sessionId);
      setExpandedSessionDetail(detail);
    } catch (error) {
      setExpandedSessionDetail(null);
      setExpandedSessionError(error instanceof Error ? error.message : "Failed to load session details.");
    } finally {
      setExpandedSessionLoading(false);
    }
  }
  async function handleRequestPairing() {
    if (!provisioningWifiSsid.trim()) return;

    setPairingLoading(true);
    setPairingError(null);
    setProvisioningUrl(null);
    setProvisioningPayload(null);

    try {
      const info = serviceInfo ?? await fetchHubServiceInfo();
      setServiceInfo(info);
      const backendBaseUrl = provisioningBackendBaseUrl.trim() || info.backend_base_url;
      const payload = buildFirmwareProvisioningPayload(
        {
          ...info,
          backend_base_url: backendBaseUrl,
        },
        provisioningWifiSsid.trim(),
        provisioningWifiPassword,
      );
      const url = buildEspProvisioningUrl({
        espSetupBaseUrl,
        espProvisionPath,
        wifiSsid: payload.wifi_ssid,
        wifiPassword: payload.wifi_pass,
        backendBaseUrl: payload.backend_base_url,
        autoSave: provisioningAutoSave,
      });

      setProvisioningPayload(payload);
      setProvisioningUrl(url);
    } catch (error) {
      setPairingError(
        error instanceof Error ? error.message : "Failed to generate provisioning payload."
      );
    } finally {
      setPairingLoading(false);
    }
  }

  const provisioningPayloadText = provisioningPayload
    ? JSON.stringify(provisioningPayload, null, 2)
    : "";
  const provisioningUrlText = provisioningUrl ?? "";

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <h1 style={styles.title}>Instructor Dashboard</h1>
            <p style={styles.subtitle}>
              Multi-manikin live performance monitoring and control
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {currentUser ? (
              <>
                <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#e2e8f0", color: "#334155", fontSize: "0.8rem", fontWeight: 700 }}>
                  {currentUser.role}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    logout().finally(() => window.location.assign("/login"));
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Logout
                </button>
              </>
            ) : null}
            {!embeddedInDesktop ? (
              <button
                type="button"
                onClick={navigateToDesktopHome}
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Back To Home
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div style={styles.content}>
        <section style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Hub Status</h2>
            <HealthStatusBadge health={healthLoading ? null : health} />
          </div>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
            {healthLoading
              ? "Checking hub connectivity..."
              : health?.ok
                ? "Backend is running and responding to health checks."
                : "Unable to reach the hub backend. Check that the API service is running."}
          </p>
          {health?.timestamp && (
            <p style={{ margin: "8px 0 0 0", color: "#9ca3af", fontSize: "0.8rem" }}>
              Last update: {new Date(health.timestamp).toLocaleTimeString()}
            </p>
          )}
        </section>
        <section style={styles.card}>
          <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>
            Firmware Provisioning
          </h2>
          <p style={{ margin: "0 0 14px 0", color: "#64748b", fontSize: "0.9rem" }}>
            Generate an ESP setup portal QR URL for firmware in provisioning mode. QR sends only Wi-Fi details and LocalHub backend URL.
          </p>

          <ol style={{ margin: "0 0 14px 18px", padding: 0, color: "#475569", fontSize: "0.86rem", lineHeight: 1.5 }}>
            <li>Power on ESP in provisioning mode.</li>
            <li>Connect phone to the ESP Wi-Fi, for example "ResQ Setup".</li>
            <li>Scan this QR.</li>
            <li>The firmware portal opens with Wi-Fi and LocalHub details.</li>
            <li>If auto-save is supported by firmware and enabled, the device connects automatically.</li>
            <li>Otherwise, press Save Configuration in the firmware portal.</li>
          </ol>

          <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
            <input
              type="text"
              placeholder="ESP setup base URL"
              value={espSetupBaseUrl}
              onChange={(e) => {
                setEspSetupBaseUrl(e.target.value);
                setProvisioningUrl(null);
                setProvisioningPayload(null);
                setPairingError(null);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            <input
              type="text"
              placeholder="ESP provision path"
              value={espProvisionPath}
              onChange={(e) => {
                setEspProvisionPath(e.target.value);
                setProvisioningUrl(null);
                setProvisioningPayload(null);
                setPairingError(null);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            <input
              type="text"
              placeholder="Wi-Fi SSID"
              value={provisioningWifiSsid}
              onChange={(e) => {
                setProvisioningWifiSsid(e.target.value);
                setProvisioningUrl(null);
                setProvisioningPayload(null);
                setPairingError(null);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            <input
              type="password"
              placeholder="Wi-Fi password"
              value={provisioningWifiPassword}
              onChange={(e) => {
                setProvisioningWifiPassword(e.target.value);
                setProvisioningUrl(null);
                setProvisioningPayload(null);
                setPairingError(null);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            <input
              type="text"
              placeholder="Backend base URL"
              value={provisioningBackendBaseUrl}
              onChange={(e) => {
                setProvisioningBackendBaseUrl(e.target.value);
                setProvisioningUrl(null);
                setProvisioningPayload(null);
                setPairingError(null);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#334155", fontSize: "0.88rem" }}>
              <input
                type="checkbox"
                checked={provisioningAutoSave}
                onChange={(e) => {
                  setProvisioningAutoSave(e.target.checked);
                  setProvisioningUrl(null);
                  setProvisioningPayload(null);
                  setPairingError(null);
                }}
              />
              Auto-save on scan
            </label>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <button
              type="button"
              disabled={pairingLoading || !provisioningWifiSsid.trim() || !(provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url)}
              onClick={handleRequestPairing}
              style={{
                padding: "8px 14px",
                borderRadius: "6px",
                border: "1px solid #0f172a",
                background: pairingLoading || !provisioningWifiSsid.trim() || !(provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url) ? "#e2e8f0" : "#0f172a",
                color: pairingLoading || !provisioningWifiSsid.trim() || !(provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url) ? "#64748b" : "#ffffff",
                fontWeight: 600,
                cursor: pairingLoading || !provisioningWifiSsid.trim() || !(provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url) ? "not-allowed" : "pointer",
                fontSize: "0.9rem",
              }}
            >
              {pairingLoading ? "Generating..." : "Generate QR"}
            </button>
          </div>

          <div style={{ display: "grid", gap: "6px", marginBottom: "12px", fontSize: "0.84rem", color: "#475569" }}>
            <p style={{ margin: 0 }}>
              Service backend_base_url: <strong>{serviceInfo?.backend_base_url ?? "Unavailable"}</strong>
            </p>
            <p style={{ margin: 0 }}>
              Service mqtt_host: <strong>{serviceInfo?.mqtt_host ?? "Unavailable"}</strong>
            </p>
            <p style={{ margin: 0 }}>
              Service mqtt_port: <strong>{serviceInfo?.mqtt_port ?? "Unavailable"}</strong>
            </p>
            <p style={{ margin: 0 }}>
              Service local_ip: <strong>{serviceInfo?.local_ip ?? "Unavailable"}</strong>
            </p>
            <p style={{ margin: 0 }}>
              QR sends only Wi-Fi + backend URL. Firmware gets MQTT host/port from LocalHub after registration.
            </p>
          </div>

          {serviceInfoError ? (
            <p style={{ margin: "0 0 10px 0", color: "#b91c1c", fontSize: "0.88rem" }}>
              {serviceInfoError}
            </p>
          ) : null}

          {pairingError ? (
            <p style={{ margin: "0 0 10px 0", color: "#b91c1c", fontSize: "0.88rem" }}>
              {pairingError}
            </p>
          ) : null}

          {provisioningPayload && provisioningUrl ? (
            <div style={{
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              display: "grid",
              gap: "10px",
              justifyItems: "center",
            }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem", color: "#0f172a" }}>
                Scan to provision firmware
              </p>
              <QR
                value={provisioningUrl}
                size={180}
                bgColor="#ffffff"
                fgColor="#0f172a"
                level="M"
              />
              <p style={{ margin: 0, color: "#475569", fontSize: "0.82rem", textAlign: "center" }}>
                QR URL includes wifi_ssid, wifi_pass, backend_base_url, and optional auto=1.
              </p>

              <div style={{ width: "100%", display: "grid", gap: "6px" }}>
                <p style={{ margin: 0, color: "#334155", fontSize: "0.82rem", fontWeight: 600 }}>
                  Generated Provisioning URL
                </p>
                <code style={{
                  display: "block",
                  padding: "8px",
                  background: "#e2e8f0",
                  borderRadius: "4px",
                  wordBreak: "break-all",
                  fontSize: "0.78rem",
                }}>
                  {provisioningUrlText}
                </code>
              </div>

              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(provisioningUrlText)}
                style={{
                  padding: "7px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.84rem",
                }}
              >
                Copy URL
              </button>

              <details style={{ width: "100%", fontSize: "0.82rem", color: "#64748b" }}>
                <summary style={{ cursor: "pointer" }}>
                  Developer JSON copy
                </summary>
                <code style={{
                  display: "block",
                  marginTop: "6px",
                  padding: "8px",
                  background: "#e2e8f0",
                  borderRadius: "4px",
                  wordBreak: "break-all",
                  fontSize: "0.78rem",
                }}>
                  {provisioningPayloadText}
                </code>
              </details>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(provisioningPayloadText)}
                style={{
                  padding: "7px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.84rem",
                }}
              >
                Copy JSON
              </button>
            </div>
          ) : null}
        </section>
        
        <section style={styles.card}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
              Device Registry
            </h2>
            {/* Show a live count badge — only after loading is complete */}
            {!registryLoading && !registryError ? (
              <span style={{
                padding: "4px 10px",
                borderRadius: "999px",
                fontSize: "0.8rem",
                fontWeight: 600,
                background: "#dbeafe",
                color: "#1d4ed8",
              }}>
                {registry.filter(m => m.online).length} / {registry.length} online
              </span>
            ) : null}
          </div>

          {registryLoading ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>
              Loading device registry...
            </p>
          ) : registryError ? (
            <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.92rem" }}>
              {registryError}
            </p>
          ) : registry.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>
              No devices in registry yet. Manikins appear here once they
              connect and publish their first status message.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {registry.map((manikin) => (
                <div
                  key={manikin.deviceId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    // Green tint when online, neutral when offline
                    background: manikin.online ? "#f0fdf4" : "#f8fafc",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  {/* Left side: device identity */}
                  <div style={{ display: "grid", gap: "2px" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                      {manikin.deviceId}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                      {manikin.ip ?? "No IP"} · FW {manikin.fw ?? "unknown"}
                    </span>
                  </div>

                  {/* Right side: status badges */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{
                      padding: "3px 8px",
                      borderRadius: "999px",
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      background: manikin.online ? "#dcfce7" : "#fee2e2",
                      color: manikin.online ? "#166534" : "#991b1b",
                    }}>
                      {manikin.online ? "Online" : "Offline"}
                    </span>

                    {manikin.state ? (
                      <span style={{
                        padding: "3px 8px",
                        borderRadius: "999px",
                        fontSize: "0.76rem",
                        fontWeight: 600,
                        background: "#e2e8f0",
                        color: "#334155",
                      }}>
                        {manikin.state}
                      </span>
                    ) : null}

                    {/* Color the signal strength badge based on quality:
                        above -60 dBm = good, -60 to -75 = fair, below -75 = poor */}
                    {manikin.rssi !== null ? (
                      <span style={{
                        padding: "3px 8px",
                        borderRadius: "999px",
                        fontSize: "0.76rem",
                        fontWeight: 600,
                        background: manikin.rssi > -60 ? "#dcfce7"
                          : manikin.rssi > -75 ? "#fef3c7"
                          : "#fee2e2",
                        color: manikin.rssi > -60 ? "#166534"
                          : manikin.rssi > -75 ? "#92400e"
                          : "#991b1b",
                      }}>
                        {manikin.rssi} dBm
                      </span>
                    ) : null}

                    <span style={{ fontSize: "0.76rem", color: "#94a3b8" }}>
                      {manikin.lastSeen
                        ? `Last seen ${new Date(manikin.lastSeen).toLocaleTimeString()}`
                        : "Never seen"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <LocalSessionReviewPanel
          latestEndedSession={latestEndedSession}
          sessions={recentSessions}
          loading={recentSessionsLoading}
          error={recentSessionsError}
          canExport={Boolean(currentUser && currentUser.role !== "TRAINEE")}
          expandedSessionId={expandedSessionId}
          expandedSessionDetail={expandedSessionDetail}
          expandedSessionLoading={expandedSessionLoading}
          expandedSessionError={expandedSessionError}
          onSelectSession={handleViewDetails}
          onRefresh={loadRecentSessions}
        />

        <CalibrationSettingsPanel
          devices={manikins}
          selectedDeviceId={selectedCalibrationDeviceId}
          onSelectedDeviceChange={setSelectedCalibrationDeviceId}
          calibrationAction={selectedCalibrationDeviceId ? calibrationActionByDevice[selectedCalibrationDeviceId] ?? "idle" : "idle"}
          onRunCalibration={handleRunCalibration}
        />

        <section style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Manikins</h2>
            <LiveStreamStatusBadge state={manikinsStreamState} />
          </div>
          {manikinsLoading ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>Loading live manikin data...</p>
          ) : null}

          {!manikinsLoading && manikinsError ? (
            <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.92rem" }}>
              Unable to load live manikins. {manikinsError}
            </p>
          ) : null}

          {!manikinsLoading && !manikinsError && manikins.length === 0 ? (
            <div
              style={{
                padding: "20px",
                borderRadius: "8px",
                border: "1px dashed #cbd5e1",
                background: "#f8fafc",
                textAlign: "center",
                color: "#64748b",
              }}
            >
              No manikins publishing yet. Start publishing to resq/&lt;deviceId&gt;/status, heartbeat, telemetry, debug, or events. Legacy resq/manikins/&lt;deviceId&gt;/... topics still work.
            </div>
          ) : null}

          {!manikinsLoading && !manikinsError && manikins.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
              {manikins.map((manikin) => {
                const activeSession = getEffectiveSession(manikin.deviceId, manikin);
                const active = Boolean(activeSession?.sessionId);
                const traineeLink = activeSession?.sessionId ? buildTraineeUrl(activeSession.sessionId) : null;
                const actionState = sessionActionByDevice[manikin.deviceId] ?? "idle";
                const calibrationAction = calibrationActionByDevice[manikin.deviceId] ?? "idle";
                const readiness = readinessByDevice[manikin.deviceId];
                const readinessIsKnown = readinessKnown(readiness);
                const startReadinessBlocked = startBlockedByReadiness(readiness);
                const startDisabled = actionState !== "idle" || startReadinessBlocked;
                const effectiveFirmwareState = readiness?.firmwareState ?? manikin.firmwareState ?? manikin.state ?? "unknown";

                return (
                  <article
                    key={manikin.deviceId}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#ffffff",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                      <h3 style={{ margin: 0, fontSize: "1rem" }}>{manikin.deviceId}</h3>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span
                          style={{
                            fontSize: "0.76rem",
                            fontWeight: 700,
                            borderRadius: "999px",
                            padding: "3px 8px",
                            background: manikin.online ? "#dcfce7" : "#fee2e2",
                            color: manikin.online ? "#166534" : "#991b1b",
                          }}
                        >
                          {manikin.online ? "Online" : "Offline"}
                        </span>
                        <SessionStateBadge active={active} />
                      </div>
                    </div>

                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>State: {effectiveFirmwareState}</p>
                    <InstructorLiveMetrics
                      deviceId={manikin.deviceId}
                      sessionId={activeSession?.sessionId ?? null}
                      active={active}
                    />

                    <div style={{ display: "grid", gap: "6px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <p style={{ margin: 0, fontSize: "0.84rem", color: "#334155", fontWeight: 700 }}>Readiness</p>
                        <IndicatorBadge
                          label={!readinessIsKnown ? "Unknown" : readiness?.readyForSession ? "Ready" : "Not Ready"}
                          status={!readinessIsKnown ? "neutral" : readiness?.readyForSession ? "ok" : "warn"}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "4px 10px", color: "#475569", fontSize: "0.82rem" }}>
                        <span>Firmware: {readiness?.firmwareState ?? "-"}</span>
                        <span>Calibrated: {readiness ? readiness.calibrated ? "Yes" : "No" : "-"}</span>
                        <span>Result: {readiness?.latestResult ?? "-"}</span>
                        <span>Progress: {readiness?.progressId ?? "-"}</span>
                        <span>Reason: {readiness?.reasonId ?? "-"}</span>
                        <span>Action: {readiness?.actionId ?? "-"}</span>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleCancelCalibration(manikin.deviceId)}
                          disabled={calibrationAction !== "idle"}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                            color: calibrationAction !== "idle" ? "#94a3b8" : "#334155",
                            cursor: calibrationAction !== "idle" ? "not-allowed" : "pointer",
                            fontWeight: 700,
                            fontSize: "0.82rem",
                          }}
                        >
                          {calibrationAction === "cancelling" ? "Cancelling..." : "Cancel Calibration"}
                        </button>
                        <span style={{ fontSize: "0.78rem", color: "#64748b", alignSelf: "center" }}>
                          Use Calibration Settings to start a run.
                        </span>
                      </div>
                    </div>

                    <FirmwareDiagnosticsPanel
                      deviceId={manikin.deviceId}
                      readiness={readiness}
                      liveSummary={manikin}
                    />

                    {/* Trainee Selection UI */}
                    <div style={{ display: "grid", gap: "8px", fontSize: "0.85rem", color: "#334155" }}>
                      <div style={{ fontWeight: 600 }}>Select Trainee</div>

                      {/* Mode Selection */}
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeMode: "select",
                              },
                            }))
                          }
                          style={{
                            padding: "4px 10px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            background:
                              sessionDrafts[manikin.deviceId]?.traineeMode === "select"
                                ? "#0f172a"
                                : "#ffffff",
                            color:
                              sessionDrafts[manikin.deviceId]?.traineeMode === "select"
                                ? "#ffffff"
                                : "#334155",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeMode: "quick",
                              },
                            }))
                          }
                          style={{
                            padding: "4px 10px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            background:
                              sessionDrafts[manikin.deviceId]?.traineeMode === "quick"
                                ? "#0f172a"
                                : "#ffffff",
                            color:
                              sessionDrafts[manikin.deviceId]?.traineeMode === "quick"
                                ? "#ffffff"
                                : "#334155",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Quick Add
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeMode: "guest",
                              },
                            }))
                          }
                          style={{
                            padding: "4px 10px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            background:
                              sessionDrafts[manikin.deviceId]?.traineeMode === "guest"
                                ? "#0f172a"
                                : "#ffffff",
                            color:
                              sessionDrafts[manikin.deviceId]?.traineeMode === "guest"
                                ? "#ffffff"
                                : "#334155",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          Guest
                        </button>
                      </div>

                      {/* Select Mode UI */}
                      {sessionDrafts[manikin.deviceId]?.traineeMode === "select" && (
                        <select
                          value={sessionDrafts[manikin.deviceId]?.traineeRecordId || ""}
                          onChange={(event) =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeRecordId: event.target.value,
                              },
                            }))
                          }
                          style={{
                            padding: "6px 8px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            fontFamily: "inherit",
                            fontSize: "0.85rem",
                          }}
                        >
                          <option value="">-- Select a trainee --</option>
                          {traineesLoading && <option>Loading...</option>}
                          {!traineesLoading &&
                            trainees.map((trainee) => (
                              <option key={trainee.id} value={trainee.id}>
                                {trainee.displayName} ({trainee.traineeCode})
                              </option>
                            ))}
                        </select>
                      )}

                      {/* Quick Add Mode UI */}
                      {sessionDrafts[manikin.deviceId]?.traineeMode === "quick" && (
                        <div style={{ display: "grid", gap: "6px" }}>
                          <input
                            type="text"
                            placeholder="Trainee Code"
                            value={sessionDrafts[manikin.deviceId]?.quickTraineeCode || ""}
                            onChange={(event) =>
                              setSessionDrafts((current) => ({
                                ...current,
                                [manikin.deviceId]: {
                                  ...current[manikin.deviceId],
                                  quickTraineeCode: event.target.value,
                                },
                              }))
                            }
                            style={{
                              padding: "6px 8px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontFamily: "inherit",
                              fontSize: "0.85rem",
                            }}
                          />
                          <input
                            type="text"
                            placeholder="Display Name"
                            value={sessionDrafts[manikin.deviceId]?.quickTraineeName || ""}
                            onChange={(event) =>
                              setSessionDrafts((current) => ({
                                ...current,
                                [manikin.deviceId]: {
                                  ...current[manikin.deviceId],
                                  quickTraineeName: event.target.value,
                                },
                              }))
                            }
                            style={{
                              padding: "6px 8px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontFamily: "inherit",
                              fontSize: "0.85rem",
                            }}
                          />
                          <input
                            type="text"
                            placeholder="Group (optional)"
                            value={sessionDrafts[manikin.deviceId]?.quickTraineeGroup || ""}
                            onChange={(event) =>
                              setSessionDrafts((current) => ({
                                ...current,
                                [manikin.deviceId]: {
                                  ...current[manikin.deviceId],
                                  quickTraineeGroup: event.target.value,
                                },
                              }))
                            }
                            style={{
                              padding: "6px 8px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontFamily: "inherit",
                              fontSize: "0.85rem",
                            }}
                          />
                        </div>
                      )}

                      {/* Guest Mode - no input needed */}
                      {sessionDrafts[manikin.deviceId]?.traineeMode === "guest" && (
                        <p style={{ margin: "4px 0", color: "#64748b", fontSize: "0.8rem" }}>
                          Session will start without a specific trainee assignment.
                        </p>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {currentUser && currentUser.role !== "TRAINEE" ? (
                        !active ? (
                        <button
                          type="button"
                          onClick={() => handleStartSession(manikin.deviceId)}
                          disabled={startDisabled}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid #0f172a",
                            background: startDisabled ? "#e2e8f0" : "#0f172a",
                            color: startDisabled ? "#64748b" : "#ffffff",
                            cursor: startDisabled ? "not-allowed" : "pointer",
                            fontWeight: 600,
                          }}
                          title={startReadinessBlocked ? "Device is not ready for a firmware session" : undefined}
                        >
                          Start Session
                        </button>
                        ) : (
                        <button
                          type="button"
                          onClick={() => handleEndSession(manikin.deviceId, activeSession!.sessionId)}
                          disabled={actionState !== "idle"}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid #991b1b",
                            background: actionState !== "idle" ? "#e2e8f0" : "#991b1b",
                            color: actionState !== "idle" ? "#64748b" : "#ffffff",
                            cursor: actionState !== "idle" ? "not-allowed" : "pointer",
                            fontWeight: 600,
                          }}
                        >
                          End Session
                        </button>
                        )
                      ) : (
                        <></>
                      )}
                    </div>

                    {active ? (
                      <div style={{ display: "grid", gap: "4px", background: "#f8fafc", borderRadius: "8px", padding: "10px" }}>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#334155" }}>
                          Session: {activeSession!.sessionId}
                        </p>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#334155" }}>
                          Trainee: {activeSession!.traineeId ?? "-"}
                        </p>
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#334155", wordBreak: "break-all" }}>
                          Trainee Link: {traineeLink ?? buildTraineeLandingUrl()}
                        </p>
                        {/* QR removed: Trainee dashboard QR omitted */}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => navigateToTraineeDashboard(activeSession!.sessionId)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: "1px solid #0f172a",
                              background: "#0f172a",
                              color: "#ffffff",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Open Trainee Dashboard (In-App)
                          </button>
                          {traineeLink ? (
                            <a href={traineeLink} style={linkButtonStyle}>
                              Open Trainee Link
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {sessionMessageByDevice[manikin.deviceId] ? (
                      <p style={{ margin: 0, color: "#475569", fontSize: "0.84rem" }}>
                        {sessionMessageByDevice[manikin.deviceId]}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "32px 24px",
    color: "#0f172a",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    minHeight: "100vh",
  },
  header: {
    marginBottom: "24px",
    paddingBottom: "16px",
    borderBottom: "1px solid #e5e7eb",
  },
  title: {
    margin: 0,
    fontSize: "1.75rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: "8px 0 0 0",
    color: "#64748b",
    fontSize: "0.95rem",
    fontWeight: 400,
  },
  content: {
    display: "grid",
    gap: "16px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "18px",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)",
  },
};

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "0.85rem",
};
