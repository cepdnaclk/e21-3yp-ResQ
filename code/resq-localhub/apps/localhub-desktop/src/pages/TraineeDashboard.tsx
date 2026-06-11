import { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
} from "recharts";
import { useAuth } from "../auth/AuthContext";
import { LiveMetricsPanel } from "../components/LiveMetricsPanel";
import { useLiveSession } from "../hooks/useLiveSession";
import RadarManikin from "../components/icons/RadarManikin";
import CounterFlip from "../components/icons/CounterFlip";
import {
  fetchSessionLive,
  type SessionLiveView,
} from "../lib/browserSessionsApi";
import { CoursesPanel } from "../components/CoursesPanel";

/**
 * Browser-safe Trainee Dashboard.
 *
 * This page is served at http://<host>:1420/trainee and can be opened
 * in any browser on the LAN without depending on Tauri APIs.
 */



function SessionStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: active ? "#dcfce7" : "#fee2e2",
        color: active ? "#166534" : "#991b1b",
      }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

type LiveStreamState = "connecting" | "connected" | "reconnecting" | "unavailable";

type TraineeDashboardProps = {
  embeddedInDesktop?: boolean;
  initialSessionId?: string | null;
};

const WAITING_SESSION_TIPS = [
  "Once a session is assigned, vital signs will appear here.",
  "Your instructor will start the scenario from their dashboard.",
  "Ensure your headset / microphone are ready for debrief.",
];

type SensorPoint = {
  ts: number;
  depthMm: number | null;
  rateCpm: number | null;
  pauseS: number | null;
  recoilOk: boolean | null;
  flags: string | null;
};

const MAX_SENSOR_POINTS = 80;

type MonitorLevel = "good" | "warn" | "critical" | "neutral";
type CprProfile = "adult" | "pediatric";

type ProfileThresholds = {
  depthTarget: [number, number];
  depthCritical: [number, number];
  rateTarget: [number, number];
  rateCritical: [number, number];
  pauseWarn: number;
  pauseCritical: number;
  qualityWarn: number;
  qualityCritical: number;
};

const CPR_THRESHOLDS: Record<CprProfile, ProfileThresholds> = {
  adult: {
    depthTarget: [50, 60],
    depthCritical: [45, 65],
    rateTarget: [100, 120],
    rateCritical: [90, 130],
    pauseWarn: 0.5,
    pauseCritical: 0.8,
    qualityWarn: 80,
    qualityCritical: 65,
  },
  pediatric: {
    depthTarget: [40, 50],
    depthCritical: [35, 55],
    rateTarget: [100, 120],
    rateCritical: [90, 130],
    pauseWarn: 0.5,
    pauseCritical: 0.8,
    qualityWarn: 80,
    qualityCritical: 65,
  },
};

function inferProfileFromScenario(scenario: string | null | undefined): CprProfile {
  const normalized = scenario?.trim().toLowerCase() ?? "";
  if (normalized.includes("pediatric") || normalized.includes("child") || normalized.includes("infant") || normalized.includes("neonate") || normalized.includes("baby")) {
    return "pediatric";
  }
  return "adult";
}

function monitorPalette(level: MonitorLevel): { border: string; background: string; label: string; value: string } {
  switch (level) {
    case "good":
      return {
        border: "#22c55e",
        background: "rgba(34, 197, 94, 0.18)",
        label: "#bbf7d0",
        value: "#f0fdf4",
      };
    case "warn":
      return {
        border: "#f59e0b",
        background: "rgba(245, 158, 11, 0.2)",
        label: "#fde68a",
        value: "#fffbeb",
      };
    case "critical":
      return {
        border: "#ef4444",
        background: "rgba(239, 68, 68, 0.2)",
        label: "#fecaca",
        value: "#fef2f2",
      };
    default:
      return {
        border: "#64748b",
        background: "rgba(100, 116, 139, 0.18)",
        label: "#cbd5e1",
        value: "#f8fafc",
      };
  }
}

function depthLevel(value: number | null, profile: CprProfile): MonitorLevel {
  const thresholds = CPR_THRESHOLDS[profile];
  if (value === null) {
    return "neutral";
  }
  if (value < thresholds.depthCritical[0] || value > thresholds.depthCritical[1]) {
    return "critical";
  }
  if (value < thresholds.depthTarget[0] || value > thresholds.depthTarget[1]) {
    return "warn";
  }
  return "good";
}

function rateLevel(value: number | null, profile: CprProfile): MonitorLevel {
  const thresholds = CPR_THRESHOLDS[profile];
  if (value === null) {
    return "neutral";
  }
  if (value < thresholds.rateCritical[0] || value > thresholds.rateCritical[1]) {
    return "critical";
  }
  if (value < thresholds.rateTarget[0] || value > thresholds.rateTarget[1]) {
    return "warn";
  }
  return "good";
}

function pauseLevel(value: number | null, profile: CprProfile): MonitorLevel {
  const thresholds = CPR_THRESHOLDS[profile];
  if (value === null) {
    return "neutral";
  }
  if (value > thresholds.pauseCritical) {
    return "critical";
  }
  if (value > thresholds.pauseWarn) {
    return "warn";
  }
  return "good";
}

function recoilLevel(value: boolean | null): MonitorLevel {
  if (value === null) {
    return "neutral";
  }
  return value ? "good" : "critical";
}

function qualityLevel(value: number | null, profile: CprProfile): MonitorLevel {
  const thresholds = CPR_THRESHOLDS[profile];
  if (value === null) {
    return "neutral";
  }
  if (value < thresholds.qualityCritical) {
    return "critical";
  }
  if (value < thresholds.qualityWarn) {
    return "warn";
  }
  return "good";
}

function Sparkline({
  values,
  color,
  label,
}: {
  values: Array<number | null>;
  label: string;
  color: string;
}) {
  const width = 420;
  const height = 110;
  const padding = 10;

  const numeric = values.filter((value): value is number => value !== null && Number.isFinite(value));

  if (numeric.length === 0) {
    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#f8fafc" }}>
        <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>{label}</p>
        <div style={{ fontSize: "0.82rem", color: "#64748b" }}>No live values yet</div>
      </div>
    );
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const span = Math.max(1, max - min);
  const step = values.length <= 1 ? 0 : (width - padding * 2) / (values.length - 1);

  let hasPoint = false;
  let path = "";

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null || !Number.isFinite(value)) {
      continue;
    }

    const x = padding + index * step;
    const normalized = (value - min) / span;
    const y = height - padding - normalized * (height - padding * 2);
    path += `${hasPoint ? " L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    hasPoint = true;
  }

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px", gap: "8px" }}>
        <p style={{ margin: 0, fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>{label}</p>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748b" }}>min {min.toFixed(1)} / max {max.toFixed(1)}</p>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ display: "block", height: "110px" }}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
        {path ? <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </svg>
    </div>
  );
}

function RecoilTimeline({ values }: { values: Array<boolean | null> }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#ffffff" }}>
      <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 600 }}>Recoil Timeline</p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, values.length)}, minmax(0, 1fr))`, gap: "3px" }}>
        {values.map((value, index) => (
          <div
            key={`recoil-${index}`}
            style={{
              height: "12px",
              borderRadius: "3px",
              background: value === null ? "#cbd5e1" : value ? "#22c55e" : "#ef4444",
            }}
            title={value === null ? "No sample" : value ? "Recoil OK" : "Recoil Not OK"}
          />
        ))}
      </div>
      <p style={{ margin: "8px 0 0 0", fontSize: "0.76rem", color: "#64748b" }}>Green = OK, Red = Not OK, Gray = no sample</p>
    </div>
  );
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

function liveStreamStateFromConnection(state: string): LiveStreamState {
  if (state === "MQTT_WS_LIVE" || state === "BACKEND_SSE_FALLBACK" || state === "BACKEND_POLLING_DEGRADED") {
    return "connected";
  }
  if (state === "ERROR" || state === "OFFLINE") {
    return "unavailable";
  }
  if (state === "STALE") {
    return "reconnecting";
  }
  return "connecting";
}

function WaitingSessionStory() {
  const [tipIndex, setTipIndex] = useState(0);
  const [placeholderSeconds, setPlaceholderSeconds] = useState(3);

  useEffect(() => {
    const tipTimer = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % WAITING_SESSION_TIPS.length);
    }, 10000);

    const countdownTimer = window.setInterval(() => {
      setPlaceholderSeconds((current) => (current === 1 ? 3 : current - 1));
    }, 1300);

    return () => {
      window.clearInterval(tipTimer);
      window.clearInterval(countdownTimer);
    };
  }, []);

  return (
    <section className="waiting-session-story" aria-label="Waiting for session">
      <div className="waiting-session-story__hero">
        <div className="waiting-session-story__ring-shell" aria-hidden="true">
          <span className="waiting-session-story__ring waiting-session-story__ring--outer" />
          <span className="waiting-session-story__ring waiting-session-story__ring--inner" />
          <span className="waiting-session-story__ring waiting-session-story__ring--core" />
          <span className="waiting-session-story__glow" />
          <span className="waiting-session-story__pulse" />
          <div className="waiting-session-story__manikin">
            <RadarManikin sweep size={92} />
          </div>
        </div>

        <div className="waiting-session-story__headline-block">
          <p className="waiting-session-story__eyebrow">Waiting for session</p>
          <h3 className="waiting-session-story__title">Awaiting instructor assignment</h3>
          <div className="waiting-session-story__countdown" aria-label="Assignment placeholder">
            <span className="waiting-session-story__countdown-label">Next handoff</span>
            <span className="waiting-session-story__countdown-value">
              <CounterFlip value={placeholderSeconds} />
              <span>sec</span>
            </span>
          </div>
        </div>
      </div>

      <div className="waiting-session-story__details">
        <div className="waiting-session-story__arrow" aria-hidden="true">
          <svg viewBox="0 0 88 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12C36 12 44 22 44 34V44" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 7" />
            <path d="M30 36L44 50L58 36" stroke="#1d4ed8" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Details will anchor here</span>
        </div>

        <div className="waiting-session-story__slot" aria-hidden="true">
          <div className="waiting-session-story__slot-header">
            <span className="waiting-session-story__slot-kicker">Session panel</span>
            <span className="waiting-session-story__slot-status">Idle</span>
          </div>
          <div className="waiting-session-story__slot-lines">
            <span />
            <span />
            <span className="waiting-session-story__slot-lines--short" />
          </div>
        </div>
      </div>

      <div className="waiting-session-story__tip-carousel" aria-live="polite">
        <p className="waiting-session-story__tip-label">Helpful tip</p>
        <p className="waiting-session-story__tip-copy">{WAITING_SESSION_TIPS[tipIndex]}</p>
        <div className="waiting-session-story__tip-dots" aria-hidden="true">
          {WAITING_SESSION_TIPS.map((tip, index) => (
            <span
              key={tip}
              className={`waiting-session-story__tip-dot ${index === tipIndex ? "waiting-session-story__tip-dot--active" : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function TraineeDashboard({
  embeddedInDesktop = false,
  initialSessionId = null,
}: TraineeDashboardProps) {
  const { currentUser, logout } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionLiveView | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sensorHistory, setSensorHistory] = useState<SensorPoint[]>([]);
  const [cprProfile, setCprProfile] = useState<CprProfile>("adult");
  const liveState = useLiveSession({
    deviceId: session?.deviceId,
    sessionId,
    enabled: Boolean(sessionId && session?.deviceId && session.active),
  });
  const streamState = liveStreamStateFromConnection(liveState.connectionState);
  const streamMessage = liveState.error ?? liveState.message ?? null;

  useEffect(() => {
    if (initialSessionId && initialSessionId.trim().length > 0) {
      setSessionId(initialSessionId.trim());
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const currentSessionId = params.get("sessionId");
    setSessionId(currentSessionId && currentSessionId.trim().length > 0 ? currentSessionId.trim() : null);
  }, [initialSessionId]);

  useEffect(() => {
    setSensorHistory([]);
  }, [sessionId]);

  useEffect(() => {
    setCprProfile(inferProfileFromScenario(session?.scenario));
  }, [session?.scenario]);



  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setSessionLoading(false);
      setSessionError(null);
      return;
    }

    const activeSessionId = sessionId;
    let isActive = true;

    async function loadSession() {
      try {
        const live = await fetchSessionLive(activeSessionId);
        if (!isActive) {
          return;
        }
        setSession(live);
        setSessionError(null);
      } catch (error) {
        if (!isActive) {
          return;
        }
        setSession(null);
        setSessionError(error instanceof Error ? error.message : "Failed to load session live data.");
      } finally {
        if (isActive) {
          setSessionLoading(false);
        }
      }
    }

    loadSession();

    return () => {
      isActive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    const metric = liveState.latestMetric;
    if (!metric) {
      return;
    }

    setSensorHistory((previous) => [
      ...previous,
      {
        ts: Date.now(),
        depthMm: metric.depthMm,
        rateCpm: metric.rateCpm,
        pauseS: metric.pauseS,
        recoilOk: metric.recoilOk,
        flags: Array.isArray(metric.flags) ? metric.flags.join(", ") : metric.flags,
      },
    ].slice(-MAX_SENSOR_POINTS));
  }, [
    liveState.latestMetric?.seq,
    liveState.latestMetric?.timestamp,
    liveState.latestMetric?.tsMs,
    liveState.latestMetric?.compressionCount,
  ]);

  function metric(value: number | null, suffix: string): string {
    if (value === null || value === undefined) {
      return "-";
    }

    return `${value.toFixed(1)} ${suffix}`;
  }

  function formatTime(value: string | null): string {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleTimeString();
  }

  function navigateToInstructorDashboard() {
    window.location.assign("/instructor");
  }

  function navigateToDesktopHome() {
    window.location.assign("/");
  }

  const depthSeries = sensorHistory.map((point) => point.depthMm);
  const rateSeries = sensorHistory.map((point) => point.rateCpm);
  const pauseSeries = sensorHistory.map((point) => point.pauseS);
  const recoilSeries = sensorHistory.map((point) => point.recoilOk);
  const force1Series = sensorHistory.map(() => session?.latestForce1 ?? null);
  const force2Series = sensorHistory.map(() => session?.latestForce2 ?? null);
  const balanceSeries = sensorHistory.map(() => session?.pressureBalancePct ?? null);
  const latestBalance = session?.pressureBalancePct ?? null;
  const latestSkewed = session?.pressureSkewed ?? null;
  const liveDepth = liveState.latestMetric?.depthMm ?? session?.latestDepthMm ?? null;
  const liveRate = liveState.latestMetric?.rateCpm ?? session?.latestRateCpm ?? null;
  const livePause = liveState.latestMetric?.pauseS ?? session?.latestPauseS ?? null;
  const liveRecoil = liveState.latestMetric?.recoilOk ?? session?.latestRecoilOk ?? null;
  const liveForceA = session?.latestForce1 ?? null;
  const liveForceB = session?.latestForce2 ?? null;
  const liveOnline = session?.online ?? null;
  const compressionTotal = liveState.latestMetric?.compressionCount ?? null;
  const compressionValid = liveState.latestMetric?.validCompressionCount ?? null;
  const compressionQuality = compressionTotal && compressionTotal > 0 && compressionValid !== null
    ? Math.round((compressionValid / compressionTotal) * 100)
    : null;
  const thresholds = CPR_THRESHOLDS[cprProfile];
  const depthStatus = depthLevel(liveDepth, cprProfile);
  const rateStatus = rateLevel(liveRate, cprProfile);
  const pauseStatus = pauseLevel(livePause, cprProfile);
  const recoilStatus = recoilLevel(liveRecoil);
  const qualityStatus = qualityLevel(compressionQuality, cprProfile);
  const pressureStatus: MonitorLevel = latestSkewed === null ? "neutral" : latestSkewed ? "warn" : "good";
  const deviceStatus: MonitorLevel = liveOnline === null ? "neutral" : liveOnline ? "good" : "critical";
  const overallLevel: MonitorLevel = [deviceStatus, recoilStatus, depthStatus, rateStatus, pauseStatus, qualityStatus].includes("critical")
    ? "critical"
    : [deviceStatus, recoilStatus, depthStatus, rateStatus, pauseStatus, qualityStatus].includes("warn")
      ? "warn"
      : [deviceStatus, recoilStatus, depthStatus, rateStatus, pauseStatus, qualityStatus].includes("good")
        ? "good"
        : "neutral";

  const coachingCue =
    deviceStatus === "critical" ? "Device offline. Reconnect to continue live coaching." :
    recoilStatus === "critical" ? "Release chest fully between compressions." :
    depthStatus === "critical" ? `Adjust depth now. Target range is ${thresholds.depthTarget[0]}-${thresholds.depthTarget[1]} mm.` :
    rateStatus === "critical" ? `Adjust pace now. Target range is ${thresholds.rateTarget[0]}-${thresholds.rateTarget[1]} cpm.` :
    pauseStatus === "critical" ? `Reduce pauses. Keep interruptions under ${thresholds.pauseWarn.toFixed(1)} s.` :
    qualityStatus === "critical" ? "Compression quality is low. Focus on depth, rate, recoil." :
    depthStatus === "warn" || rateStatus === "warn" || pauseStatus === "warn" || qualityStatus === "warn" || pressureStatus === "warn"
      ? "Close to target. Keep compressions steady and controlled."
      : "Great form. Maintain this CPR quality.";
  const recentFeedback = useMemo(() => {
    const out: Array<{ text: string; ts: number }> = [];
    const max = 10;
    for (let i = sensorHistory.length - 1; i >= 0 && out.length < max; i -= 1) {
      const point = sensorHistory[i];
      if (!point.flags) continue;
      const parts = String(point.flags).split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        out.push({ text: p, ts: point.ts });
        if (out.length >= max) break;
      }
    }
    return out;
  }, [sensorHistory]);

  function parseFlagText(flag: string) {
    const raw = String(flag || "");
    const normalized = raw.trim().toLowerCase().replace(/[_\-]+/g, " ");
    const label = raw.replace(/_/g, " ");

    if (normalized === "depth ok" || normalized === "hand placement centre" || normalized === "hand placement center" || normalized === "rate ok" || normalized === "recoil ok") {
      return { label, status: "good", icon: "✅" };
    }

    if (
      normalized.includes("depth shallow") ||
      normalized.includes("depth deep") ||
      normalized.includes("rate slow") ||
      normalized.includes("rate fast") ||
      normalized.includes("incomplete recoil") ||
      normalized.includes("hand placement")
    ) {
      return { label, status: "warn", icon: "⚠️" };
    }

    if (normalized.includes("pause long") || normalized.includes("error") || normalized.includes("fail")) {
      return { label, status: "critical", icon: "🛑" };
    }

    // fallback: treat clear *_ok patterns as good
    if (/\b(ok|okay|good)\b/.test(normalized)) {
      return { label, status: "good", icon: "✅" };
    }

    return { label, status: "warn", icon: "⚠️" };
  }

  function timeAgo(ts: number) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  }

  function RecentFeedback({ items }: { items: Array<{ text: string; ts: number }> }) {
    const [reducedMotion, setReducedMotion] = useState(false);
    const [darkMode, setDarkMode] = useState(false);

    useEffect(() => {
      if (typeof window === "undefined") return;
      const rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
      const dm = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      setReducedMotion(Boolean(rm && rm.matches));
      setDarkMode(Boolean(dm && dm.matches));
      const onRm = (e: any) => setReducedMotion(Boolean(e.matches));
      const onDm = (e: any) => setDarkMode(Boolean(e.matches));
      rm && rm.addEventListener && rm.addEventListener("change", onRm);
      dm && dm.addEventListener && dm.addEventListener("change", onDm);
      return () => {
        rm && rm.removeEventListener && rm.removeEventListener("change", onRm);
        dm && dm.removeEventListener && dm.removeEventListener("change", onDm);
      };
    }, []);

    const containerStyle: React.CSSProperties = {
      maxHeight: 200,
      overflowY: "auto",
      padding: 8,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      background: darkMode ? "#0b1220" : "#f8fafc",
      borderRadius: 10,
      border: darkMode ? "1px solid #1f2937" : "1px solid #e6eef6",
    };

    const styleSheet = `
      @keyframes slideInFromTop { from { transform: translateY(-6px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      @keyframes flashPulse { 0% { box-shadow: 0 0 0 rgba(0,0,0,0) } 50% { box-shadow: 0 6px 18px rgba(2,6,23,0.06) } 100% { box-shadow: 0 0 0 rgba(0,0,0,0) } }
    `;

    return (
      <div aria-live="polite" aria-atomic="false" role="list" style={containerStyle}>
        <style>{styleSheet}</style>
        {items.length === 0 ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, color: darkMode ? "#9ca3af" : "#64748b" }}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>💬</span>
            <div>
              <div style={{ fontWeight: 700, color: darkMode ? "#e6eef6" : "#334155" }}>Feedback will appear here during session</div>
              <div style={{ fontSize: 12 }}>{"Live feedback and flags are shown as they arrive."}</div>
            </div>
          </div>
        ) : (
          items.map((it, idx) => {
            const parsed = parseFlagText(it.text);
            const isGood = parsed.status === "good";
            const isWarn = parsed.status === "warn";
            const isCrit = parsed.status === "critical";
            const bg = darkMode
              ? isGood ? "#064e3b" : isWarn ? "#78350f" : "#7f1d1d"
              : isGood ? "#ecfdf5" : isWarn ? "#fffbeb" : "#fee2e2";
            const color = darkMode
              ? isGood ? "#86efac" : isWarn ? "#f59e0b" : "#fee2e2"
              : isGood ? "#065f46" : isWarn ? "#92400e" : "#991b1b";
            const animStyle: React.CSSProperties = reducedMotion
              ? {}
              : { animation: `slideInFromTop 260ms ease ${idx * 40}ms both` };

            return (
              <div key={`fb-${it.ts}-${idx}`} role="listitem" style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, borderRadius: 8, background: bg, border: `1px solid ${darkMode ? "#0f172a" : "#e6eef6"}`, ...animStyle }}>
                <span aria-hidden="true" style={{ fontSize: 18 }}>{parsed.icon}</span>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color, fontSize: "0.9rem", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{parsed.label}</div>
                  <div style={{ fontSize: 12, color: darkMode ? "#9ca3af" : "#64748b" }}>{timeAgo(it.ts)}</div>
                </div>
                <div style={{ marginLeft: "auto", fontSize: 12, color: darkMode ? "#9ca3af" : "#64748b" }}>{/* reserved for future severity */}</div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <h1 style={styles.title}>Trainee Dashboard</h1>
            <p style={styles.subtitle}>
              Assigned manikin live performance for one active session
            </p>
          </div>

          {!embeddedInDesktop ? (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {currentUser?.role !== "TRAINEE" ? (
                <button
                  type="button"
                  onClick={navigateToInstructorDashboard}
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
                  Back To Instructor
                </button>
              ) : null}
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
            </div>
          ) : null}
        </div>
      </header>

      <div style={styles.content}>


        {/* Session Details Card - Only when sessionId exists and loading or session data available */}
        {sessionId && (sessionLoading || !sessionError) && (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Session Details</h2>
            {sessionLoading ? (
              <div style={{ background: "#f1f5f9", borderRadius: "8px", padding: "12px", minHeight: "80px", display: "flex", alignItems: "center", color: "#64748b" }}>
                Loading session details...
              </div>
            ) : session ? (
              <div style={{ display: "grid", gap: "8px" }}>
                <div>
                  <p style={{ margin: "0 0 4px 0", fontSize: "0.75rem", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>SCENARIO</p>
                  <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#081026" }}>
                    {session.scenario || "No scenario assigned"}
                  </p>
                </div>
                <div>
                  <p style={{ margin: "0 0 4px 0", fontSize: "0.75rem", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>MANIKIN</p>
                  <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#081026" }}>
                    {session.deviceId}
                  </p>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* Live Vitals Card - Only when sessionId exists */}
        {sessionId && (
          <>
            {sessionError ? (
              <section style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Vitals</h2>
                  <LiveStreamStatusBadge state={streamState} />
                </div>
                <div style={{ padding: "20px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <p style={{ margin: 0, color: "#991b1b", fontSize: "0.92rem" }}>
                    {sessionError}
                  </p>
                  {streamMessage ? (
                    <p style={{ margin: "8px 0 0 0", color: "#b45309", fontSize: "0.86rem" }}>
                      {streamMessage}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : !session ? (
              <section style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Vitals</h2>
                  <LiveStreamStatusBadge state={streamState} />
                </div>
                <div style={{ padding: "20px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <p style={{ margin: 0, color: "#475569", fontSize: "0.92rem" }}>
                    Session {sessionId} is no longer active.
                  </p>
                  {streamMessage ? (
                    <p style={{ margin: "8px 0 0 0", color: "#b45309", fontSize: "0.86rem" }}>
                      {streamMessage}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : (
              <section style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Live Vitals</h2>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <LiveStreamStatusBadge state={streamState} />
                    <SessionStatusBadge active={Boolean(session?.active)} />
                  </div>
                </div>
                {streamMessage ? (
                  <p style={{ margin: "0 0 8px 0", color: "#b45309", fontSize: "0.86rem" }}>
                    {streamMessage}
                  </p>
                ) : null}
                <div>
                  <div
                    style={{
                      borderRadius: "14px",
                      border: "1px solid #0f172a",
                      background: "radial-gradient(circle at 15% 20%, #10323a 0%, #0b1324 45%, #040812 100%)",
                      padding: "14px",
                      boxShadow: "0 14px 32px rgba(2, 6, 23, 0.35)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
                      <h3 style={{ margin: 0, fontSize: "1.02rem", fontWeight: 700, color: "#dbeafe", letterSpacing: "0.02em" }}>
                        CPR Performance Monitor
                      </h3>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <div style={{ display: "inline-flex", border: "1px solid #334155", borderRadius: "999px", overflow: "hidden" }}>
                          <button
                            type="button"
                            onClick={() => setCprProfile("adult")}
                            style={{
                              border: "none",
                              padding: "4px 10px",
                              background: cprProfile === "adult" ? "#22c55e" : "#0f172a",
                              color: "#f8fafc",
                              fontSize: "0.74rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Adult
                          </button>
                          <button
                            type="button"
                            onClick={() => setCprProfile("pediatric")}
                            style={{
                              border: "none",
                              padding: "4px 10px",
                              background: cprProfile === "pediatric" ? "#22c55e" : "#0f172a",
                              color: "#f8fafc",
                              fontSize: "0.74rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Pediatric
                          </button>
                        </div>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: "999px",
                            fontSize: "0.76rem",
                            fontWeight: 700,
                            background: overallLevel === "critical" ? "#ef4444" : overallLevel === "warn" ? "#f59e0b" : "#16a34a",
                            color: "#f8fafc",
                          }}
                        >
                          {overallLevel === "critical" ? "Act Now" : overallLevel === "warn" ? "Adjust" : "On Target"}
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: "0 0 10px 0", fontSize: "0.84rem", color: "#e2e8f0", fontWeight: 600 }}>
                      {coachingCue}
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(depthStatus).border}`, background: monitorPalette(depthStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(depthStatus).label, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>Depth</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(depthStatus).value, fontSize: "1.6rem", fontWeight: 800 }}>{metric(liveDepth, "mm")}</p>
                      </div>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(rateStatus).border}`, background: monitorPalette(rateStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(rateStatus).label, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>Rate</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(rateStatus).value, fontSize: "1.6rem", fontWeight: 800 }}>{metric(liveRate, "cpm")}</p>
                      </div>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(pauseStatus).border}`, background: monitorPalette(pauseStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(pauseStatus).label, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>Pause</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(pauseStatus).value, fontSize: "1.6rem", fontWeight: 800 }}>{metric(livePause, "s")}</p>
                      </div>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(recoilStatus).border}`, background: monitorPalette(recoilStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(recoilStatus).label, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>Recoil</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(recoilStatus).value, fontSize: "1.6rem", fontWeight: 800 }}>{liveRecoil === null ? "-" : liveRecoil ? "OK" : "Fix"}</p>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "8px" }}>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(pressureStatus).border}`, background: monitorPalette(pressureStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(pressureStatus).label, fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Pressure Balance</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(pressureStatus).value, fontSize: "1.05rem", fontWeight: 700 }}>{latestBalance === null ? "-" : `${latestBalance.toFixed(1)} %`}</p>
                      </div>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(pressureStatus).border}`, background: monitorPalette(pressureStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(pressureStatus).label, fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Pressure State</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(pressureStatus).value, fontSize: "1.05rem", fontWeight: 700 }}>
                          {latestSkewed === null ? "-" : latestSkewed ? "Skewed" : "Even"}
                        </p>
                      </div>
                      <div style={{ borderRadius: "10px", border: "1px solid #334155", background: "rgba(15, 23, 42, 0.55)", padding: "10px" }}>
                        <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Force A / B</p>
                        <p style={{ margin: "4px 0 0 0", color: "#f8fafc", fontSize: "1.05rem", fontWeight: 700 }}>
                          {liveForceA === null || liveForceB === null ? "-" : `${liveForceA} / ${liveForceB}`}
                        </p>
                      </div>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(qualityStatus).border}`, background: monitorPalette(qualityStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(qualityStatus).label, fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Compression Quality</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(qualityStatus).value, fontSize: "1.05rem", fontWeight: 700 }}>
                          {compressionQuality === null ? "-" : `${compressionQuality}%`}
                        </p>
                      </div>
                      <div style={{ borderRadius: "10px", border: `1px solid ${monitorPalette(deviceStatus).border}`, background: monitorPalette(deviceStatus).background, padding: "10px" }}>
                        <p style={{ margin: 0, color: monitorPalette(deviceStatus).label, fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Device</p>
                        <p style={{ margin: "4px 0 0 0", color: monitorPalette(deviceStatus).value, fontSize: "1.05rem", fontWeight: 700 }}>
                          {liveOnline === null ? "-" : liveOnline ? "Online" : "Offline"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: "10px", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#f8fafc" }}>
                      <p style={{ margin: "0 0 6px 0", fontSize: "0.84rem", color: "#334155", fontWeight: 700 }}>Recent Flags & Feedback</p>
                      <RecentFeedback items={recentFeedback} />
                  </div>
                    <ChartsSection
                      depthSeries={depthSeries}
                      rateSeries={rateSeries}
                      pauseSeries={pauseSeries}
                      recoilSeries={recoilSeries}
                      pressureValue={session?.pressureBalancePct ?? null}
                      validCompressions={liveState.latestMetric?.validCompressionCount ?? null}
                      totalCompressions={liveState.latestMetric?.compressionCount ?? null}
                    />
                </div>
              </section>
            )}
          </>
        )}

        {/* Waiting for Session - Only when no sessionId */}
        {!sessionId && (
          <section style={styles.card}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>No Active Session</h2>
            <div style={{ padding: "20px", borderRadius: "8px", background: "#f8fafc", border: "1px dashed #cbd5e1" }}>
              <p style={{ margin: 0, color: "#64748b", fontSize: "0.92rem" }}>
                No active session selected yet.
              </p>
              <p style={{ margin: "8px 0 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>
                Open a trainee link like /trainee?sessionId=&lt;id&gt; from the instructor dashboard.
              </p>
            </div>
            <WaitingSessionStory />
          </section>
        )}

        <CoursesPanel role={currentUser?.role ?? "TRAINEE"} />
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

/* Charts and helpers */
function ChartsSection({
  depthSeries,
  rateSeries,
  pauseSeries,
  recoilSeries,
  pressureValue,
  validCompressions,
  totalCompressions,
}: {
  depthSeries: Array<number | null>;
  rateSeries: Array<number | null>;
  pauseSeries: Array<number | null>;
  recoilSeries: Array<boolean | null>;
  pressureValue: number | null;
  validCompressions: number | null;
  totalCompressions: number | null;
}) {
  const depthData = useMemo(() => {
    return depthSeries.slice(-20).map((v, i) => ({ x: i, value: v ?? null }));
  }, [depthSeries]);

  const rateData = useMemo(() => rateSeries.slice(-20).map((v, i) => ({ x: i, value: v ?? null })), [rateSeries]);

  const pauseData = useMemo(() => pauseSeries.slice(-15).map((v, i) => ({ x: i, value: v ?? null })), [pauseSeries]);

  const recoilCounts = useMemo(() => {
    const good = recoilSeries.filter((v) => v === true).length;
    const bad = recoilSeries.filter((v) => v === false).length;
    return { good, bad };
  }, [recoilSeries]);

  function summarizeSeries(values: Array<number | null>, unit: string): string {
    const numeric = values.filter((value): value is number => value !== null && Number.isFinite(value));
    if (numeric.length === 0) {
      return `Current - ${unit} | Min - | Max -`;
    }

    const current = numeric[numeric.length - 1];
    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    return `Current ${current.toFixed(1)} ${unit} | Min ${min.toFixed(1)} | Max ${max.toFixed(1)}`;
  }

  const depthSummary = summarizeSeries(depthSeries, "mm");
  const rateSummary = summarizeSeries(rateSeries, "cpm");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px", marginTop: "12px" }}>
      <Box title="Depth Trend" subtitle={depthSummary} accentColor="#0369a1">
        <DepthAreaChart data={depthData} />
      </Box>
      <Box title="Rate Trend" subtitle={rateSummary} accentColor="#166534">
        <RateLineChart data={rateData} />
      </Box>
      <Box title="Pause Pattern">
        <PauseBarChart data={pauseData} />
      </Box>
      <Box title="Recoil Quality">
        <RecoilDonut good={recoilCounts.good} bad={recoilCounts.bad} />
      </Box>
      <Box title="Pressure Balance">
        <PressureBalanceGauge value={pressureValue} />
      </Box>
      <Box title="Compression Quality">
        <CompressionQualityRing valid={validCompressions} total={totalCompressions} />
      </Box>
    </div>
  );
}

function Box({
  title,
  subtitle,
  accentColor,
  children,
}: {
  title: string;
  subtitle?: string;
  accentColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderRadius: 10, background: "#f3f4f6", padding: 10 }}>
      <p style={{ margin: "0 0 8px 0", fontSize: "0.85rem", fontWeight: 700, color: "#0f172a" }}>{title}</p>
      {subtitle ? (
        <p
          style={{
            margin: "0 0 8px 0",
            padding: "5px 8px",
            borderRadius: 7,
            fontSize: "0.78rem",
            fontWeight: 700,
            color: accentColor ?? "#334155",
            background: "#ffffff",
            border: `1px solid ${accentColor ? `${accentColor}33` : "#e2e8f0"}`,
          }}
        >
          {subtitle}
        </p>
      ) : null}
      <div style={{ height: 150 }}>{children}</div>
    </div>
  );
}

function DepthAreaChart({ data }: { data: Array<{ x: number; value: number | null }> }) {
  const chartData = data.map((d) => ({ ...d, value: d.value ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" opacity={0.65} />
        <XAxis dataKey="x" hide />
        <YAxis domain={[35, 70]} hide={true} width={30} tickLine={false} axisLine={false} />
        <ReferenceArea {...({ y1: 50, y2: 60, fill: "#dbeafe", fillOpacity: 0.5 } as any)} />
        <ReferenceLine y={50} stroke="#0ea5e9" strokeDasharray="4 4" strokeWidth={1.5} />
        <ReferenceLine y={60} stroke="#0ea5e9" strokeDasharray="4 4" strokeWidth={1.5} />
        <Tooltip
          cursor={{ stroke: "#38bdf8", strokeWidth: 1, strokeDasharray: "3 3" }}
          contentStyle={{ borderRadius: 8, border: "1px solid #bae6fd", background: "#082f49", color: "#e0f2fe", fontSize: 12, fontWeight: 700 }}
          formatter={(value: any) => [`${Number(value).toFixed(1)} mm`, "Depth"]}
          labelFormatter={() => "Live"}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={10}>
          {chartData.map((entry, index) => {
            const v = entry.value;
            const color = v >= 50 && v <= 60 ? "#0ea5e9" : v >= 45 && v <= 65 ? "#f59e0b" : "#ef4444";
            return <Cell key={`depth-cell-${index}`} fill={color} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function RateLineChart({ data }: { data: Array<{ x: number; value: number | null }> }) {
  const chartData = data.map((d) => ({ ...d, value: d.value ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <filter id="rateGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#22c55e" floodOpacity="0.65" />
          </filter>
          <linearGradient id="rateStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#dcfce7" opacity={0.7} />
        <XAxis dataKey="x" hide />
        <YAxis domain={[80, 140]} hide={true} width={30} tickLine={false} axisLine={false} />
        <ReferenceArea {...({ y1: 100, y2: 120, fill: "#bbf7d0", fillOpacity: 0.55 } as any)} />
        <ReferenceLine y={100} stroke="#16a34a" strokeDasharray="4 4" strokeWidth={1.5} />
        <ReferenceLine y={120} stroke="#16a34a" strokeDasharray="4 4" strokeWidth={1.5} />
        <Tooltip
          cursor={{ stroke: "#22c55e", strokeWidth: 1, strokeDasharray: "3 3" }}
          contentStyle={{ borderRadius: 8, border: "1px solid #86efac", background: "#052e16", color: "#dcfce7", fontSize: 12, fontWeight: 700 }}
          formatter={(value: any) => [`${Number(value).toFixed(1)} cpm`, "Rate"]}
          labelFormatter={() => "Live"}
        />
        <Line
          type="stepAfter"
          dataKey="value"
          stroke="url(#rateStroke)"
          strokeWidth={3}
          activeDot={{ r: 5, stroke: "#dcfce7", strokeWidth: 2, fill: "#16a34a" }}
          dot={(props: any) => {
            const { cx, cy, index, payload } = props;
            const value = Number(payload?.value ?? 0);
            const fill = value >= 100 && value <= 120 ? "#16a34a" : "#ef4444";
            return index !== chartData.length - 1 ? (
              <circle cx={cx} cy={cy} r={0} fill="transparent" stroke="transparent" />
            ) : (
              <circle cx={cx} cy={cy} r={4} stroke="#ecfdf5" strokeWidth={1.5} fill={fill} />
            );
          }}
          style={{ filter: "url(#rateGlow)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PauseBarChart({ data }: { data: Array<{ x: number; value: number | null }> }) {
  const chartData = data.map((d) => ({ ...d, value: d.value ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <Bar dataKey="value">
          {chartData.map((entry, index) => {
            const v = entry.value;
            const color = v > 10 ? "#dc2626" : v >= 5 ? "#f59e0b" : "#10b981";
            return <Cell key={`cell-${index}`} fill={color} />;
          })}
        </Bar>
        <Tooltip />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RecoilDonut({ good, bad }: { good: number; bad: number }) {
  const total = good + bad || 1;
  const percent = Math.round((good / total) * 100);
  const data = [
    { name: "Good", value: good },
    { name: "Incomplete", value: bad },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="60%" outerRadius="80%" startAngle={90} endAngle={-270}>
            <Cell key="cell-good" fill="#16a34a" />
            <Cell key="cell-bad" fill="#f59e0b" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "relative", left: "-60%", fontWeight: 700, color: "#0f172a" }}>{percent}% good</div>
    </div>
  );
}

function PressureBalanceGauge({ value, skewed }: { value: number | null; skewed?: boolean | null }) {
  const display = value === null ? "-" : `${value.toFixed(1)}%`;
  const position = value === null ? 50 : Math.max(0, Math.min(100, (value + 100) / 2));
  const centerGreenMin = 40; // maps to -20
  const centerGreenMax = 60; // maps to +20
  const isOk = position >= centerGreenMin && position <= centerGreenMax;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: "0.84rem", fontWeight: 700, color: "#0f172a" }}>Balance: {display}</div>
      <div style={{ position: "relative", width: 220, height: 18, background: "#e6eef6", borderRadius: 8 }}>
        <div style={{ position: "absolute", left: `${centerGreenMin}%`, right: `${100 - centerGreenMax}%`, top: 0, bottom: 0, background: "#d1fae5", borderRadius: 8 }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${position}%`, background: isOk ? "#60a5fa" : "#fca5a5", borderRadius: 8, opacity: 0.18 }} />
        <div style={{ position: "absolute", left: `${position}%`, top: -6, width: 2, height: 30, background: "#0f172a", transform: "translateX(-50%)" }} />
      </div>
    </div>
  );
}

function CompressionQualityRing({ valid, total }: { valid: number | null; total: number | null }) {
  if (!total || total === 0 || valid === null) {
    return <div style={{ color: "#64748b" }}>Waiting for data...</div>;
  }
  const pct = Math.round((valid / total) * 100);
  const radius = 28;
  const stroke = 6;
  const normalized = pct / 100;
  const dash = 2 * Math.PI * radius;
  const offset = dash * (1 - normalized);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={radius * 2} height={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`}>
        <circle cx={radius} cy={radius} r={radius} stroke="#e5e7eb" strokeWidth={stroke} fill="none" />
        <circle cx={radius} cy={radius} r={radius} stroke="#16a34a" strokeWidth={stroke} fill="none" strokeDasharray={`${dash} ${dash}`} strokeDashoffset={offset} transform={`rotate(-90 ${radius} ${radius})`} strokeLinecap="round" />
      </svg>
      <div style={{ fontWeight: 700, color: "#0f172a" }}>{pct}%</div>
    </div>
  );
}