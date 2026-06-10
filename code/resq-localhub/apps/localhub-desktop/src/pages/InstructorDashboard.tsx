import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useAuth } from "../auth/AuthContext";
import { LiveMetricsPanel } from "../components/LiveMetricsPanel";
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
import { FirmwareProvisioningPanel } from "../components/FirmwareProvisioningPanel";
import { DeviceRegistryPanel } from "../components/DeviceRegistryPanel";
import { LocalSessionReviewPanel } from "../components/LocalSessionReviewPanel";
import { Dialog } from "../components/ui/dialog";
import { Button } from "../components/ui";
import { RefreshCw } from "lucide-react";
import { QRCodeSVG as QR } from "qrcode.react";
import ProvisioningIcon from "../components/icons/ProvisioningIcon";
import DeviceRegistryIcon from "../components/icons/DeviceRegistryIcon";
import LiveManikinsIcon from "../components/icons/LiveManikinsIcon";
import CalibrationIcon from "../components/icons/CalibrationIcon";
import "../styles/instructor-dashboard.css";

/**
 * Browser-safe Instructor Dashboard.
 *
 * This page is served at http://<host>:1420/instructor and can be opened
 * in any browser on the LAN without depending on Tauri APIs.
 */



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

function WifiSignalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.25 6.5C4.28 4.4 6.93 3.25 9 3.25c2.07 0 4.72 1.15 6.75 3.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.9 9.1c1.4-1.45 2.96-2.16 4.1-2.16 1.14 0 2.7.71 4.1 2.16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.45 11.6c.73-.76 1.14-.97 1.55-.97.41 0 .82.21 1.55.97" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="13.8" r="1.2" fill="currentColor" />
    </svg>
  );
}

// Using shared `HubHeartbeat` component for consistent animation and styling.
function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5 1.8 15h14.4L9 2.5Z" fill="currentColor" opacity="0.18" />
      <path d="M9 6v4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="12.9" r="0.9" fill="currentColor" />
      <path d="M9 2.5 1.8 15h14.4L9 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function DeviceMetricIcon({ kind }: { kind: "id" | "seen" | "calibrated" }) {
  if (kind === "id") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 4h4M4 6h4M4 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "seen") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 3.4v2.9l2 1.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.2 6.2 4.6 8.6 9.8 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sparkline({ seed }: { seed: string }) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  const series = Array.from({ length: 10 }, (_, index) => {
    const base = Math.abs((hash + index * 37) % 14);
    return 6 + base;
  });

  const width = 72;
  const height = 18;
  const step = width / (series.length - 1);
  const path = series.map((value, index) => `${index === 0 ? "M" : "L"} ${index * step} ${height - value}`).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusDot({
  label,
  status,
}: {
  label: string;
  status: "ready" | "online" | "offline" | "neutral";
}) {
  return (
    <span className={`device-status ${status === "ready" ? "device-status--ready" : ""}`}>
      <span className={`device-status__dot device-status__dot--${status}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="device-chip">
      <span className="device-chip__icon">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

function ProgressRing({ value }: { value: number }) {
  const size = 36;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;

  return (
    <svg className="device-progress" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Calibration progress ${Math.round(value)}%`} role="img">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#dbeafe" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#16a34a"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        fill="none"
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="device-progress__label">
        {Math.round(value)}%
      </text>
    </svg>
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
  const { currentUser } = useAuth();
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
  const selectedDevice = useMemo(() => {
    return manikins.find((device) => device.deviceId === selectedCalibrationDeviceId) ?? null;
  }, [manikins, selectedCalibrationDeviceId]);
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [isProvisioningOpen, setIsProvisioningOpen] = useState(false);
  const [isRegistryOpen, setIsRegistryOpen] = useState(false);
  const [isSessionReviewOpen, setIsSessionReviewOpen] = useState(false);
  const [serviceInfo, setServiceInfo] = useState<HubServiceInfoResponse | null>(null);
  const [serviceInfoError, setServiceInfoError] = useState<string | null>(null);
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


  return (
    <div className="dashboard-main-container">
      <header className="dashboard-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <h1 style={styles.title}>Instructor Dashboard</h1>
            <p style={{ ...styles.subtitle, color: "#64748b" }}>
              Monitor live simulator manikins and manage training sessions
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {!embeddedInDesktop ? (
              <button
                type="button"
                onClick={navigateToDesktopHome}
                className="header-action-btn"
              >
                Back To Home
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="instructor-dashboard-layout">
        {/* Left Column */}
        <div className="dashboard-column left-column">
          
          <div className="left-column-bottom-flex">
            {/* Navy blue active card */}
            <div className="navy-active-card">
              <h2 className="active-card-title">ACTIVE DEVICE</h2>
              {selectedDevice ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#ffffff" }}>
                    {selectedDevice.deviceId}
                  </div>
                  
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <StatusDot label={selectedDevice.online ? "Online" : "Offline"} status={selectedDevice.online ? "online" : "offline"} />
                    <SessionStateBadge active={Boolean(selectedDevice.activeSessionId)} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.95rem", color: "#cbd5e1" }}>
                    <div>IP Address: <strong style={{ color: "#ffffff" }}>{selectedDevice.ip ?? "No IP"}</strong></div>
                    <div>FW Version: <strong style={{ color: "#ffffff" }}>{selectedDevice.fw ?? "unknown"}</strong></div>
                    <div>Firmware State: <strong style={{ color: "#ffffff" }}>{selectedDevice.state ?? "unknown"}</strong></div>
                  </div>

                  {selectedDevice.activeSessionId ? (
                    <div style={{ background: "rgba(15, 23, 42, 0.4)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "0.8rem", textTransform: "uppercase", fontWeight: 700, color: "#cbd5e1" }}>Active Session</span>
                      <span style={{ fontSize: "0.9rem", color: "#ffffff", wordBreak: "break-all" }}>ID: {selectedDevice.activeSessionId}</span>
                      <span style={{ fontSize: "0.9rem", color: "#ffffff" }}>Trainee: {selectedDevice.activeTraineeId ?? "Guest"}</span>
                    </div>
                  ) : (
                    <div style={{ background: "rgba(15, 23, 42, 0.4)", border: "1px dashed rgba(255, 255, 255, 0.15)", borderRadius: "8px", padding: "12px", textAlign: "center", color: "#cbd5e1", fontSize: "0.9rem" }}>
                      No Active Session
                    </div>
                  )}

                  <div style={{ marginTop: "8px" }}>
                    <InstructorLiveMetrics
                      deviceId={selectedDevice.deviceId}
                      sessionId={selectedDevice.activeSessionId ?? null}
                      active={Boolean(selectedDevice.activeSessionId)}
                    />
                  </div>
                </div>
              ) : (
                <p style={{ margin: 0, color: "#cbd5e1", fontSize: "0.95rem" }}>
                  No active device selected. Select a live device from the Calibration Settings card in the tools panel.
                </p>
              )}
            </div>

          </div>
        </div>

        {/* Center-Right Column */}
        <div className="dashboard-column center-right-column">
          <div className="live-manikins-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <LiveManikinsIcon size={18} />
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#0f172a" }}>Live Manikins</h3>
              </div>
              <LiveStreamStatusBadge state={manikinsStreamState} />
            </div>

            {manikinsLoading ? (
              <p style={{ margin: 0, color: "#475569" }}>Loading live manikin data...</p>
            ) : null}

            {!manikinsLoading && manikinsError ? (
              <p style={{ margin: 0, color: "#b91c1c" }}>
                Unable to load live manikins. {manikinsError}
              </p>
            ) : null}

            {!manikinsLoading && !manikinsError && manikins.length === 0 ? (
              <div className="empty-state-dark">
                No manikins publishing yet. Start publishing to resq/&lt;deviceId&gt;/status...
              </div>
            ) : null}

            {!manikinsLoading && !manikinsError && manikins.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
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
                  const isExpanded = expandedDeviceDetails[manikin.deviceId] ?? false;
                  const calibrationProgress = progressFromId(readiness?.progressId);
                  const isCalibrating = effectiveFirmwareState === "CALIBRATING";

                  return (
                    <div key={manikin.deviceId} className="manikin-stack-card">
                      {/* Sub-element 1: Dashboard Overview */}
                      <article className="dashboard-overview-subcard">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>{manikin.deviceId}</h3>
                              <Sparkline seed={manikin.deviceId} />
                            </div>
                            <div className="chips-container" style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                              <Chip icon={<DeviceMetricIcon kind="id" />}>{manikin.ip ?? "No IP"} · FW {manikin.fw ?? "unknown"}</Chip>
                              <Chip icon={<DeviceMetricIcon kind="seen" />}>{manikin.lastSeen ? `Last seen ${new Date(manikin.lastSeen).toLocaleTimeString()}` : "Never seen"}</Chip>
                              <Chip icon={<DeviceMetricIcon kind="calibrated" />}>{readiness?.calibrated ? "Calibrated" : "Not calibrated"}</Chip>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                            <StatusDot label={manikin.online ? "Online" : "Offline"} status={manikin.online ? "online" : "offline"} />
                            <SessionStateBadge active={active} />
                          </div>
                        </div>

                        <p style={{ margin: "0 0 12px 0", color: "#475569" }}>State: <strong>{effectiveFirmwareState}</strong></p>

                        {isCalibrating ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <ProgressRing value={calibrationProgress} />
                            <span style={{ color: "#475569", fontWeight: 600 }}>Calibration in progress</span>
                          </div>
                        ) : null}

                        {/* Trainee Selection UI */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginBottom: "12px", fontSize: "0.95rem" }}>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>Select Trainee</div>

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
                                    ? "#005A9C"
                                    : "#e2e8f0",
                                color:
                                  sessionDrafts[manikin.deviceId]?.traineeMode === "select"
                                    ? "#ffffff"
                                    : "#0f172a",
                                cursor: "pointer",
                                fontSize: "0.85rem",
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
                                    ? "#005A9C"
                                    : "#e2e8f0",
                                color:
                                  sessionDrafts[manikin.deviceId]?.traineeMode === "quick"
                                    ? "#ffffff"
                                    : "#0f172a",
                                cursor: "pointer",
                                fontSize: "0.85rem",
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
                                    ? "#005A9C"
                                    : "#e2e8f0",
                                color:
                                  sessionDrafts[manikin.deviceId]?.traineeMode === "guest"
                                    ? "#ffffff"
                                    : "#0f172a",
                                cursor: "pointer",
                                fontSize: "0.85rem",
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
                                padding: "8px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                background: "#ffffff",
                                color: "#0f172a",
                                outline: "none",
                              }}
                            >
                              <option value="" style={{ color: "#0f172a" }}>-- Select a trainee --</option>
                              {traineesLoading && <option style={{ color: "#0f172a" }}>Loading...</option>}
                              {!traineesLoading &&
                                trainees.map((trainee) => (
                                  <option key={trainee.id} value={trainee.id} style={{ color: "#0f172a" }}>
                                    {trainee.displayName} ({trainee.traineeCode})
                                  </option>
                                ))}
                            </select>
                          )}

                          {/* Quick Add Mode UI */}
                          {sessionDrafts[manikin.deviceId]?.traineeMode === "quick" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                                  padding: "8px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  background: "#ffffff",
                                  color: "#0f172a",
                                  outline: "none",
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
                                  padding: "8px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  background: "#ffffff",
                                  color: "#0f172a",
                                  outline: "none",
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
                                  padding: "8px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  background: "#ffffff",
                                  color: "#0f172a",
                                  outline: "none",
                                }}
                              />
                            </div>
                          )}

                          {sessionDrafts[manikin.deviceId]?.traineeMode === "guest" && (
                            <p style={{ margin: "4px 0 0 0", color: "#475569" }}>
                              Session will start without a specific trainee assignment.
                            </p>
                          )}
                        </div>

                        {/* Start/End buttons */}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                          {currentUser && currentUser.role !== "TRAINEE" ? (
                            !active ? (
                              <button
                                type="button"
                                onClick={() => handleStartSession(manikin.deviceId)}
                                disabled={startDisabled}
                                style={{
                                  padding: "8px 14px",
                                  borderRadius: "6px",
                                  border: "none",
                                  background: startDisabled ? "#e2e8f0" : "#16a34a",
                                  color: startDisabled ? "#94a3b8" : "#ffffff",
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
                                  padding: "8px 14px",
                                  borderRadius: "6px",
                                  border: "none",
                                  background: actionState !== "idle" ? "#e2e8f0" : "#dc2626",
                                  color: actionState !== "idle" ? "#94a3b8" : "#ffffff",
                                  cursor: actionState !== "idle" ? "not-allowed" : "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                End Session
                              </button>
                            )
                          ) : null}
                        </div>

                        {/* Technical details toggle */}
                        <button
                          type="button"
                          style={{
                            border: "none",
                            background: "none",
                            color: "#005A9C",
                            fontWeight: 700,
                            cursor: "pointer",
                            padding: 0,
                            textAlign: "left",
                            marginBottom: "12px",
                          }}
                          onClick={() =>
                            setExpandedDeviceDetails((current) => ({
                              ...current,
                              [manikin.deviceId]: !current[manikin.deviceId],
                            }))
                          }
                        >
                          {isExpanded ? "Hide technical details" : "Show technical details"}
                        </button>

                        {isExpanded ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.9rem", color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
                            <div>Device ID: {manikin.deviceId}</div>
                            <div>Last seen: {manikin.lastSeen ? new Date(manikin.lastSeen).toLocaleString() : "Never seen"}</div>
                            <div>Calibrated: {readiness?.calibrated ? "Yes" : "No"}</div>
                            <div>Progress ID: {readiness?.progressId ?? "-"}</div>
                            <div>Firmware state: {readiness?.firmwareState ?? "-"}</div>
                            <div>Reason: {readiness?.reasonId ?? "-"}</div>
                            <div>Action: {readiness?.actionId ?? "-"}</div>
                          </div>
                        ) : null}

                        {active ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#f8fafc", borderRadius: "8px", padding: "12px", border: "1px solid #e2e8f0" }}>
                            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                              <div style={{ fontSize: "0.85rem", color: "#64748b" }}>Session:</div>
                              <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0f172a", wordBreak: "break-all" }}>{activeSession!.sessionId}</div>
                            </div>
                            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                              <div style={{ fontSize: "0.85rem", color: "#64748b" }}>Trainee:</div>
                              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#0f172a" }}>{activeSession!.traineeId ?? "-"}</div>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ fontSize: "0.85rem", color: "#64748b" }}>Trainee Link:</div>
                              <div style={{ background: "#f1f5f9", color: "#0f172a", border: "1px solid #e2e8f0", padding: "6px 10px", borderRadius: 6, fontWeight: 800, wordBreak: "break-all" }}>
                                {traineeLink ?? buildTraineeLandingUrl()}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "4px" }}>
                              <button
                                type="button"
                                onClick={() => navigateToTraineeDashboard(activeSession!.sessionId)}
                                className="cta-royal"
                                style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "0.85rem" }}
                              >
                                Open Trainee Dashboard (In-App)
                              </button>
                              {traineeLink ? (
                                <a href={traineeLink} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f1f5f9", color: "#0f172a", fontWeight: 700, textDecoration: "none", fontSize: "0.85rem" }}>
                                  Open Trainee Link
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {sessionMessageByDevice[manikin.deviceId] ? (
                          <div style={{ marginTop: 6 }}>
                            {(() => {
                              const deviceMessage = sessionMessageByDevice[manikin.deviceId];

                              if (!deviceMessage) {
                                return null;
                              }

                              return deviceMessage.includes("Calibration requested") ? (
                                <span style={{ display: "inline-block", padding: "6px 10px", borderRadius: 999, background: "#fff1f2", color: "#b91c1c", fontWeight: 800, fontSize: "0.86rem" }}>
                                  {deviceMessage}
                                </span>
                              ) : (
                                <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>{deviceMessage}</p>
                              );
                            })()}
                          </div>
                        ) : null}
                      </article>

                      {/* Sub-element 2: PPI */}
                      <article className="ppi-subcard">
                        <h4 className="ppi-title text-sm font-bold text-slate-300 mt-0 mb-3 uppercase tracking-wider">
                          Performance Proximity Indicator (PPI)
                        </h4>
                        <InstructorLiveMetrics
                          deviceId={manikin.deviceId}
                          sessionId={activeSession?.sessionId ?? null}
                          active={active}
                        />

                        <div style={{ display: "grid", gap: "6px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginTop: "14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <p style={{ margin: 0, fontSize: "0.9rem", color: "#0f172a", fontWeight: 700 }}>Readiness</p>
                            <IndicatorBadge
                              label={!readinessIsKnown ? "Unknown" : readiness?.readyForSession ? "Ready" : "Not Ready"}
                              status={!readinessIsKnown ? "neutral" : readiness?.readyForSession ? "ok" : "warn"}
                            />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "4px 10px", color: "#475569", fontSize: "0.85rem" }}>
                            <span>Firmware: {readiness?.firmwareState ?? "-"}</span>
                            <span>Calibrated: {readiness ? readiness.calibrated ? "Yes" : "No" : "-"}</span>
                            <span>Result: {readiness?.latestResult ?? "-"}</span>
                            <span>Progress: {readiness?.progressId ?? "-"}</span>
                            <span>Reason: {readiness?.reasonId ?? "-"}</span>
                            <span>Action: {readiness?.actionId ?? "-"}</span>
                          </div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                            <button
                              type="button"
                              onClick={() => handleCancelCalibration(manikin.deviceId)}
                              disabled={calibrationAction !== "idle"}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                background: calibrationAction !== "idle" ? "#e2e8f0" : "#f1f5f9",
                                color: calibrationAction !== "idle" ? "#94a3b8" : "#0f172a",
                                cursor: calibrationAction !== "idle" ? "not-allowed" : "pointer",
                                fontWeight: 700,
                                fontSize: "0.85rem",
                              }}
                            >
                              {calibrationAction === "cancelling" ? "Cancelling..." : "Cancel Calibration"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCalibrationDeviceId(manikin.deviceId);
                                setIsCalibrationOpen(true);
                              }}
                              style={{
                                display: "inline-flex",
                                gap: 6,
                                alignItems: "center",
                                fontSize: "0.85rem",
                                color: "#005A9C",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                fontWeight: 700,
                                padding: 0,
                                alignSelf: "center",
                              }}
                            >
                              <CalibrationIcon size={14} />
                              <span>Open Calibration Settings</span>
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: "12px" }}>
                          <FirmwareDiagnosticsPanel
                            deviceId={manikin.deviceId}
                            readiness={readiness}
                            liveSummary={manikin}
                          />
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

      </div>

      {/* ── 4 Tool Cards ─────────────────────────────────────────────────── */}
      <div className="tools-card-row">
        {/* Calibration Settings */}
        <div className="calibration-profiles-card-wrapper tools-card-item">
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "12px" }}>
              <CalibrationIcon size={18} />
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Calibration Settings</h2>
            </div>
            <p className="card-description" style={{ marginBottom: "18px" }}>
              Configure sensor thresholds and trigger manual sensor calibration runs for live simulators.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px", fontSize: "0.95rem", color: "#334155" }}>
              <div>Active Device: <strong style={{ color: "#0f172a" }}>{selectedCalibrationDeviceId ?? "None"}</strong></div>
              <div>Status: <strong style={{ color: "#0f172a" }}>{selectedDevice ? (selectedDevice.online ? "Online" : "Offline") : "No device selected"}</strong></div>
            </div>
            <button
              type="button"
              onClick={() => setIsCalibrationOpen(true)}
              style={{ padding: "10px 18px", borderRadius: "8px", border: "none", background: "#005A9C", color: "#ffffff", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem", transition: "all 0.2s" }}
            >
              Manage Profiles & Calibrate
            </button>
          </div>
        </div>

        {/* Local Session Review */}
        <div className="calibration-profiles-card-wrapper tools-card-item">
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "12px" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#0f172a" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Local Session Review</h2>
            </div>
            <p className="card-description" style={{ marginBottom: "18px" }}>
              Review completed CPR session performance metrics, check scores, compression rates, and export reports to JSON/CSV.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px", fontSize: "0.95rem", color: "#334155" }}>
              <div>Completed Sessions: <strong style={{ color: "#0f172a" }}>{recentSessions.length}</strong></div>
              <div>Latest Score: <strong style={{ color: "#0f172a" }}>{latestEndedSession ? latestEndedSession.summary.score : "N/A"}</strong></div>
            </div>
            <button
              type="button"
              onClick={() => setIsSessionReviewOpen(true)}
              style={{ padding: "10px 18px", borderRadius: "8px", border: "none", background: "#005A9C", color: "#ffffff", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem", transition: "all 0.2s" }}
            >
              View Sessions
            </button>
          </div>
        </div>

        {/* Device Registry */}
        <div className="calibration-profiles-card-wrapper tools-card-item">
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "12px" }}>
              <DeviceRegistryIcon size={18} />
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Device Registry</h2>
            </div>
            <p className="card-description" style={{ marginBottom: "18px" }}>
              Track and manage all registered simulation manikins, view online/offline status, RSSI strength, and system details.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px", fontSize: "0.95rem", color: "#334155" }}>
              <div>Total Manikins: <strong style={{ color: "#0f172a" }}>{registry.length}</strong></div>
              <div>Online Manikins: <strong style={{ color: "#0f172a" }}>{registry.filter((m) => m.online).length}</strong></div>
            </div>
            <button
              type="button"
              onClick={() => setIsRegistryOpen(true)}
              style={{ padding: "10px 18px", borderRadius: "8px", border: "none", background: "#005A9C", color: "#ffffff", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem", transition: "all 0.2s" }}
            >
              View Registry
            </button>
          </div>
        </div>

        {/* Firmware Provisioning */}
        <div className="calibration-profiles-card-wrapper tools-card-item">
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "12px" }}>
              <ProvisioningIcon size={18} />
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Firmware Provisioning</h2>
            </div>
            <p className="card-description" style={{ marginBottom: "18px" }}>
              Generate an ESP setup portal QR URL for firmware in provisioning mode. QR sends Wi-Fi details and LocalHub backend URL.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px", fontSize: "0.95rem", color: "#334155" }}>
              <div>Hub Backend: <strong style={{ color: "#0f172a" }}>{serviceInfo?.backend_base_url ?? "Unavailable"}</strong></div>
              <div>Local IP: <strong style={{ color: "#0f172a" }}>{serviceInfo?.local_ip ?? "Unavailable"}</strong></div>
            </div>
            <button
              type="button"
              onClick={() => setIsProvisioningOpen(true)}
              style={{ padding: "10px 18px", borderRadius: "8px", border: "none", background: "#005A9C", color: "#ffffff", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem", transition: "all 0.2s" }}
            >
              Provision Device
            </button>
          </div>
        </div>
      </div>

      <Dialog
        open={isCalibrationOpen}
        onOpenChange={setIsCalibrationOpen}
        title="Calibration Settings"
        description="Edit local calibration profiles and run calibration against the selected live device."
        maxWidth="750px"
      >
        <div className="calibration-dialog-wrapper">
          <CalibrationSettingsPanel
            devices={manikins}
            selectedDeviceId={selectedCalibrationDeviceId}
            onSelectedDeviceChange={setSelectedCalibrationDeviceId}
            calibrationAction={selectedCalibrationDeviceId ? calibrationActionByDevice[selectedCalibrationDeviceId] ?? "idle" : "idle"}
            onRunCalibration={handleRunCalibration}
          />
        </div>
      </Dialog>

      <Dialog
        open={isProvisioningOpen}
        onOpenChange={setIsProvisioningOpen}
        title="Firmware Provisioning"
        maxWidth="750px"
      >
        <div className="calibration-dialog-wrapper">
          <FirmwareProvisioningPanel />
        </div>
      </Dialog>

      <Dialog
        open={isRegistryOpen}
        onOpenChange={setIsRegistryOpen}
        title="Device Registry"
        maxWidth="750px"
      >
        <div className="calibration-dialog-wrapper" style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: "-78px", right: "0px", zIndex: 50 }}>
            <Button
              variant="secondary"
              onClick={loadRegistry}
              disabled={registryLoading}
              className="h-8 w-8 p-0 flex items-center justify-center"
              aria-label="Refresh registry"
            >
              <RefreshCw size={14} className={registryLoading ? "animate-spin" : ""} />
            </Button>
          </div>
          <DeviceRegistryPanel
            registry={registry}
            loading={registryLoading}
            error={registryError}
          />
        </div>
      </Dialog>

      <Dialog
        open={isSessionReviewOpen}
        onOpenChange={setIsSessionReviewOpen}
        title="Local Session Review"
        maxWidth="90vw"
      >
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: "-78px", right: "0px", zIndex: 50 }}>
            <Button
              variant="secondary"
              onClick={loadRecentSessions}
              disabled={recentSessionsLoading}
              className="h-8 w-8 p-0 flex items-center justify-center"
              aria-label="Refresh completed sessions"
            >
              <RefreshCw size={14} className={recentSessionsLoading ? "animate-spin" : ""} />
            </Button>
          </div>
          <div className="calibration-dialog-wrapper" style={{ overflowY: "auto", maxHeight: "80vh" }}>
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
          </div>
        </div>
      </Dialog>
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
