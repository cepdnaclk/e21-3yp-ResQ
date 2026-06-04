import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useOptionalAuth } from "../auth/AuthContext";
import { LiveMetricsPanel } from "../components/LiveMetricsPanel";
import "../styles/instructor-dashboard.css";
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
import ProvisioningIcon from "../components/icons/ProvisioningIcon";
import DeviceRegistryIcon from "../components/icons/DeviceRegistryIcon";
import LiveManikinsIcon from "../components/icons/LiveManikinsIcon";
import CalibrationIcon from "../components/icons/CalibrationIcon";

/**
 * Instructor Dashboard - Clean, Professional UI
 *
 * This page is served at http://<host>:1420/instructor and can be opened
 * in any browser on the LAN without depending on Tauri APIs.
 *
 * DESIGN PRINCIPLES:
 * - Focus on instructor needs, not technical details
 * - Hide IDs, diagnostics, and debug info by default
 * - Use clear visual hierarchy and status indicators
 * - Responsive layout (mobile-first, tablet, desktop)
 * - Medical blue primary, green success, amber warning, red error
 */

// Design system colors
const COLORS = {
  primary: "#005A9C",      // Medical blue
  success: "#107C10",      // Green
  warning: "#FF8C00",      // Amber
  error: "#D13438",        // Red
  neutral: "#334155",      // Slate
  light: "#f8fafc",        // Light background
  border: "#e2e8f0",       // Light border
  text: "#0f172a",         // Dark text
  textSecondary: "#64748b", // Gray text
};

// Responsive breakpoint utilities
const responsive = {
  mobile: "(max-width: 640px)",
  tablet: "(max-width: 1024px)",
  desktop: "(min-width: 1025px)",
};



// Status indicator dot with label
function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: "ready" | "online" | "offline" | "calibrating" | "error";
}) {
  const statusColors = {
    ready: { bg: "#e8f5e9", color: COLORS.success, dot: COLORS.success },
    online: { bg: "#e3f2fd", color: "#1976d2", dot: "#1976d2" },
    offline: { bg: "#ffebee", color: COLORS.error, dot: COLORS.error },
    calibrating: { bg: "#fff3e0", color: COLORS.warning, dot: COLORS.warning },
    error: { bg: "#ffebee", color: COLORS.error, dot: COLORS.error },
  };
  
  const colors = statusColors[status];
  
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "5px 10px",
      borderRadius: "16px",
      fontSize: "0.8rem",
      fontWeight: 600,
      background: colors.bg,
      color: colors.color,
    }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: colors.dot }} />
      {label}
    </span>
  );
}

function WifiSignalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.25 6.5C4.28 4.4 6.93 3.25 9 3.25c2.07 0 4.72 1.15 6.75 3.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.9 9.1c1.4-1.45 2.96-2.16 4.1-2.16 1.14 0 2.7.71 4.1 2.16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.45 11.6c.73-.76 1.14-.97 1.55-.97.41 0 .82.21 1.55.97" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="13.8" r="1.2" fill="currentColor" />
    </svg>
  );
}


// Warning icon for localhost warnings
function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5 1.8 15h14.4L9 2.5Z" fill="currentColor" opacity="0.18" />
      <path d="M9 6v4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="12.9" r="0.9" fill="currentColor" />
      <path d="M9 2.5 1.8 15h14.4L9 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

// Progress indicator for calibration
function CalibrationProgressRing({ value }: { value: number }) {
  const size = 48;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Calibration progress ${Math.round(value)}%`} role="img">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.border} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.success}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          fill="none"
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: "18px", fontWeight: 600, fill: COLORS.text }}>
          {Math.round(value)}%
        </text>
      </svg>
      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: COLORS.textSecondary }}>Calibrating...</span>
    </div>
  );
}

function progressFromId(progressId: unknown): number {
  if (typeof progressId === "number" && Number.isFinite(progressId)) {
    return Math.max(0, Math.min(100, progressId));
  }

  if (typeof progressId === "string") {
    const numeric = Number(progressId);
    if (!Number.isNaN(numeric)) {
      return Math.max(0, Math.min(100, numeric));
    }

    let hash = 0;
    for (let index = 0; index < progressId.length; index += 1) {
      hash = (hash << 5) - hash + progressId.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash) % 101;
  }

  return 0;
}

function triggerRegistrationConfetti() {
  if (typeof window === "undefined") {
    return;
  }

  const duration = 1250;
  const end = Date.now() + duration;
  const base = {
    startVelocity: 32,
    spread: 70,
    ticks: 70,
    gravity: 1.05,
    scalar: 0.95,
    origin: { y: 0.72 },
  };

  const frame = () => {
    confetti({ ...base, particleCount: 16, origin: { x: 0.2, y: 0.72 } });
    confetti({ ...base, particleCount: 16, origin: { x: 0.8, y: 0.72 } });

    if (Date.now() < end) {
      window.requestAnimationFrame(frame);
    }
  };

  frame();
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
    return null;
  }

  return <LiveMetricsPanel state={liveState} title="Live Metrics" compact />;
}

function LiveStreamStatusBadge({ state }: { state: LiveStreamState }) {
  const statuses = {
    connecting: { bg: COLORS.light, color: COLORS.textSecondary, label: "Connecting..." },
    connected: { bg: "#e8f5e9", color: COLORS.success, label: "Connected" },
    reconnecting: { bg: "#fff3e0", color: COLORS.warning, label: "Reconnecting..." },
    unavailable: { bg: "#ffebee", color: COLORS.error, label: "Stream unavailable" },
  };
  
  const status = statuses[state];
  
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 12px",
      borderRadius: "20px",
      fontSize: "0.8rem",
      fontWeight: 600,
      background: status.bg,
      color: status.color,
    }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: status.color }} />
      {status.label}
    </span>
  );
}

export default function InstructorDashboard({
  embeddedInDesktop = false,
  onOpenTraineeDashboard,
  manualLanIpOverride = null,
}: InstructorDashboardProps) {
  const auth = useOptionalAuth();
  const currentUser = auth?.currentUser ?? null;
  const logout = auth?.logout ?? (async () => undefined);
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
  const [expandedDeviceDetails, setExpandedDeviceDetails] = useState<Record<string, boolean>>({});
  const registryDeviceIdsRef = useRef<Set<string>>(new Set());
  const registryHasLoadedRef = useRef(false);

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
        const nextIds = new Set(entries.map((entry) => entry.deviceId));
        const hasNewDevice = registryHasLoadedRef.current && entries.some((entry) => !registryDeviceIdsRef.current.has(entry.deviceId));

        registryDeviceIdsRef.current = nextIds;
        registryHasLoadedRef.current = true;

        if (hasNewDevice) {
          triggerRegistrationConfetti();
        }

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

    loadServiceInfo();
    loadManikins();
    loadRecentSessions();
    loadTrainees();
    loadRegistry();
    connectManikinStream();

    function handleDeviceRegistered() {
      triggerRegistrationConfetti();
    }

    window.addEventListener("resq:device-registered", handleDeviceRegistered as EventListener);

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
      clearInterval(serviceInfoInterval);
      clearInterval(recentSessionsInterval);
      clearInterval(registryInterval);
      window.removeEventListener("resq:device-registered", handleDeviceRegistered as EventListener);
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
  const provisioningBackendUrl = (provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url || "").trim();
  const backendUrlHasLocalhost = provisioningBackendUrl.toLowerCase().includes("localhost");

  

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
            {currentUser && !embeddedInDesktop ? (
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

        <section style={{ ...styles.card, ...styles.provisioningCard }} className="provisioning-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ProvisioningIcon size={18} />
                <h2 style={{ margin: "0 0 6px 0", fontSize: "1.1rem", fontWeight: 600 }}>
                  Firmware Provisioning
                </h2>
              </div>
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
                Generate an ESP setup portal QR URL for firmware in provisioning mode. QR sends only Wi-Fi details and LocalHub backend URL.
              </p>
            </div>

            <div className="provisioning-help" tabIndex={0}>
              <button
                type="button"
                className="provisioning-help__trigger"
                aria-describedby="provisioning-help-tooltip"
              >
                Need help?
              </button>
              <div id="provisioning-help-tooltip" className="provisioning-help__tooltip" role="tooltip">
                <span>Follow the checklist below to generate the QR and provision the device.</span>
                <span className="provisioning-help__arrow" aria-hidden="true">↓</span>
              </div>
            </div>
          </div>

          <ol className="provisioning-steps" style={{ margin: "0 0 14px 18px", padding: 0, color: "#475569", fontSize: "0.86rem", lineHeight: 1.5 }}>
            <li>Power on ESP in provisioning mode.</li>
            <li>Connect phone to the ESP Wi-Fi, for example "ResQ Setup".</li>
            <li>Scan this QR.</li>
            <li>The firmware portal opens with Wi-Fi and LocalHub details.</li>
            <li>If auto-save is supported by firmware and enabled, the device connects automatically.</li>
            <li>Otherwise, press Save Configuration in the firmware portal.</li>
          </ol>

          <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "#334155" }}>ESP setup base URL</span>
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
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <button
                type="button"
                onClick={() => void handleRequestPairing()}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: COLORS.primary,
                  color: "white",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Generate QR
              </button>

              {pairingLoading ? <span style={{ color: COLORS.textSecondary }}>Generating…</span> : null}
              {pairingError ? <span style={{ color: COLORS.error }}>{pairingError}</span> : null}
            </div>

            {provisioningUrl && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
                <div style={{ width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center", background: "white", padding: 8, border: `1px solid ${COLORS.border}`, borderRadius: 8 }}>
                  <QR value={provisioningUrl} size={96} level="M" />
                </div>
                <div style={{ color: COLORS.textSecondary }}>
                  <div style={{ fontWeight: 700, color: COLORS.text }}>Provisioning URL</div>
                  <div style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{provisioningUrl}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LiveManikinsIcon size={18} />
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Manikins</h2>
            </div>
            <LiveStreamStatusBadge state={manikinsStreamState} />
          </div>

          {manikinsStreamState === "unavailable" ? (
            <p style={{ color: COLORS.textSecondary }}>Stream unavailable</p>
          ) : null}

          <div style={{ display: "grid", gap: 10 }}>
            {manikins.length === 0 && !manikinsLoading ? (
              <div style={{ color: COLORS.textSecondary }}>No live manikins</div>
            ) : null}

            {manikins.map((m) => {
              const effective = getEffectiveSession(m.deviceId, m);
              return (
                <div key={m.deviceId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, border: `1px solid ${COLORS.border}`, borderRadius: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{m.deviceId}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: "0.85rem" }}>Last seen {formatLastSeen(m.lastSeen)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button type="button" onClick={() => void handleStartSession(m.deviceId)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "white", cursor: "pointer" }}>Start Session</button>
                    {effective?.active ? (
                      <button type="button" onClick={() => void handleEndSession(m.deviceId, effective.sessionId)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>End Session</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section style={styles.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <DeviceRegistryIcon size={18} />
            <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>Device Registry</h2>
          </div>
          {registryLoading ? <div style={{ color: COLORS.textSecondary }}>Loading…</div> : (
            <div style={{ display: "grid", gap: 8 }}>
              {registry.map((r) => (
                <div key={r.deviceId} style={{ display: "flex", justifyContent: "space-between", padding: 8, border: `1px solid ${COLORS.border}`, borderRadius: 6 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.deviceId}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: "0.85rem" }}>{r.ip ?? "No IP"} · FW {r.fw ?? "unknown"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      <style>{`.provisioning-help:focus .provisioning-help__tooltip { display:block }`}</style>

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
  provisioningCard: {
    background: "linear-gradient(145deg, var(--provisioning-card-start) 0%, var(--provisioning-card-end) 100%)",
    border: "1px solid var(--provisioning-card-border)",
    boxShadow: "var(--provisioning-card-shadow)",
  },
};