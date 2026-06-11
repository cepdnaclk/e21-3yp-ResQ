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
  endSession,
  fetchCompletedSession,
  fetchCompletedSessions,
  startSession,
  type CompletedSession,
  type SessionStartResponse,
} from "../lib/browserSessionsApi";
import {
  fetchCourses,
  fetchCourseStudents,
  type CourseOption,
  type CourseStudentOption,
} from "../lib/browserCoursesApi";
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
  const { currentUser, logout } = useAuth();
  const [manikinsLoading, setManikinsLoading] = useState(true);
  const [manikinsError, setManikinsError] = useState<string | null>(null);
  const [manikinsStreamState, setManikinsStreamState] = useState<LiveStreamState>("connecting");
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);

  type SessionDraft = {
    courseId: string;
    traineeId: string;
  };
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, SessionDraft>>({});
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [studentsByCourseId, setStudentsByCourseId] = useState<Record<string, CourseStudentOption[]>>({});
  const [studentsLoadingByCourseId, setStudentsLoadingByCourseId] = useState<Record<string, boolean>>({});
  const [studentsErrorByCourseId, setStudentsErrorByCourseId] = useState<Record<string, string | null>>({});

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
            courseId: "",
            traineeId: "",
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

    async function loadCourses() {
      try {
        const records = await fetchCourses();
        setCourses(records);
        setCoursesError(null);
      } catch (error) {
        setCoursesError(error instanceof Error ? error.message : "Failed to load synced courses.");
      } finally {
        setCoursesLoading(false);
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
    loadCourses();
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
    if (state === "READY_FOR_SESSION") {
      return false;
    }

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

  async function handleCourseChange(deviceId: string, courseId: string) {
    setSessionDrafts((current) => ({
      ...current,
      [deviceId]: {
        courseId,
        traineeId: "",
      },
    }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    if (!courseId || studentsByCourseId[courseId] || studentsLoadingByCourseId[courseId]) {
      return;
    }

    setStudentsLoadingByCourseId((current) => ({ ...current, [courseId]: true }));
    setStudentsErrorByCourseId((current) => ({ ...current, [courseId]: null }));

    try {
      const students = await fetchCourseStudents(courseId);
      setStudentsByCourseId((current) => ({ ...current, [courseId]: students }));
    } catch (error) {
      setStudentsErrorByCourseId((current) => ({
        ...current,
        [courseId]: error instanceof Error ? error.message : "Failed to load enrolled trainees.",
      }));
    } finally {
      setStudentsLoadingByCourseId((current) => ({ ...current, [courseId]: false }));
    }
  }

  async function handleStartSession(deviceId: string) {
    const manikin = manikinByDeviceId.get(deviceId);
    if (!manikin) {
      return;
    }

    const draft = sessionDrafts[deviceId];
    if (!draft?.courseId || !draft.traineeId) {
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: "Select a course and enrolled trainee before starting the session.",
      }));
      return;
    }

    setSessionActionByDevice((current) => ({ ...current, [deviceId]: "starting" }));
    setSessionMessageByDevice((current) => ({ ...current, [deviceId]: null }));

    try {
      const response = await startSession({
        deviceId,
        courseId: draft.courseId,
        traineeId: draft.traineeId,
        scenario: manikin.activeSessionScenario ?? null,
        notes: null,
      });
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
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "#334155" }}>ESP provision path</span>
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
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "0.88rem", color: "#334155" }}>
                <span style={{ color: "#2563eb", display: "inline-flex" }} aria-hidden="true"><WifiSignalIcon /></span>
                Wi-Fi SSID
              </span>
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
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "#334155" }}>Wi-Fi password</span>
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
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "0.88rem", color: "#334155" }}>
                Backend base URL
                {backendUrlHasLocalhost ? <span className="provisioning-warning-icon" aria-hidden="true"><WarningIcon /></span> : null}
              </span>
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
            </label>
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
            <div className="provisioning-qr-panel" style={{
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DeviceRegistryIcon size={18} />
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
                Device Registry
              </h2>
            </div>
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LiveManikinsIcon size={18} />
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Manikins</h2>
            </div>
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

          {!manikinsLoading
            && !manikinsError
            && manikins.length > 0
            && manikins.every((manikin) => startBlockedByReadiness(readinessByDevice[manikin.deviceId])) ? (
              <div
                style={{
                  marginBottom: "10px",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #f59e0b",
                  background: "#fffbeb",
                  color: "#92400e",
                  fontSize: "0.88rem",
                }}
              >
                No manikin is ready for a session. Complete calibration or resolve the device readiness issue before starting.
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
                const sessionDraft = sessionDrafts[manikin.deviceId] ?? { courseId: "", traineeId: "" };
                const selectedCourseStudents = sessionDraft.courseId
                  ? studentsByCourseId[sessionDraft.courseId] ?? []
                  : [];
                const studentsLoading = sessionDraft.courseId
                  ? studentsLoadingByCourseId[sessionDraft.courseId] ?? false
                  : false;
                const studentsError = sessionDraft.courseId
                  ? studentsErrorByCourseId[sessionDraft.courseId] ?? null
                  : null;
                const startDisabled =
                  actionState !== "idle"
                  || startReadinessBlocked
                  || !sessionDraft.courseId
                  || !sessionDraft.traineeId;
                const effectiveFirmwareState = readiness?.firmwareState ?? manikin.firmwareState ?? manikin.state ?? "unknown";
                const isExpanded = expandedDeviceDetails[manikin.deviceId] ?? false;
                const calibrationProgress = progressFromId(readiness?.progressId);
                const isCalibrating = effectiveFirmwareState === "CALIBRATING";

                return (
                  <article
                    key={manikin.deviceId}
                    className="device-card"
                  >
                    <div className="device-card__top">
                      <div className="device-card__identity">
                        <div className="device-card__title-row">
                          <h3 style={{ margin: 0, fontSize: "1rem" }}>{manikin.deviceId}</h3>
                          <Sparkline seed={manikin.deviceId} />
                        </div>
                        <div className="device-card__chips">
                          <Chip icon={<DeviceMetricIcon kind="id" />}>{manikin.ip ?? "No IP"} · FW {manikin.fw ?? "unknown"}</Chip>
                          <Chip icon={<DeviceMetricIcon kind="seen" />}>{manikin.lastSeen ? `Last seen ${new Date(manikin.lastSeen).toLocaleTimeString()}` : "Never seen"}</Chip>
                          <Chip icon={<DeviceMetricIcon kind="calibrated" />}>{readiness?.calibrated ? "Calibrated" : "Not calibrated"}</Chip>
                        </div>
                      </div>
                      <div className="device-card__status-row">
                        <StatusDot label={manikin.online ? "Online" : "Offline"} status={manikin.online ? "online" : "offline"} />
                        <SessionStateBadge active={active} />
                      </div>
                    </div>

                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>State: {effectiveFirmwareState}</p>

                    {isCalibrating ? (
                      <div className="device-card__calibration">
                        <ProgressRing value={calibrationProgress} />
                        <span style={{ fontSize: "0.82rem", color: "#475569", fontWeight: 600 }}>Calibration in progress</span>
                      </div>
                    ) : null}
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
                        <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.78rem", color: "#64748b", alignSelf: "center" }}>
                          <CalibrationIcon size={14} />
                          <span>Use Calibration Settings to start a run.</span>
                        </span>
                      </div>
                    </div>

                    <FirmwareDiagnosticsPanel
                      deviceId={manikin.deviceId}
                      readiness={readiness}
                      liveSummary={manikin}
                    />

                    {!active && currentUser && currentUser.role !== "TRAINEE" ? (
                      <div style={{ display: "grid", gap: "8px", fontSize: "0.85rem", color: "#334155" }}>
                        <label htmlFor={`course-${manikin.deviceId}`} style={{ fontWeight: 600 }}>
                          Course
                        </label>
                        <select
                          id={`course-${manikin.deviceId}`}
                          value={sessionDraft.courseId}
                          onChange={(event) => void handleCourseChange(manikin.deviceId, event.target.value)}
                          disabled={coursesLoading || actionState !== "idle"}
                          style={{
                            padding: "6px 8px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            fontFamily: "inherit",
                            fontSize: "0.85rem",
                          }}
                        >
                          <option value="">{coursesLoading ? "Loading courses..." : "-- Select a course --"}</option>
                          {courses.map((course) => (
                              <option key={course.courseId} value={course.courseId}>
                                {course.courseCode ? `${course.courseCode} - ` : ""}{course.title}
                              </option>
                          ))}
                        </select>
                        {coursesError ? (
                          <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.8rem" }}>{coursesError}</p>
                        ) : null}

                        <label htmlFor={`trainee-${manikin.deviceId}`} style={{ fontWeight: 600 }}>
                          Enrolled Trainee
                        </label>
                        <select
                          id={`trainee-${manikin.deviceId}`}
                          value={sessionDraft.traineeId}
                          onChange={(event) =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...(current[manikin.deviceId] ?? sessionDraft),
                                traineeId: event.target.value,
                              },
                            }))
                          }
                          disabled={!sessionDraft.courseId || studentsLoading || actionState !== "idle"}
                          style={{
                            padding: "6px 8px",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            fontFamily: "inherit",
                            fontSize: "0.85rem",
                          }}
                        >
                          <option value="">
                            {!sessionDraft.courseId
                              ? "Select a course first"
                              : studentsLoading
                                ? "Loading enrolled trainees..."
                                : "-- Select an enrolled trainee --"}
                          </option>
                          {selectedCourseStudents.map((student) => (
                            <option key={student.traineeId} value={student.traineeId}>
                              {student.displayName}{student.email && student.email !== student.displayName ? ` (${student.email})` : ""}
                            </option>
                          ))}
                        </select>
                        {studentsError ? (
                          <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.8rem" }}>{studentsError}</p>
                        ) : null}
                        {!studentsLoading
                          && sessionDraft.courseId
                          && !studentsError
                          && selectedCourseStudents.length === 0 ? (
                            <p style={{ margin: 0, color: "#64748b", fontSize: "0.8rem" }}>
                              No enrolled trainees are available for this course.
                            </p>
                          ) : null}
                        {startReadinessBlocked ? (
                          <p style={{ margin: 0, color: "#92400e", fontSize: "0.8rem" }}>
                            This manikin is not ready for a session.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

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

                    <button
                      type="button"
                      className="device-card__details-toggle"
                      onClick={() =>
                        setExpandedDeviceDetails((current) => ({
                          ...current,
                          [manikin.deviceId]: !current[manikin.deviceId],
                        }))
                      }
                    >
                      {isExpanded ? "Hide technical details" : "Show technical details"}
                    </button>

                    <div className={`device-card__details ${isExpanded ? "device-card__details--open" : ""}`}>
                      <div className="device-card__details-inner">
                        <div style={{ display: "grid", gap: 4, fontSize: "0.84rem", color: "#334155" }}>
                          <div>Device ID: {manikin.deviceId}</div>
                          <div>Last seen: {manikin.lastSeen ? new Date(manikin.lastSeen).toLocaleString() : "Never seen"}</div>
                          <div>Calibrated: {readiness?.calibrated ? "Yes" : "No"}</div>
                          <div>Progress ID: {readiness?.progressId ?? "-"}</div>
                          <div>Firmware state: {readiness?.firmwareState ?? "-"}</div>
                          <div>Reason: {readiness?.reasonId ?? "-"}</div>
                          <div>Action: {readiness?.actionId ?? "-"}</div>
                        </div>
                      </div>
                    </div>

                    {active ? (
                      <div style={{ display: "grid", gap: "8px", background: "linear-gradient(180deg,#ffffff,#f7fbff)", borderRadius: "12px", padding: "12px", border: "1px solid #e6f0fb", boxShadow: "0 8px 20px rgba(13,42,86,0.06)" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontSize: "0.82rem", color: "#64748b" }}>Session</div>
                          <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0f172a", wordBreak: "break-all" }}>{activeSession!.sessionId}</div>
                        </div>
                        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontSize: "0.82rem", color: "#64748b" }}>Trainee</div>
                          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#0f172a" }}>{activeSession!.traineeId ?? "-"}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontSize: "0.82rem", color: "#64748b" }}>Trainee Link</div>
                          <div style={{ background: "#0f172a", color: "#ffffff", padding: "8px 12px", borderRadius: 10, fontWeight: 800 }}>
                            {traineeLink ?? buildTraineeLandingUrl()}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => navigateToTraineeDashboard(activeSession!.sessionId)}
                            className="cta-royal"
                            aria-label="Open trainee dashboard in app"
                          >
                            Open Trainee Dashboard (In-App)
                          </button>
                          {traineeLink ? (
                            <a href={traineeLink} style={{ padding: "8px 12px", borderRadius: 8, background: "#f1f5f9", color: "#0f172a", fontWeight: 700, textDecoration: "none" }}>
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
                            <p style={{ margin: 0, color: "#475569", fontSize: "0.84rem" }}>{deviceMessage}</p>
                          );
                        })()}
                      </div>
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
