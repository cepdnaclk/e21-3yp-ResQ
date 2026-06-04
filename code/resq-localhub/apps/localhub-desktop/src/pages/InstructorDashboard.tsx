import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
const QR = QRCodeSVG as any;
import { useAuth } from "../auth/AuthContext";
import { Card, Button, Alert, Skeleton, Badge, Input, Select } from "../components/ui";
import HubHeartbeat from "../components/icons/HubHeartbeat";
import RadarManikin from "../components/icons/RadarManikin";
import PlusPulse from "../components/icons/PlusPulse";
import CounterFlip from "../components/icons/CounterFlip";
import { fetchBrowserHealth, type BrowserHealthResponse } from "../lib/browserHealthApi";
import { MANUAL_LAN_IP_STORAGE_KEY, sanitizeManualLanIp } from "../lib/accessHost";
import { generateAccessUrls } from "../lib/accessUrls";
import {
  fetchManikinInventory,
  getLiveManikinsStreamUrl,
  type ManikinInventoryEntry,
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

const SESSION_TOUR_KEY = "resq-session-tour-seen";

type HeatmapDay = {
  date: string;
  count: number;
};

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
type LiveStreamState = "connecting" | "connected" | "reconnecting" | "unavailable";
type InventoryStatus = "paired" | "pending" | "online" | "offline" | "stale" | "unknown";

type InstructorDashboardProps = {
  embeddedInDesktop?: boolean;
  onOpenTraineeDashboard?: (sessionId: string) => void;
  manualLanIpOverride?: string | null;
};

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

function getInventoryBadgeTone(status: InventoryStatus): "success" | "warning" | "danger" | "info" {
  if (status === "online") {
    return "success";
  }

  if (status === "offline") {
    return "danger";
  }

  if (status === "stale" || status === "pending") {
    return "warning";
  }

  return "info";
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
  const [manikins, setManikins] = useState<ManikinInventoryEntry[]>([]);
  const [manikinsRefreshKey, setManikinsRefreshKey] = useState(0);

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
  const [sessionMessageByDevice, setSessionMessageByDevice] = useState<Record<string, string | null>>({});
  const [recentSessions, setRecentSessions] = useState<CompletedSession[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(true);
  const [recentSessionsError, setRecentSessionsError] = useState<string | null>(null);
  const [latestEndedSession, setLatestEndedSession] = useState<CompletedSession | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedSessionDetail, setExpandedSessionDetail] = useState<CompletedSession | null>(null);
  const [expandedSessionLoading, setExpandedSessionLoading] = useState(false);
  const [expandedSessionError, setExpandedSessionError] = useState<string | null>(null);
  const [showSessionTour, setShowSessionTour] = useState(false);
  const [showOnlyLiveManikins, setShowOnlyLiveManikins] = useState(true);
  const [showManikinDiagnostics, setShowManikinDiagnostics] = useState(false);

  function applyInventorySnapshot(entries: ManikinInventoryEntry[]) {
    setManikins(entries);
    setSessionDrafts((current) => {
      const next = { ...current };
      for (const manikin of entries) {
        if (!next[manikin.deviceId]) {
          next[manikin.deviceId] = {
            traineeMode: "select",
          };
        }
      }
      return next;
    });
  }

  function buildRecentSessionHeatmap(sessions: CompletedSession[], days = 28): HeatmapDay[] {
    const today = new Date();
    const counts = new Map<string, number>();

    for (const session of sessions) {
      const date = new Date(session.endedAt);
      if (Number.isNaN(date.getTime())) {
        continue;
      }

      const key = date.toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Array.from({ length: days }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() - (days - 1 - index));
      const key = day.toISOString().slice(0, 10);

      return {
        date: key,
        count: counts.get(key) ?? 0,
      };
    });
  }

  function buildTimelineMarkers(sessions: CompletedSession[]): Array<{ label: string; position: number; completed: boolean }> {
    return [
      { label: "Start", position: 10, completed: sessions.length > 0 },
      { label: "Check-in", position: 35, completed: sessions.length > 0 },
      { label: "Midway", position: 62, completed: sessions.length > 1 },
      { label: "Wrap-up", position: 88, completed: sessions.length > 2 },
    ];
  }

  useEffect(() => {
    async function loadHealth() {
      setHealthLoading(true);
      const result = await fetchBrowserHealth();
      setHealth(result);
      setHealthLoading(false);
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

    loadHealth();
    loadRecentSessions();
    loadTrainees();

    const healthInterval = setInterval(loadHealth, 5000);
    const recentSessionsInterval = setInterval(loadRecentSessions, 10000);

    return () => {
      clearInterval(healthInterval);
      clearInterval(recentSessionsInterval);
    };
  }, []);

  useEffect(() => {
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

    async function loadManikins() {
      try {
        const inventory = await fetchManikinInventory();
        if (cancelled) {
          return;
        }

        applyInventorySnapshot(inventory);
        setManikinsError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setManikinsError("Failed to fetch");
      } finally {
        if (!cancelled) {
          setManikinsLoading(false);
        }
      }
    }

    function startFallbackPolling() {
      if (fallbackInterval) {
        return;
      }

      fallbackInterval = setInterval(() => {
        void loadManikins();
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

        applyInventorySnapshot(payload.map((manikin) => {
          const state = manikin.state?.toLowerCase() ?? "";
          const status: InventoryStatus = state.includes("pending")
            ? "pending"
            : state.includes("stale")
              ? "stale"
              : state.includes("paired") || Boolean(manikin.sessionActive)
                ? "paired"
                : manikin.online
                  ? "online"
                  : "offline";

          return {
            ...manikin,
            status,
            rawStatus: manikin.state,
          };
        }));
        setManikinsLoading(false);
      });

      stream.addEventListener("heartbeat", () => {
        // Keep-alive only.
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

    setManikinsLoading(true);
    void loadManikins().finally(() => {
      if (!cancelled) {
        connectManikinStream();
      }
    });

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      stopFallbackPolling();
    };
  }, [manikinsRefreshKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setShowSessionTour(window.localStorage.getItem(SESSION_TOUR_KEY) !== "true");
  }, []);

  // Sim Theater feature removed; no-op stubs eliminated.

  useEffect(() => {
    if (!manikinsError) {
      setShowManikinDiagnostics(false);
    }
  }, [manikinsError]);

  function dismissSessionTour() {
    setShowSessionTour(false);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_TOUR_KEY, "true");
    }
  }

  function retryLoadManikins() {
    setManikinsRefreshKey((current) => current + 1);
  }

  const manikinByDeviceId = useMemo(() => {
    return new Map(manikins.map((manikin) => [manikin.deviceId, manikin]));
  }, [manikins]);

  const inventoryItems = useMemo(() => {
    return manikins;
  }, [manikins]);

  const inventoryBuckets = useMemo(() => {
    return inventoryItems.reduce<Record<InventoryStatus, typeof inventoryItems>>((accumulator, entry) => {
      accumulator[entry.status].push(entry);
      return accumulator;
    }, {
      paired: [],
      pending: [],
      online: [],
      offline: [],
      stale: [],
      unknown: [],
    });
  }, [inventoryItems]);

  const visibleManikins = useMemo(() => {
    if (!showOnlyLiveManikins) {
      return manikins;
    }

    return manikins.filter((manikin) => manikin.online);
  }, [manikins, showOnlyLiveManikins]);

  const hubStatusCardClass = healthLoading
    ? "card--status-info"
    : health?.ok
      ? "card--status-success"
      : "card--status-danger";

  const liveManikinsCardClass = manikinsError
    ? "card--status-danger"
    : manikinsStreamState === "connected"
      ? "card--status-success"
      : manikinsStreamState === "reconnecting"
        ? "card--status-warning"
        : "card--status-info";

  const recentSessionHeatmap = useMemo(() => buildRecentSessionHeatmap(recentSessions), [recentSessions]);
  const sessionTimelineMarkers = useMemo(() => buildTimelineMarkers(recentSessions), [recentSessions]);

  function inventoryBadgeStyle(status: InventoryStatus): React.CSSProperties {
    if (status === "online" || status === "paired") {
      return { background: "#dcfce7", color: "#166534" };
    }

    if (status === "pending") {
      return { background: "#fef3c7", color: "#92400e" };
    }

    if (status === "stale" || status === "offline") {
      return { background: "#fee2e2", color: "#991b1b" };
    }

    return { background: "#e2e8f0", color: "#334155" };
  }

  function formatInventoryLastSeen(value: string | null): string {
    if (!value) {
      return "No heartbeat yet";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

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

  function isDataStale(lastSeenString: string | null): boolean {
    if (!lastSeenString) return true;
    
    const lastSeenDate = new Date(lastSeenString);
    if (Number.isNaN(lastSeenDate.getTime())) return true;
    
    const now = new Date();
    const ageSeconds = (now.getTime() - lastSeenDate.getTime()) / 1000;
    
    // Data is stale if older than 5 seconds
    return ageSeconds > 5;
  }

  function metric(value: number | null, suffix: string): string {
    if (value === null || value === undefined) {
      return "-";
    }

    return `${value.toFixed(1)} ${suffix}`;
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
    if (canUseOrigin) {
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

    return `${window.location.origin}/trainee`;
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
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ ...styles.title, color: styles.title.color }}>
              Instructor Dashboard
            </h1>
            <p style={{ ...styles.subtitle, color: styles.subtitle.color }}>
              Multi-manikin live performance monitoring and control
            </p>
          </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {currentUser ? (
              <>
                <span style={{ padding: "6px 10px", borderRadius: "999px", background: "#e2e8f0", color: "#334155", fontSize: "0.8rem", fontWeight: 700 }}>
                  {currentUser.role}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      logout().finally(() => window.location.assign("/login"));
                    }}
                    aria-label="Logout"
                  >
                    Logout
                  </Button>
                </div>
              </>
            ) : null}
            {!embeddedInDesktop ? (
              <Button variant="secondary" onClick={navigateToDesktopHome}>Back To Home</Button>
            ) : null}
          </div>
        </div>
      </header>

      <div style={styles.content}>
        <Card className={hubStatusCardClass}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
              <HubHeartbeat state={healthLoading ? 'checking' : health?.ok ? 'ok' : 'down'} size={20} />
              Hub Status
            </h2>
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
        </Card>

        

        <Card aria-labelledby="completed-sessions-title">
          <h2 id="completed-sessions-title" className="card__title">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 3v18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>Completed Session Summary</span>
          </h2>
          {latestEndedSession ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Session: {latestEndedSession.sessionId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Device: {latestEndedSession.deviceId}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Trainee: {latestEndedSession.traineeId ?? "-"}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Started: {formatSummaryTime(latestEndedSession.startedAt)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Ended: {formatSummaryTime(latestEndedSession.endedAt)}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Duration: {latestEndedSession.summary.durationSeconds}s</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Avg depth: {formatMetric(latestEndedSession.summary.avgDepthMm, "mm")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Avg rate: {formatMetric(latestEndedSession.summary.avgRateCpm, "cpm")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Recoil: {formatMetric(latestEndedSession.summary.recoilPct, "%")}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Pauses: {latestEndedSession.summary.pausesCount}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Score: {latestEndedSession.summary.score}</p>
              <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Flags: {latestEndedSession.summary.latestFlags ?? "-"}</p>
            </div>
          ) : (
            <div className="card card--dashed" aria-live="polite">
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 4v16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 12h16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <p style={{ marginTop: 8 }}>End a session to see the summary here.</p>
            </div>
          )}
        </Card>

        <Card aria-labelledby="session-timeline-title" className="session-timeline-card">
          <div className="session-timeline-card__header">
            <div>
              <h2 id="session-timeline-title" className="card__title">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7h16" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 12h16" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 17h16" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span>Session Timeline</span>
              </h2>
              <p className="session-timeline-card__copy">
                End a session to populate the summary below. This placeholder shows where live progress markers and recent-session history will appear.
              </p>
            </div>
            <Badge variant="status" className="status-badge--info">
              Placeholder
            </Badge>
          </div>

          <div className="session-timeline__canvas">
            <div className="session-timeline__track-wrap">
              <div className="session-timeline__track" aria-label="Session progress bar placeholder" role="group">
                <div
                  className="session-timeline__progress"
                  style={{ width: `${Math.min(18 + recentSessions.length * 10, 100)}%` }}
                />
                {sessionTimelineMarkers.map((marker) => (
                  <button
                    key={marker.label}
                    type="button"
                    className={`session-timeline__marker ${marker.completed ? "session-timeline__marker--active" : ""}`}
                    style={{ left: `${marker.position}%` }}
                    draggable
                    title={`${marker.label} marker`}
                    aria-label={`${marker.label} marker placeholder`}
                  >
                    <span className="session-timeline__marker-dot" />
                    <span className="session-timeline__marker-label">{marker.label}</span>
                  </button>
                ))}
              </div>
              <div className="session-timeline__scale" aria-hidden="true">
                <span>Start</span>
                <span>Checkpoint</span>
                <span>Wrap-up</span>
              </div>
            </div>

            {showSessionTour ? (
              <div className="session-timeline__tour" role="dialog" aria-modal="false" aria-label="Session timeline guided tour">
                <div className="session-timeline__tour-card">
                  <p className="session-timeline__tour-eyebrow">First-time tour</p>
                  <p className="session-timeline__tour-title">This is a placeholder session timeline.</p>
                  <p className="session-timeline__tour-copy">
                    When you end a session, the summary card above and the recent-session history below will fill in automatically.
                  </p>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button variant="secondary" onClick={dismissSessionTour}>
                      Got it
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="session-heatmap">
              <div className="session-heatmap__header">
                <div>
                  <h3 className="session-heatmap__title">Recent Sessions Heatmap</h3>
                  <p className="session-heatmap__copy">Grey squares become greener as more sessions complete on that day.</p>
                </div>
                <div className="session-heatmap__legend" aria-hidden="true">
                  <span>Less</span>
                  <span className="session-heatmap__swatch session-heatmap__swatch--0" />
                  <span className="session-heatmap__swatch session-heatmap__swatch--1" />
                  <span className="session-heatmap__swatch session-heatmap__swatch--2" />
                  <span className="session-heatmap__swatch session-heatmap__swatch--3" />
                  <span>More</span>
                </div>
              </div>

              <div className="session-heatmap__grid" role="img" aria-label="Calendar heatmap of recent completed sessions">
                {recentSessionHeatmap.map((day) => {
                  const intensity = Math.min(day.count, 4);

                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`session-heatmap__cell session-heatmap__cell--${intensity}`}
                      title={`${day.date}: ${day.count} completed session${day.count === 1 ? "" : "s"}`}
                      aria-label={`${day.date}: ${day.count} completed session${day.count === 1 ? "" : "s"}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card aria-labelledby="inventory-title">
          <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
            <h2 id="inventory-title" className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <PlusPulse size={18} />
              <span>Manikin inventory</span>
            </h2>
            <Badge variant="count" aria-hidden>
              <CounterFlip value={inventoryItems.length} /> devices
            </Badge>
          </div>

          {manikinsLoading ? (
            <div style={{ display: "grid", gap: "10px" }}>
              <Skeleton className="skeleton--shimmer" />
              <Skeleton className="skeleton--shimmer" />
              <Skeleton className="skeleton--shimmer" />
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.88rem" }}>No manikins are registered yet.</p>
            </div>
          ) : inventoryItems.length === 0 ? (
            <div className="card card--dashed" aria-live="polite">
              <p style={{ marginTop: 8 }}>No manikins are registered yet.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(["paired", "pending", "online", "offline", "stale"] as const).map((status) => (
                  <span key={status} style={{ ...inventoryBadgeStyle(status), display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 700 }}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}: {inventoryBuckets[status].length}
                  </span>
                ))}
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                {inventoryItems.map((entry) => (
                  <Card key={entry.deviceId}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>{entry.deviceId}</p>
                        <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "0.85rem" }}>
                          {entry.ip ?? "No IP"} • {entry.fw ?? "No firmware"}
                        </p>
                      </div>
                      <Badge variant="status" className={`status-badge--${getInventoryBadgeTone(entry.status)}`}>
                        {entry.status}
                      </Badge>
                    </div>

                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      State: {entry.rawStatus ?? entry.state ?? "unknown"} • Last seen: {formatInventoryLastSeen(entry.lastSeen)}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Session: {entry.activeSessionId ?? "-"} • Trainee: {entry.activeTraineeId ?? "-"} • Scenario: {entry.activeSessionScenario ?? "-"}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="card" aria-labelledby="recent-sessions-title">
          <h2 id="recent-sessions-title" className="card__title">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 7h18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 3v18" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>Recent Sessions</span>
          </h2>
          {recentSessionsLoading ? (
            <div style={{ display: "grid", gap: 8 }}>
              <Skeleton className="skeleton--shimmer" />
              <Skeleton className="skeleton--shimmer" />
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.88rem" }}>No completed sessions yet.</p>
            </div>
          ) : recentSessionsError ? (
            <Alert variant="danger" title={recentSessionsError ? "Unable to load completed sessions" : "Recent Sessions"} detail={recentSessionsError} />
          ) : recentSessions.length === 0 ? (
            <div className="card card--dashed" aria-live="polite">
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 4v16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 12h16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <p style={{ marginTop: 8 }}>No completed sessions yet.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {recentSessions.map((session) => (
                <article
                  key={session.sessionId}
                  className="card"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleViewDetails(session.sessionId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleViewDetails(session.sessionId);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, color: "#0f172a" }}>{formatSummaryDateTime(session.startedAt)}</p>
                      <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "0.85rem" }}>Manikin {session.deviceId}</p>
                    </div>
                  </div>
                  <div style={{ marginTop: "8px", display: "grid", gap: "4px" }}>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.85rem" }}>
                      Duration {session.summary.durationSeconds}s
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.85rem" }}>
                      Started {formatSummaryDateTime(session.startedAt)} • Ended {formatSummaryDateTime(session.endedAt)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>

        <div className="inventory-live-bridge" aria-hidden="false">
          <span className="inventory-live-bridge__line" />
          <span className="inventory-live-bridge__hint">
            <span className="inventory-live-bridge__question" tabIndex={0} aria-label="Register a manikin to see it here">?</span>
            <span className="inventory-live-bridge__tooltip">Register a manikin to see it here.</span>
          </span>
        </div>

        <section className={`card ${liveManikinsCardClass} ${manikins.length > 0 && manikins.some((m) => isDataStale(m.lastSeen)) ? "card--stale" : ""}`}>
          <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
            <h2 className="card__title">{/* icon */}
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2v6" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 12h14" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 22v-6" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ marginLeft: 6 }}>Live Manikins</span>
            </h2>
            <div className="flex items-center gap-8" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
              <label className="live-filter-toggle">
                <input
                  type="checkbox"
                  checked={showOnlyLiveManikins}
                  onChange={(event) => setShowOnlyLiveManikins(event.target.checked)}
                />
                <span className="live-filter-toggle__switch" aria-hidden="true" />
                <span>Show only live manikins</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={manikinsStreamState === 'connected' ? 'status-badge status-badge--success' : 'status-badge status-badge--info'}>
                  {manikinsStreamState === 'reconnecting' ? (
                    <RadarManikin sweep size={18} />
                  ) : (
                    <span className={manikinsStreamState === 'connected' ? 'pulse-dot pulse-dot--green' : 'pulse-dot pulse-dot--red'} aria-hidden="true"></span>
                  )}
                  {manikinsStreamState === 'connected' ? 'Connected' : manikinsStreamState === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
                </span>
              </div>
            </div>
          </div>

          {manikinsLoading ? (
            <div style={{ display: "grid", gap: 10 }}>
              <Skeleton className="skeleton--shimmer" />
              <Skeleton className="skeleton--shimmer" />
              <Skeleton className="skeleton--shimmer" />
            </div>
          ) : null}

          {!manikinsLoading && manikinsError ? (
            <Alert variant="danger">
              <div>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => setShowManikinDiagnostics((current) => !current)}
                  aria-expanded={showManikinDiagnostics}
                >
                  {manikinsError.toLowerCase().includes("failed to fetch") ? "Failed to fetch" : "Unable to load live manikins"}
                </button>
                <p className="alert__detail">{`Unable to load live manikins. ${manikinsError}`}</p>
                <div style={{ marginTop: 8 }}>
                  <Button variant="secondary" onClick={() => retryLoadManikins()}>
                    Retry
                  </Button>
                </div>
                <div className={`network-diagnostics ${showManikinDiagnostics ? "network-diagnostics--open" : ""}`}>
                  <div className="network-diagnostics__panel">
                    <p className="network-diagnostics__title">Network diagnostic mock</p>
                    <p className="network-diagnostics__line">Endpoint: {getLiveManikinsStreamUrl()}</p>
                    <p className="network-diagnostics__line">Transport: EventSource / fallback polling</p>
                    <p className="network-diagnostics__line">Last retry: waiting for reconnect window</p>
                    <p className="network-diagnostics__line">Tip: check LAN connectivity and the streaming endpoint route.</p>
                  </div>
                </div>
              </div>
            </Alert>
          ) : null}

          {!manikinsLoading && !manikinsError && visibleManikins.length === 0 ? (
            <div className="card card--dashed" aria-live="polite">
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 4v16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 12h16" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <p style={{ marginTop: 8 }}>
                {showOnlyLiveManikins
                  ? "No live manikins are visible right now. Turn off the filter to see all devices."
                  : "No manikins publishing yet. Start publishing to resq/manikins/<deviceId>/status, heartbeat, telemetry, events, or live."}
              </p>
            </div>
          ) : null}

          {!manikinsLoading && !manikinsError && visibleManikins.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
              {visibleManikins.map((manikin) => {
                const activeSession = getEffectiveSession(manikin.deviceId, manikin);
                const active = Boolean(activeSession?.sessionId);
                const traineeLink = activeSession?.sessionId ? buildTraineeUrl(activeSession.sessionId) : null;
                const actionState = sessionActionByDevice[manikin.deviceId] ?? "idle";
                const depthOk = manikin.latestDepthMm !== null && manikin.latestDepthMm >= 50 && manikin.latestDepthMm <= 60;
                const rateOk = manikin.latestRateCpm !== null && manikin.latestRateCpm >= 100 && manikin.latestRateCpm <= 120;
                const recoilOk = manikin.latestRecoilOk === true;
                const pressureBalanced = manikin.pressureSkewed === null ? null : !manikin.pressureSkewed;

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

                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>State: {manikin.state ?? "unknown"}</p>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <IndicatorBadge
                        label={depthOk ? "Depth 50-60 OK" : manikin.latestDepthMm === null ? "Depth -" : "Depth Out"}
                        status={manikin.latestDepthMm === null ? "neutral" : depthOk ? "ok" : "warn"}
                      />
                      <IndicatorBadge
                        label={rateOk ? "Rate 100-120 OK" : manikin.latestRateCpm === null ? "Rate -" : "Rate Out"}
                        status={manikin.latestRateCpm === null ? "neutral" : rateOk ? "ok" : "warn"}
                      />
                      <IndicatorBadge
                        label={manikin.latestRecoilOk === null ? "Recoil -" : recoilOk ? "Recoil OK" : "Recoil Not OK"}
                        status={manikin.latestRecoilOk === null ? "neutral" : recoilOk ? "ok" : "warn"}
                      />
                      <IndicatorBadge
                        label={pressureBalanced === null ? "Pressure -" : pressureBalanced ? "Pressure Even" : "Pressure Skewed"}
                        status={pressureBalanced === null ? "neutral" : pressureBalanced ? "ok" : "warn"}
                      />
                    </div>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Depth: {metric(manikin.latestDepthMm, "mm")}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Rate: {metric(manikin.latestRateCpm, "cpm")}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Recoil: {manikin.latestRecoilOk === null ? "-" : manikin.latestRecoilOk ? "OK" : "Not OK"}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Force Balance: {manikin.pressureBalancePct === null ? "-" : `${manikin.pressureBalancePct.toFixed(1)}%`}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Force A/B: {manikin.latestForce1 === null || manikin.latestForce2 === null ? "-" : `${manikin.latestForce1} / ${manikin.latestForce2}`}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>Pause: {metric(manikin.latestPauseS, "s")}</p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Last Seen: {formatLastSeen(manikin.lastSeen)}
                    </p>
                    <p style={{ margin: 0, color: "#475569", fontSize: "0.88rem" }}>
                      Last Event: {manikin.lastEventType ?? "-"}
                    </p>

                    {/* Trainee Selection UI */}
                    <div style={{ display: "grid", gap: "8px", fontSize: "0.85rem", color: "#334155" }}>
                      <div style={{ fontWeight: 600 }}>Select Trainee</div>

                      {/* Mode Selection */}
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <Button
                          variant={sessionDrafts[manikin.deviceId]?.traineeMode === "select" ? "primary" : "secondary"}
                          onClick={() =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeMode: "select",
                              },
                            }))
                          }
                          style={{ fontSize: "0.8rem" }}
                        >
                          Select
                        </Button>
                        <Button
                          variant={sessionDrafts[manikin.deviceId]?.traineeMode === "quick" ? "primary" : "secondary"}
                          onClick={() =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeMode: "quick",
                              },
                            }))
                          }
                          style={{ fontSize: "0.8rem" }}
                        >
                          Quick Add
                        </Button>
                        <Button
                          variant={sessionDrafts[manikin.deviceId]?.traineeMode === "guest" ? "primary" : "secondary"}
                          onClick={() =>
                            setSessionDrafts((current) => ({
                              ...current,
                              [manikin.deviceId]: {
                                ...current[manikin.deviceId],
                                traineeMode: "guest",
                              },
                            }))
                          }
                          style={{ fontSize: "0.8rem" }}
                        >
                          Guest
                        </Button>
                      </div>

                      {/* Select Mode UI */}
                      {sessionDrafts[manikin.deviceId]?.traineeMode === "select" && (
                        <Select
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
                        >
                          <option value="">-- Select a trainee --</option>
                          {traineesLoading && <option>Loading...</option>}
                          {!traineesLoading &&
                            trainees.map((trainee) => (
                              <option key={trainee.id} value={trainee.id}>
                                {trainee.displayName} ({trainee.traineeCode})
                              </option>
                            ))}
                        </Select>
                      )}

                      {/* Quick Add Mode UI */}
                      {sessionDrafts[manikin.deviceId]?.traineeMode === "quick" && (
                        <div style={{ display: "grid", gap: "6px" }}>
                          <Input
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
                          />
                          <Input
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
                          />
                          <Input
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
                        <Button
                          onClick={() => handleStartSession(manikin.deviceId)}
                          disabled={actionState !== "idle"}
                          variant="primary"
                        >
                          Start Session
                        </Button>
                        ) : (
                        <Button
                          onClick={() => handleEndSession(manikin.deviceId, activeSession!.sessionId)}
                          disabled={actionState !== "idle"}
                          style={{ background: "#991b1b", borderColor: "#991b1b" }}
                        >
                          End Session
                        </Button>
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
                        <div
                          style={{
                            marginTop: "4px",
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid #dbe3ee",
                            background: "#ffffff",
                            display: "grid",
                            justifyItems: "center",
                            gap: "8px",
                          }}
                        >
                          <p style={{ margin: 0, fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>
                            Student Dashboard QR
                          </p>
                          <QR value={traineeLink ?? buildTraineeLandingUrl()} size={144} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                          <p style={{ margin: 0, fontSize: "0.76rem", color: "#64748b", textAlign: "center" }}>
                            Scan to open the trainee dashboard. The QR updates to the active session when one starts.
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <Button
                            onClick={() => navigateToTraineeDashboard(activeSession!.sessionId)}
                            variant="primary"
                          >
                            Open Trainee Dashboard (In-App)
                          </Button>
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

        {expandedSessionId ? (
          <div
            className="story-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-details-title"
            onClick={() => {
              setExpandedSessionId(null);
              setExpandedSessionDetail(null);
              setExpandedSessionError(null);
              setExpandedSessionLoading(false);
            }}
          >
            <div className="story-modal__panel" onClick={(event) => event.stopPropagation()}>
              <h3 id="session-details-title" className="story-modal__title">
                Session details
              </h3>
              {expandedSessionLoading ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <Skeleton className="skeleton--shimmer" />
                  <Skeleton className="skeleton--shimmer" />
                  <Skeleton className="skeleton--shimmer" />
                </div>
              ) : expandedSessionError ? (
                <p className="story-modal__copy" style={{ color: "#b91c1c" }}>
                  {expandedSessionError}
                </p>
              ) : expandedSessionDetail ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <p className="story-modal__copy">Manikin: {expandedSessionDetail.deviceId}</p>
                  <p className="story-modal__copy">Trainee: {expandedSessionDetail.traineeId ?? "-"}</p>
                  <p className="story-modal__copy">Started: {formatSummaryDateTime(expandedSessionDetail.startedAt)}</p>
                  <p className="story-modal__copy">Ended: {formatSummaryDateTime(expandedSessionDetail.endedAt)}</p>
                  <p className="story-modal__copy">Duration: {expandedSessionDetail.summary.durationSeconds}s</p>
                  <p className="story-modal__copy">Score: {expandedSessionDetail.summary.score}</p>
                  <p className="story-modal__copy">Avg Depth: {formatMetric(expandedSessionDetail.summary.avgDepthMm, "mm")}</p>
                  <p className="story-modal__copy">Avg Rate: {formatMetric(expandedSessionDetail.summary.avgRateCpm, "cpm")}</p>
                  <p className="story-modal__copy">Recoil: {formatMetric(expandedSessionDetail.summary.recoilPct, "%")}</p>
                  <p className="story-modal__copy">Pauses: {expandedSessionDetail.summary.pausesCount}</p>
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setExpandedSessionId(null);
                    setExpandedSessionDetail(null);
                    setExpandedSessionError(null);
                    setExpandedSessionLoading(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        
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

