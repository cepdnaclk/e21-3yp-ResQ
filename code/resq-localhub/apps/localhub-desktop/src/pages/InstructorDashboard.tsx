import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { useOptionalAuth } from "../auth/AuthContext";
import { useLiveSession } from "../hooks/useLiveSession";
import { MANUAL_LAN_IP_STORAGE_KEY, sanitizeManualLanIp } from "../lib/accessHost";
import { generateAccessUrls } from "../lib/accessUrls";
import {
  fetchLiveManikins,
  getLiveManikinsStreamUrl,
  type ManikinLiveSummary,
} from "../lib/browserManikinsApi";
import {
  fetchTrainees,
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
  getDefaultCalibrationProfile,
  getCalibrationProfiles,
  type FirmwareCalibrationStartPayload,
  type FirmwareReadinessResponse,
} from "../lib/browserFirmwareApi";
import { CalibrationSettingsPanel } from "../components/CalibrationSettingsPanel";
import { LocalSessionReviewPanel } from "../components/LocalSessionReviewPanel";
import { QRCodeSVG as QR } from "qrcode.react";
import { Card, Button, Badge, Progress, Input, Select } from "../components/ui";
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Wifi,
  WifiOff,
  Settings,
  Play,
  Square,
  QrCode,
  Users,
  ChevronDown,
  ChevronRight,
  Info,
  CircleDot
} from "lucide-react";
import ProvisioningIcon from "../components/icons/ProvisioningIcon";
import DeviceRegistryIcon from "../components/icons/DeviceRegistryIcon";
import LiveManikinsIcon from "../components/icons/LiveManikinsIcon";
import CalibrationIcon from "../components/icons/CalibrationIcon";
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

function getFriendlyErrorMessage(message: string | null): string | null {
  if (!message) return null;
  const msg = message.toLowerCase();
  if (msg.includes("calibration_fail") || msg.includes("calibration failed")) {
    return "Calibration failed. Please adjust the sensor and retry.";
  }
  if (msg.includes("failed to start") || msg.includes("start session failed")) {
    return "Failed to start session. Check if the device is operational.";
  }
  if (msg.includes("stream disconnected")) {
    return "Live connection offline. Trying to reconnect...";
  }
  if (msg.includes("request_id") || msg.includes("progress_id")) {
    return "Action in progress. Please wait...";
  }
  return message;
}

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
      <div className="p-3 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-900/30 text-center text-xs text-gray-500 dark:text-gray-400">
        No active session metrics. Select a trainee and start a session.
      </div>
    );
  }

  const metric = liveState.latestMetric;
  const rate = metric?.rateCpm ?? null;
  const depth = metric?.depthMm ?? null;
  const count = metric?.compressionCount ?? 0;
  const goodRecoil = metric?.recoilOkCount ?? 0;
  const incompleteRecoil = metric?.incompleteRecoilCount ?? 0;

  // Rate colour-coding: target 100-120 CPM
  let rateColor = "text-gray-500 dark:text-gray-400 font-bold";
  let rateStatus = "Waiting...";
  if (rate !== null) {
    if (rate >= 100 && rate <= 120) {
      rateColor = "text-[#107C10] font-extrabold";
      rateStatus = "Good";
    } else if ((rate >= 90 && rate < 100) || (rate > 120 && rate <= 130)) {
      rateColor = "text-[#FF8C00] font-bold";
      rateStatus = "Warning";
    } else {
      rateColor = "text-[#D13438] font-bold";
      rateStatus = "Inadequate";
    }
  }

  // Depth colour-coding: target 50-60mm
  let depthColor = "text-gray-500 dark:text-gray-400 font-bold";
  if (depth !== null) {
    if (depth >= 50 && depth <= 60) {
      depthColor = "text-[#107C10] font-extrabold";
    } else if ((depth >= 45 && depth < 50) || (depth > 60 && depth <= 65)) {
      depthColor = "text-[#FF8C00] font-bold";
    } else {
      depthColor = "text-[#D13438] font-bold";
    }
  }

  const depthPercent = depth !== null ? Math.min(100, Math.max(0, (depth / 50) * 100)) : 0;

  return (
    <div className="grid gap-3 border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-xl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        {/* Depth card */}
        <div className="p-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg flex flex-col gap-1">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">Depth</span>
          <span className={`text-sm ${depthColor}`}>{depth !== null ? `${depth.toFixed(1)} mm` : "-"}</span>
          {depth !== null && (
            <Progress value={depthPercent} className="h-1 bg-gray-100 dark:bg-gray-700" />
          )}
        </div>

        {/* Rate card */}
        <div className="p-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg flex flex-col gap-1">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">Rate</span>
          <span className={`text-sm ${rateColor}`}>{rate !== null ? `${Math.round(rate)} CPM` : "-"}</span>
          {rate !== null && (
            <span className="text-[9px] uppercase font-semibold text-gray-400">{rateStatus}</span>
          )}
        </div>

        {/* Compression Count card */}
        <div className="p-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg flex flex-col gap-1 justify-center">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">Count</span>
          <span className="text-sm font-extrabold text-gray-900 dark:text-gray-100">{count}</span>
        </div>

        {/* Recoil card */}
        <div className="p-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg flex flex-col gap-1 justify-center">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold tracking-wider">Recoil</span>
          <div className="text-[11px] font-bold text-gray-700 dark:text-gray-300">
            <span className="text-[#107C10]">{goodRecoil} G</span>
            {" / "}
            <span className="text-[#D13438]">{incompleteRecoil} I</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveStreamStatusBadge({ state }: { state: LiveStreamState }) {
  if (state === "connecting") {
    return (
      <Badge variant="default" className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 font-medium">
        Connecting
      </Badge>
    );
  }

  if (state === "connected") {
    return (
      <Badge variant="default" className="bg-[#107C10]/10 text-[#107C10] font-medium border-0">
        Live Stream Connected
      </Badge>
    );
  }

  if (state === "reconnecting") {
    return (
      <Badge variant="default" className="bg-[#FF8C00]/10 text-[#FF8C00] font-medium border-0 animate-pulse">
        Reconnecting...
      </Badge>
    );
  }

  return (
    <Badge variant="default" className="bg-[#D13438]/10 text-[#D13438] font-medium border-0">
      Stream unavailable
    </Badge>
  );
}

export default function InstructorDashboard({
  embeddedInDesktop = false,
  onOpenTraineeDashboard,
  manualLanIpOverride = null,
}: InstructorDashboardProps) {
  const auth = useOptionalAuth();
  const currentUser = auth?.currentUser ?? null;
  const isAuthorized = !auth || Boolean(currentUser && currentUser.role !== "TRAINEE");
  const logout = auth?.logout ?? (() => Promise.resolve());
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
  const registryDeviceIdsRef = useRef<Set<string>>(new Set());
  const registryHasLoadedRef = useRef(false);

  // Quick calibration default profile state
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);

  useEffect(() => {
    async function loadDefaultProfile() {
      try {
        const defaultProf = await getDefaultCalibrationProfile();
        if (defaultProf) {
          setDefaultProfileId(defaultProf.profileId);
        } else {
          const all = await getCalibrationProfiles();
          const firstActive = all.find((p) => p.active);
          if (firstActive) {
            setDefaultProfileId(firstActive.profileId);
          }
        }
      } catch (e) {
        console.error("Failed to load default profile for quick calibration", e);
      }
    }
    loadDefaultProfile();
  }, []);

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
        request.traineeId = draft.traineeRecordId || `trainee-${deviceId.toLowerCase()}`;
      } else if (draft.traineeMode === "quick") {
        if (!draft.quickTraineeName || !draft.quickTraineeCode) {
          throw new Error("Please enter trainee name and code for quick add.");
        }
        request.traineeId = draft.quickTraineeCode;
        request.quickTrainee = {
          traineeCode: draft.quickTraineeCode,
          displayName: draft.quickTraineeName,
          groupName: draft.quickTraineeGroup || null,
        };
      } else if (draft.traineeMode === "guest") {
        request.traineeId = "guest";
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
        [deviceId]: `Calibration requested`,
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
      await cancelCalibration(deviceId);
      setSessionMessageByDevice((current) => ({
        ...current,
        [deviceId]: `Calibration cancelled`,
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

  const provisioningUrlText = provisioningUrl ?? "";
  const hubHealthy = serviceInfo !== null && !serviceInfoError;

  // Unified list of devices (Registry + Manikins)
  const unifiedDevices = useMemo(() => {
    const list: Array<{
      deviceId: string;
      online: boolean;
      fw?: string | null;
      ip?: string | null;
      rssi?: number | null;
      state?: string | null;
      lastSeen?: string | null;
    }> = [];

    const registryMap = new Map(registry.map((r) => [r.deviceId, r]));
    const manikinsMap = new Map(manikins.map((m) => [m.deviceId, m]));
    const allIds = new Set([...registryMap.keys(), ...manikinsMap.keys()]);

    for (const deviceId of allIds) {
      const reg = registryMap.get(deviceId);
      const man = manikinsMap.get(deviceId);

      list.push({
        deviceId,
        online: man?.online ?? reg?.online ?? false,
        fw: man?.fw ?? reg?.fw ?? null,
        ip: man?.ip ?? reg?.ip ?? null,
        rssi: man?.rssi ?? reg?.rssi ?? null,
        state: man?.firmwareState ?? reg?.state ?? man?.state ?? null,
        lastSeen: man?.lastSeen ?? reg?.lastSeen ?? null,
      });
    }

    return list.sort((a, b) => {
      if (a.online && !b.online) return -1;
      if (!a.online && b.online) return 1;
      return a.deviceId.localeCompare(b.deviceId);
    });
  }, [registry, manikins]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans transition-colors duration-200">
      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <header className="border-b border-gray-200 dark:border-gray-700 pb-4 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-50">Instructor Dashboard</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Multi‑manikin live performance monitoring and control
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Hidden Hub Health for Test Verification */}
              <span className="hidden">
                {hubHealthy ? "Healthy" : "Degraded"}
              </span>
            </div>
          </div>
        </header>
        
        {/* Device List Section */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 flex items-center gap-2">
              <LiveManikinsIcon size={18} /> Device List
            </h2>
            <LiveStreamStatusBadge state={manikinsStreamState} />
          </div>

          {manikinsLoading ? (
            <div className="p-6 text-center text-sm text-gray-500">
              Loading device data...
            </div>
          ) : null}

          {!manikinsLoading && manikinsError ? (
            <div className="p-6 text-center text-sm text-[#D13438] font-medium">
              {getFriendlyErrorMessage(manikinsError)}
            </div>
          ) : null}

          {!manikinsLoading && !manikinsError && unifiedDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50/50 dark:bg-gray-900/10 gap-3">
              <WifiOff className="text-gray-400 dark:text-gray-500" size={32} />
              <div>
                <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  No manikins connected
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Power on devices to see them here.
                </p>
              </div>
            </div>
          ) : null}

          {!manikinsLoading && !manikinsError && unifiedDevices.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {unifiedDevices.map((device) => {
                const manikin = manikinByDeviceId.get(device.deviceId);
                const activeSession = manikin ? getEffectiveSession(device.deviceId, manikin) : null;
                const active = Boolean(activeSession?.sessionId);
                const traineeLink = activeSession?.sessionId ? buildTraineeUrl(activeSession.sessionId) : null;
                const actionState = sessionActionByDevice[device.deviceId] ?? "idle";
                const calibrationAction = calibrationActionByDevice[device.deviceId] ?? "idle";
                const readiness = readinessByDevice[device.deviceId];
                const readinessIsKnown = readinessKnown(readiness);
                const startReadinessBlocked = startBlockedByReadiness(readiness);
                const startDisabled = actionState !== "idle" || startReadinessBlocked || !device.online;
                const effectiveFirmwareState = readiness?.firmwareState ?? device.state ?? "unknown";
                const calibrationProgress = progressFromId(readiness?.progressId);
                const isCalibrating = effectiveFirmwareState === "CALIBRATING";

                return (
                  <Card
                    key={device.deviceId}
                    className="p-5 flex flex-col gap-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm"
                  >
                    {/* Card Header */}
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                          <CircleDot size={12} className={device.online ? "text-[#107C10]" : "text-gray-400"} />
                          {device.deviceId}
                        </h3>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 block mt-0.5">
                          IP: {device.ip ?? "No IP"} &middot; FW: {device.fw ?? "unknown"}
                        </span>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        {isCalibrating ? (
                          <Badge variant="default" className="bg-[#FF8C00]/10 text-[#FF8C00] font-bold border-0 text-[10px]">
                            Calibrating ({Math.round(calibrationProgress)}%)
                          </Badge>
                        ) : (
                          <Badge
                            variant="default"
                            className={device.online ? "bg-[#107C10]/10 text-[#107C10] font-bold border-0 text-[10px]" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-bold border-0 text-[10px]"}
                          >
                            {device.online ? "Online" : "Offline"}
                          </Badge>
                        )}
                        
                        {active && (
                          <Badge variant="default" className="bg-blue-50 dark:bg-blue-900/30 text-[#005A9C] dark:text-blue-400 font-bold border-0 text-[10px]">
                            Session Active
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Device Action Message Banner */}
                    {sessionMessageByDevice[device.deviceId] && (
                      <div className="p-2 text-xs rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-800">
                        {getFriendlyErrorMessage(sessionMessageByDevice[device.deviceId])}
                      </div>
                    )}

                    {/* Calibration Progress Ring in progress */}
                    {isCalibrating && (
                      <div className="flex items-center gap-2 border border-orange-100 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/10 p-2.5 rounded-lg">
                        <Progress value={calibrationProgress} className="h-1.5 bg-orange-100 dark:bg-orange-900/40" />
                      </div>
                    )}

                    {/* Live Session Panel inside the card */}
                    <InstructorLiveMetrics
                      deviceId={device.deviceId}
                      sessionId={activeSession?.sessionId ?? null}
                      active={active}
                    />

                    {/* Trainee Setup Section */}
                    {!active && device.online && (
                      <div className="flex flex-col gap-2.5 bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-xs">
                        <div className="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                          <Users size={12} /> Trainee Mode
                        </div>

                        {/* Mode selections */}
                        <div className="grid grid-cols-3 gap-1">
                          {(["select", "quick", "guest"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() =>
                                setSessionDrafts((current) => ({
                                  ...current,
                                  [device.deviceId]: {
                                    ...current[device.deviceId],
                                    traineeMode: mode,
                                  },
                                }))
                              }
                              className={`py-1 px-2 rounded-lg font-bold border transition-colors ${
                                sessionDrafts[device.deviceId]?.traineeMode === mode
                                  ? "bg-gray-900 border-gray-900 text-white dark:bg-gray-100 dark:border-gray-100 dark:text-gray-900"
                                  : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {mode === "select" ? "Select" : mode === "quick" ? "Quick Add" : "Guest"}
                            </button>
                          ))}
                        </div>

                        {/* Mode-specific forms */}
                        {sessionDrafts[device.deviceId]?.traineeMode === "select" && (
                          <Select
                            value={sessionDrafts[device.deviceId]?.traineeRecordId || ""}
                            onChange={(event) =>
                              setSessionDrafts((current) => ({
                                ...current,
                                [device.deviceId]: {
                                  ...current[device.deviceId],
                                  traineeRecordId: event.target.value,
                                },
                              }))
                            }
                            className="w-full bg-white dark:bg-gray-800 dark:text-gray-100 mt-1"
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

                        {sessionDrafts[device.deviceId]?.traineeMode === "quick" && (
                          <div className="grid gap-1.5 mt-1">
                            <Input
                              type="text"
                              placeholder="Trainee Code"
                              value={sessionDrafts[device.deviceId]?.quickTraineeCode || ""}
                              onChange={(event) =>
                                setSessionDrafts((current) => ({
                                  ...current,
                                  [device.deviceId]: {
                                    ...current[device.deviceId],
                                    quickTraineeCode: event.target.value,
                                  },
                                }))
                              }
                              className="bg-white dark:bg-gray-800"
                            />
                            <Input
                              type="text"
                              placeholder="Display Name"
                              value={sessionDrafts[device.deviceId]?.quickTraineeName || ""}
                              onChange={(event) =>
                                setSessionDrafts((current) => ({
                                  ...current,
                                  [device.deviceId]: {
                                    ...current[device.deviceId],
                                    quickTraineeName: event.target.value,
                                  },
                                }))
                              }
                              className="bg-white dark:bg-gray-800"
                            />
                          </div>
                        )}

                        {sessionDrafts[device.deviceId]?.traineeMode === "guest" && (
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 italic">
                            Start session anonymously without registration.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Device Action Buttons */}
                    <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-gray-100 dark:border-gray-700">
                      {device.online && isAuthorized && (
                        <>
                          {!active ? (
                            <Button
                              onClick={() => handleStartSession(device.deviceId)}
                              disabled={startDisabled}
                              className="bg-[#005A9C] hover:bg-[#005A9C]/90 text-white flex-1 border-0 h-10 text-xs px-4"
                              title={startReadinessBlocked ? "Manikin readiness check not satisfied" : undefined}
                            >
                              {actionState === "starting" ? "Starting..." : "Start Session"}
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleEndSession(device.deviceId, activeSession!.sessionId)}
                              disabled={actionState !== "idle"}
                              className="bg-[#D13438] hover:bg-[#D13438]/90 text-white flex-1 border-0 h-10 text-xs px-4"
                            >
                              {actionState === "ending" ? "Ending..." : "End Session"}
                            </Button>
                          )}

                          {/* Calibration Button */}
                          {!active && (
                            <>
                              {isCalibrating ? (
                                <Button
                                  variant="secondary"
                                  onClick={() => handleCancelCalibration(device.deviceId)}
                                  disabled={calibrationAction !== "idle"}
                                  className="text-xs h-10 px-4 flex items-center gap-1"
                                >
                                  Cancel
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    if (defaultProfileId) {
                                      handleRunCalibration(device.deviceId, { profileId: defaultProfileId });
                                    } else {
                                      // Scroll to Calibration Panel
                                      setSelectedCalibrationDeviceId(device.deviceId);
                                      document.getElementById("calibration-panel")?.scrollIntoView({ behavior: "smooth" });
                                    }
                                  }}
                                  disabled={calibrationAction !== "idle"}
                                  className="text-xs h-10 px-4 flex items-center gap-1 text-[#005A9C] dark:text-blue-400"
                                >
                                  Calibrate
                                </Button>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Trainee link card inside device card */}
                    {active && activeSession && (
                      <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-xl text-xs flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-gray-700 dark:text-gray-300">Trainee URL:</span>
                          <a
                            href={traineeLink ?? buildTraineeLandingUrl()}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#005A9C] dark:text-blue-400 font-semibold hover:underline"
                          >
                            Open Link
                          </a>
                        </div>
                        <code className="block p-1.5 bg-gray-100 dark:bg-gray-900 rounded text-[10px] break-all border border-gray-200 dark:border-gray-800">
                          {traineeLink ?? buildTraineeLandingUrl()}
                        </code>
                        <Button
                          onClick={() => navigateToTraineeDashboard(activeSession.sessionId)}
                          className="bg-[#005A9C] hover:bg-[#005A9C]/90 text-white h-10 text-[11px] w-full mt-1 border-0 px-4"
                        >
                          Open Dashboard In-App
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : null}
        </Card>

        {/* Calibration Settings Panel (if device selected) */}
        {selectedCalibrationDeviceId && (
          <div id="calibration-panel" className="mb-6">
            <CalibrationSettingsPanel
              devices={manikins}
              selectedDeviceId={selectedCalibrationDeviceId}
              onSelectedDeviceChange={setSelectedCalibrationDeviceId}
              calibrationAction={selectedCalibrationDeviceId ? calibrationActionByDevice[selectedCalibrationDeviceId] ?? "idle" : "idle"}
              onRunCalibration={handleRunCalibration}
            />
          </div>
        )}

        {/* Firmware Provisioning Section */}
        <Card className="mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <ProvisioningIcon size={18} /> Firmware Provisioning
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Provision a new ESP controller with Wi-Fi details.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Wi-Fi SSID</label>
              <Input
                type="text"
                placeholder="SSID Name"
                value={provisioningWifiSsid}
                onChange={(e) => {
                  setProvisioningWifiSsid(e.target.value);
                  setProvisioningUrl(null);
                  setProvisioningPayload(null);
                  setPairingError(null);
                }}
                className="bg-white dark:bg-gray-700 dark:text-gray-100 border border-gray-200 dark:border-gray-600"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Wi-Fi Password</label>
              <Input
                type="password"
                placeholder="Password"
                value={provisioningWifiPassword}
                onChange={(e) => {
                  setProvisioningWifiPassword(e.target.value);
                  setProvisioningUrl(null);
                  setProvisioningPayload(null);
                  setPairingError(null);
                }}
                className="bg-white dark:bg-gray-700 dark:text-gray-100 border border-gray-200 dark:border-gray-600"
              />
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={provisioningAutoSave}
                onChange={(e) => {
                  setProvisioningAutoSave(e.target.checked);
                  setProvisioningUrl(null);
                  setProvisioningPayload(null);
                  setPairingError(null);
                }}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Auto-save Config
            </div>

            <div className="flex justify-end pt-2">
              <Button
                disabled={pairingLoading || !provisioningWifiSsid.trim()}
                onClick={handleRequestPairing}
                className="bg-[#005A9C] hover:bg-[#005A9C]/90 text-white border-0 h-10 px-6"
              >
                {pairingLoading ? "Generating..." : "Generate Portal QR"}
              </Button>
            </div>
          </div>

          {pairingError ? (
            <p className="text-xs text-[#D13438] font-bold mt-3">
              {pairingError}
            </p>
          ) : null}

          {provisioningUrl && (
            <div className="mt-6 p-4 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-lg flex flex-col items-center gap-3">
              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">Scan to Pair Device</span>
              <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                <QR value={provisioningUrl} size={150} fgColor="#0f172a" />
              </div>
              <code className="text-[10px] break-all p-1.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 w-full">
                {provisioningUrl}
              </code>
              <div className="flex justify-end w-full">
                <Button
                  variant="secondary"
                  onClick={() => navigator.clipboard?.writeText(provisioningUrlText)}
                  className="text-xs h-10 px-4"
                >
                  Copy Setup URL
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Local Session Review Panel */}
        <LocalSessionReviewPanel
          latestEndedSession={latestEndedSession}
          sessions={recentSessions}
          loading={recentSessionsLoading}
          error={recentSessionsError}
          canExport={isAuthorized}
          expandedSessionId={expandedSessionId}
          expandedSessionDetail={expandedSessionDetail}
          expandedSessionLoading={expandedSessionLoading}
          expandedSessionError={expandedSessionError}
          onSelectSession={handleViewDetails}
          onRefresh={loadRecentSessions}
        />

        {/* Footer */}
        <footer className="mt-12 py-6 border-t border-gray-200 dark:border-gray-800 text-center text-xs text-gray-500 dark:text-gray-400">
          &copy; {new Date().getFullYear()} ResQ CPR Simulation Hub. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
