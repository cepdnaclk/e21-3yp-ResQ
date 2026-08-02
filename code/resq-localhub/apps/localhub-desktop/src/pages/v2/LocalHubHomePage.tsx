import { useEffect, useMemo, useState } from "react";
import { getJson } from "../../api/localHubClient";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import { fetchCompletedSessions, fetchSyncQueue } from "../../api/sessionsApi";
import { fetchTrainees } from "../../api/traineesApi";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import StudentTabletAccessPanel from "../../components/StudentTabletAccessPanel";
import { useAuth } from "../../auth/AuthContext";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { CompletedSession, SyncQueueItem } from "../../types/session";
import type { TraineeRecord } from "../../types/trainee";
import {
  formatDateTime,
  getCompressionCue,
  getConnectionStateLabel,
  getDeviceStateLabel,
} from "../../utils/userFriendlyLabels";

type HubHealth = {
  ok: boolean;
  service: string;
  timestamp: string;
};

type LocalHubHomePageProps = {
  onOpenInstructorDashboard: () => void;
};

type AttentionItem = {
  priority: number;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
  actionLabel: string;
  path: string;
};

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isReadyForSession(manikin: ManikinLiveSummary): boolean {
  if (isDisconnected(manikin)) return false;
  return manikin.readyForSession === true || manikin.state === "READY_FOR_SESSION";
}

function isReadinessUnavailable(manikin: ManikinLiveSummary): boolean {
  return !isDisconnected(manikin) && !manikin.state && manikin.readyForSession == null && manikin.calibrationState == null;
}

function isDisconnected(manikin: ManikinLiveSummary): boolean {
  return (
    manikin.offline ||
    manikin.stale ||
    !manikin.online ||
    manikin.connectionState === "OFFLINE" ||
    manikin.connectionState === "STALE" ||
    manikin.connectionState === "ERROR"
  );
}

function hasActiveSession(manikin: ManikinLiveSummary): boolean {
  return Boolean(manikin.activeSessionId);
}

function getManikinName(manikin: ManikinLiveSummary, index?: number): string {
  const friendlyIndex = index == null ? null : `Manikin ${String(index + 1).padStart(2, "0")}`;
  if (manikin.manikinId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(manikin.manikinId)) {
    return manikin.manikinId.replace(/^MAN[-_]?/i, "Manikin ");
  }
  if (friendlyIndex) return friendlyIndex;
  if (/^MAN[-_]?\d+$/i.test(manikin.deviceId)) return manikin.deviceId.replace(/^MAN[-_]?/i, "Manikin ");
  return "Unknown manikin";
}

function getTraineeName(id: string | null | undefined, traineeMap: Map<string, string>): string {
  if (!id) return "Unassigned trainee";
  return traineeMap.get(id) ?? "Unassigned trainee";
}

function getReadinessLabel(manikin: ManikinLiveSummary): string {
  if (isDisconnected(manikin)) return manikin.stale ? "Offline or stale" : "Offline";
  if (hasActiveSession(manikin)) return "Session active";
  if (isReadyForSession(manikin)) return "Ready";
  if (manikin.calibrationState === "RUNNING" || manikin.calibrationState === "CALIBRATING") return "Calibrating";
  if (manikin.calibrationState === "FAILED" || manikin.state === "CALIBRATION_FAIL") return "Calibration failed";
  if (manikin.calibrationState === "ERROR" || manikin.state === "ERROR") return "Device error";
  if (isReadinessUnavailable(manikin)) return "Readiness unavailable";
  return getDeviceStateLabel(manikin.state) === "Online" ? "Calibration required" : getDeviceStateLabel(manikin.state);
}

function getReadinessTone(manikin: ManikinLiveSummary): "success" | "info" | "warning" | "danger" | "muted" {
  if (isDisconnected(manikin)) return "danger";
  if (hasActiveSession(manikin)) return "info";
  if (isReadyForSession(manikin)) return "success";
  if (manikin.calibrationState === "FAILED" || manikin.calibrationState === "ERROR" || manikin.state === "ERROR") return "danger";
  if (isReadinessUnavailable(manikin)) return "muted";
  return "warning";
}

function getSessionStatus(manikin: ManikinLiveSummary): { label: string; tone: "success" | "info" | "warning" | "danger" | "muted" } {
  if (manikin.activeSessionLifecycleState === "STOP_PENDING") return { label: "Stopping", tone: "info" };
  if (manikin.activeSessionLifecycleState === "STOP_REJECTED") return { label: "Stop rejected", tone: "danger" };
  if (isDisconnected(manikin)) return { label: "Reconnecting", tone: "warning" };
  if (!manikin.latestMetric || (manikin.latestCompressionCount ?? 0) === 0) return { label: "Waiting for compressions", tone: "muted" };

  const depth = manikin.latestDepthMm;
  const rate = manikin.latestRateCpm;
  const recoil = manikin.latestRecoilOk;
  const depthOk = depth != null && depth >= 50 && depth <= 60;
  const rateOk = rate != null && rate >= 100 && rate <= 120;

  if (depthOk && rateOk && recoil === true) return { label: "Within target", tone: "success" };
  return { label: "Coaching needed", tone: "warning" };
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "No signal yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Last seen unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function scoreTone(score?: number | null): "success" | "warning" | "danger" | "muted" {
  if (score == null) return "muted";
  if (score >= 70) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

function getHeaderAction({
  manikins,
  activeSessions,
}: {
  manikins: ManikinLiveSummary[];
  activeSessions: ManikinLiveSummary[];
}) {
  if (activeSessions.length > 0) {
    return { label: "Monitor Sessions", path: "/live-sessions" };
  }
  if (manikins.length === 0) {
    return { label: "Add Manikin", path: "/instructor/pair" };
  }
  if (manikins.some((manikin) => isReadyForSession(manikin) && !hasActiveSession(manikin))) {
    return { label: "Start Training", path: "/start-session" };
  }
  return { label: "Prepare Manikins", path: "/instructor" };
}

export function LocalHubHomePage({ onOpenInstructorDashboard }: LocalHubHomePageProps) {
  const { currentUser } = useAuth();
  const [health, setHealth] = useState<HubHealth | null>(null);
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [trainees, setTrainees] = useState<TraineeRecord[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [livePaused, setLivePaused] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  async function loadOverview() {
    setLoadError(null);

    const [healthRes, manikinsRes, sessionsRes, syncRes, traineesRes] = await Promise.allSettled([
      getJson<HubHealth>("/api/hub/health"),
      fetchLiveManikins(),
      fetchCompletedSessions(),
      fetchSyncQueue(),
      fetchTrainees(),
    ]);

    if (healthRes.status === "fulfilled") setHealth(healthRes.value);
    if (manikinsRes.status === "fulfilled") setManikins(manikinsRes.value);
    if (sessionsRes.status === "fulfilled") setSessions(manikinSafeRecentSessions(sessionsRes.value));
    if (syncRes.status === "fulfilled") setSyncQueue(syncRes.value);
    if (traineesRes.status === "fulfilled") setTrainees(traineesRes.value);

    if (healthRes.status === "rejected" || manikinsRes.status === "rejected" || sessionsRes.status === "rejected") {
      setLoadError("Some Overview data could not be loaded. Last-known values are shown where available.");
    }

    setLastUpdatedAt(Date.now());
    setInitialLoading(false);
  }

  useEffect(() => {
    void loadOverview();

    const subscription = subscribeToManikinsLive(
      (updatedManikins) => {
        setLivePaused(false);
        setManikins(updatedManikins);
        setLastUpdatedAt(Date.now());
      },
      () => setLivePaused(true),
    );

    return () => subscription.stop();
  }, []);

  const activeSessions = useMemo(
    () => manikins.filter(hasActiveSession),
    [manikins],
  );

  const shareableSession = activeSessions.find(
    (manikin) => Boolean(manikin.activeSessionId && manikin.activeTraineeId),
  );

  const traineeMap = useMemo(() => {
    const map = new Map<string, string>();
    trainees.forEach((trainee) => map.set(trainee.id, trainee.displayName));
    return map;
  }, [trainees]);

  const summary = useMemo(() => {
    const online = manikins.filter((manikin) => manikin.online && !manikin.offline && !manikin.stale).length;
    const ready = manikins.filter((manikin) => isReadyForSession(manikin) && !hasActiveSession(manikin)).length;
    const readinessUnavailable = manikins.length > 0 && manikins.every((manikin) => isReadinessUnavailable(manikin));
    return { online, ready, readinessUnavailable };
  }, [manikins]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const runtimeIssues = activeSessions.filter((manikin) => {
      const status = getSessionStatus(manikin);
      return status.tone === "danger" || status.tone === "warning";
    });
    const deviceErrors = manikins.filter((manikin) => manikin.state === "ERROR" || manikin.calibrationState === "ERROR");
    const disconnected = manikins.filter(isDisconnected);
    const calibrationFailed = manikins.filter((manikin) => manikin.calibrationState === "FAILED" || manikin.state === "CALIBRATION_FAIL");
    const notReady = manikins.filter((manikin) => !isDisconnected(manikin) && !isReadinessUnavailable(manikin) && !isReadyForSession(manikin) && !hasActiveSession(manikin));
    const failedSync = syncQueue.filter((item) => item.syncStatus === "FAILED" || item.syncStatus === "RETRY_LATER");
    const pendingSync = syncQueue.filter((item) => item.syncStatus === "PENDING" || item.syncStatus === "SYNCING");

    if (runtimeIssues.length > 0) {
      items.push({
        priority: 1,
        tone: "warning",
        title: `${runtimeIssues.length} active session${runtimeIssues.length === 1 ? "" : "s"} need coaching attention.`,
        detail: "Open the live monitor to review current compression guidance.",
        actionLabel: "Monitor",
        path: "/live-sessions",
      });
    }

    if (deviceErrors.length > 0) {
      items.push({
        priority: 2,
        tone: "danger",
        title: `${deviceErrors.length} manikin${deviceErrors.length === 1 ? "" : "s"} report a device error.`,
        detail: "Review the device before using it in training.",
        actionLabel: "Review",
        path: "/instructor",
      });
    } else if (disconnected.length > 0) {
      items.push({
        priority: 2,
        tone: "warning",
        title: `${disconnected.length} manikin${disconnected.length === 1 ? "" : "s"} offline or stale.`,
        detail: "Reconnect devices before assigning them to a session.",
        actionLabel: "Review",
        path: "/instructor",
      });
    }

    if (calibrationFailed.length > 0) {
      items.push({
        priority: 3,
        tone: "warning",
        title: `${calibrationFailed.length} manikin${calibrationFailed.length === 1 ? "" : "s"} failed calibration.`,
        detail: "Complete calibration before starting a new session.",
        actionLabel: "Calibrate",
        path: "/instructor",
      });
    } else if (notReady.length > 0) {
      items.push({
        priority: 3,
        tone: "info",
        title: `${notReady.length} manikin${notReady.length === 1 ? "" : "s"} require preparation.`,
        detail: "Prepare or calibrate devices before training.",
        actionLabel: "Prepare",
        path: "/instructor",
      });
    }

    if (health && !health.ok) {
      items.push({
        priority: 4,
        tone: "warning",
        title: "LocalHub service is degraded.",
        detail: "Some backend services are not reporting ready.",
        actionLabel: "Review",
        path: "/diagnostics",
      });
    }

    if (failedSync.length > 0) {
      items.push({
        priority: 5,
        tone: "warning",
        title: `${failedSync.length} completed session${failedSync.length === 1 ? "" : "s"} need sync review.`,
        detail: "Training data is safely stored locally.",
        actionLabel: "Review",
        path: "/admin/sync",
      });
    } else if (pendingSync.length > 0) {
      items.push({
        priority: 5,
        tone: "info",
        title: `${pendingSync.length} completed session${pendingSync.length === 1 ? "" : "s"} waiting to sync.`,
        detail: "Training data is safely stored locally.",
        actionLabel: "Review",
        path: "/admin/sync",
      });
    }

    return items.sort((a, b) => a.priority - b.priority);
  }, [activeSessions, health, manikins, syncQueue]);

  if (initialLoading) {
    return <LoadingState message="Loading Overview..." />;
  }

  const isAdmin = currentUser?.role === "ADMIN";
  const visibleAttentionItems = attentionItems.filter((item) => isAdmin || item.path !== "/admin/sync");
  const headerAction = getHeaderAction({ manikins, activeSessions });
  const pageReady = health?.ok === true && visibleAttentionItems.length === 0;
  const syncOnlyNotice =
    visibleAttentionItems.length === 1 &&
    visibleAttentionItems[0].path === "/admin/sync" &&
    visibleAttentionItems[0].tone === "info";

  return (
    <div className="app-page space-y-5">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Overview</h1>
          <p className="mt-1 max-w-2xl text-sm sm:text-base text-slate-600 leading-relaxed">
            Welcome back, {currentUser?.displayName ?? "Instructor"}.{" "}
            {pageReady ? "Your CPR training environment is ready." : "Here is what needs attention before the next session."}
          </p>
          {lastUpdatedAt && (
            <p className="mt-1 text-sm text-slate-500">Last updated {timeAgo(new Date(lastUpdatedAt).toISOString())}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={() => navigateTo(headerAction.path)}>
            {headerAction.label}
          </Button>
          {manikins.length > 0 && (
            <Button type="button" variant="secondary" className="bg-white" onClick={onOpenInstructorDashboard}>
              Manage Manikins
            </Button>
          )}
        </div>
      </section>

      {(loadError || livePaused) && (
        <InlineNotice
          tone="warning"
          title={livePaused ? "Live updates paused. Reconnecting..." : "Overview data is partially unavailable."}
          detail={livePaused ? "The last loaded manikin snapshot remains visible." : loadError ?? ""}
          actionLabel="Retry"
          onAction={() => void loadOverview()}
        />
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" aria-label="Operational summary">
        <SummaryCard
          title="LocalHub"
          value={health?.ok ? "Connected" : health ? "Degraded" : "Unavailable"}
          detail={health?.ok ? "All core services available" : "Service status needs review"}
          tone={health?.ok ? "success" : "warning"}
          destination={health?.ok || !isAdmin ? undefined : "/diagnostics"}
        />
        <SummaryCard
          title="Manikins"
          value={`${summary.online} / ${manikins.length}`}
          detail="Devices currently online"
          tone={manikins.length === 0 ? "muted" : summary.online === manikins.length ? "success" : "warning"}
          destination={manikins.length > 0 ? "/instructor" : undefined}
        />
        <SummaryCard
          title="Ready"
          value={manikins.length === 0 || summary.readinessUnavailable ? "—" : String(summary.ready)}
          detail={manikins.length === 0 ? "No manikins registered" : summary.readinessUnavailable ? "Readiness unavailable" : "Available for training"}
          tone={manikins.length === 0 || summary.readinessUnavailable ? "muted" : summary.ready > 0 ? "success" : "warning"}
          destination={manikins.length > 0 ? "/instructor" : undefined}
        />
        <SummaryCard
          title="Active Sessions"
          value={String(activeSessions.length)}
          detail="Currently running"
          tone={activeSessions.length > 0 ? "info" : "muted"}
          destination={activeSessions.length > 0 ? "/live-sessions" : undefined}
        />
      </section>

      <StudentTabletAccessPanel
        backendAvailable={health?.ok === true}
        activeSessionId={shareableSession?.activeSessionId}
        canShareActiveSession={currentUser?.role === "INSTRUCTOR" || currentUser?.role === "ADMIN"}
      />

      {visibleAttentionItems.length > 0 ? (
        <section aria-labelledby="attention-title">
          <Card className="border-amber-100 bg-amber-50/60 p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 id="attention-title" className="text-lg font-semibold text-slate-900">
                  {syncOnlyNotice ? "System Notices" : "Attention Required"}
                </h2>
                <div className="mt-3 space-y-3">
                  {visibleAttentionItems.slice(0, 2).map((item) => (
                    <article key={`${item.title}-${item.path}`} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.detail}</p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="shrink-0 bg-white"
                        onClick={() => navigateTo(item.path)}
                      >
                        {item.actionLabel}
                      </Button>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </section>
      ) : (
        <InlineNotice tone="success" title="Everything is ready for training." detail="No operational blockers are currently reported." />
      )}

      <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-4">
        <Card className="p-0 overflow-hidden">
          <PanelHeader
            title="Training Floor"
            actionLabel={manikins.length > 0 ? "View All Manikins" : undefined}
            onAction={manikins.length > 0 ? onOpenInstructorDashboard : undefined}
          />
          <div className="divide-y divide-slate-100">
            {manikins.length === 0 ? (
              <CompactEmpty title="No registered manikins." detail="Add a manikin before starting CPR training." />
            ) : (
              manikins.slice(0, 6).map((manikin, index) => (
                <ManikinRow
                  key={manikin.deviceId}
                  manikin={manikin}
                  index={index}
                  traineeMap={traineeMap}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <PanelHeader title="Active Sessions" />
          <div className="divide-y divide-slate-100">
            {activeSessions.length === 0 ? (
              <CompactEmpty title="No training sessions are currently running." detail="Start when a prepared manikin is available." />
            ) : (
              activeSessions.slice(0, 4).map((manikin, index) => (
                <ActiveSessionRow key={manikin.activeSessionId} manikin={manikin} index={index} traineeMap={traineeMap} />
              ))
            )}
          </div>
        </Card>
      </section>

      <Card className="p-0 overflow-hidden">
        <PanelHeader title="Recent Sessions" actionLabel="View All Sessions" onAction={() => navigateTo("/sessions")} />
        <div className="divide-y divide-slate-100">
          {sessions.length === 0 ? (
            <CompactEmpty title="No completed sessions yet." detail="Completed CPR training records will appear here." />
          ) : (
            sessions.slice(0, 3).map((session) => (
              <RecentSessionRow key={session.sessionId} session={session} traineeMap={traineeMap} />
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function manikinSafeRecentSessions(sessions: CompletedSession[]) {
  return [...sessions].sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
}

function SummaryCard({
  title,
  value,
  detail,
  tone,
  destination,
}: {
  title: string;
  value: string;
  detail: string;
  tone: "success" | "info" | "warning" | "danger" | "muted";
  destination?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <StatusDot tone={tone} />
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </>
  );

  if (destination) {
    return (
      <button
        type="button"
        className="text-left bg-white rounded-2xl border border-slate-100 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.35)] p-5 transition hover:border-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        onClick={() => navigateTo(destination)}
      >
        {content}
      </button>
    );
  }

  return (
    <Card padding="none" className="p-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.35)]">
      {content}
    </Card>
  );
}

function StatusDot({ tone }: { tone: "success" | "info" | "warning" | "danger" | "muted" }) {
  const className = {
    success: "bg-emerald-500",
    info: "bg-sky-500",
    warning: "bg-amber-500",
    danger: "bg-rose-500",
    muted: "bg-slate-300",
  }[tone];

  return <span className={`h-2.5 w-2.5 rounded-full ${className}`} aria-hidden="true" />;
}

function InlineNotice({
  tone,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  tone: "success" | "warning";
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const classes = tone === "success"
    ? "border-emerald-100 bg-emerald-50/70 text-emerald-900"
    : "border-amber-100 bg-amber-50/70 text-amber-900";

  return (
    <section className={`rounded-2xl border px-4 py-3 ${classes}`} aria-live={tone === "warning" ? "polite" : undefined}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-sm opacity-80">{detail}</p>
        </div>
        {actionLabel && onAction && (
          <Button type="button" variant="secondary" size="sm" className="bg-white" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </section>
  );
}

function PanelHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {actionLabel && onAction && (
        <Button type="button" variant="secondary" size="sm" className="bg-white" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function ManikinRow({
  manikin,
  index,
  traineeMap,
}: {
  manikin: ManikinLiveSummary;
  index: number;
  traineeMap: Map<string, string>;
}) {
  const active = hasActiveSession(manikin);
  const readinessLabel = getReadinessLabel(manikin);
  const action = active
    ? { label: "Monitor", path: manikin.activeSessionId ? `/instructor/sessions/${manikin.activeSessionId}/live` : "/live-sessions" }
    : isReadyForSession(manikin)
      ? { label: "Start", path: "/start-session" }
      : readinessLabel.includes("Calibration")
        ? { label: "Calibrate", path: `/instructor/manikins/${encodeURIComponent(manikin.deviceId)}/calibration` }
        : { label: "View", path: "/instructor" };

  const trainee = active ? getTraineeName(manikin.activeTraineeId, traineeMap) : null;
  const detail = active
    ? `Online · session active with ${trainee}`
    : isDisconnected(manikin)
      ? `${readinessLabel} · last seen ${timeAgo(manikin.lastSeen)}`
      : `Online · ${readinessLabel}`;

  return (
    <article className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-slate-900">{getManikinName(manikin, index)}</h3>
          <StatusBadge tone={getReadinessTone(manikin)} label={readinessLabel} />
        </div>
        <p className="mt-1 text-sm text-slate-500 truncate">{detail}</p>
      </div>
      <Button type="button" variant="secondary" size="sm" className="shrink-0 bg-white" onClick={() => navigateTo(action.path)}>
        {action.label}
      </Button>
    </article>
  );
}

function ActiveSessionRow({
  manikin,
  index,
  traineeMap,
}: {
  manikin: ManikinLiveSummary;
  index: number;
  traineeMap: Map<string, string>;
}) {
  const status = getSessionStatus(manikin);
  const cue = getCompressionCue(manikin.latestMetric, manikin.latestFlags, manikin.connectionState, manikin.sessionActive);
  const traineeName = getTraineeName(manikin.activeTraineeId, traineeMap);
  const elapsed = manikin.activeSessionStartedAt ? `${timeAgo(manikin.activeSessionStartedAt)} elapsed` : "Elapsed time unavailable";

  return (
    <article className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900 truncate">
            {traineeName} · {getManikinName(manikin, index)}
          </h3>
          <StatusBadge tone={status.tone} label={status.label} />
        </div>
        <p className="mt-1 text-sm text-slate-500">{elapsed}</p>
        <p className="mt-1 text-sm font-medium text-slate-700 truncate">{cue}</p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 bg-white"
        onClick={() => manikin.activeSessionId && navigateTo(`/instructor/sessions/${manikin.activeSessionId}/live`)}
      >
        Monitor
      </Button>
    </article>
  );
}

function RecentSessionRow({ session, traineeMap }: { session: CompletedSession; traineeMap: Map<string, string> }) {
  const trainee = getTraineeName(session.traineeId, traineeMap);
  const manikin = session.deviceId ? getManikinName({ deviceId: session.deviceId, manikinId: null } as ManikinLiveSummary) : "Unknown manikin";
  const hasSummary = Boolean(session.summary);
  const score = session.summary?.score;
  const scoreLabel = hasSummary && score != null ? `${score}%` : "Not scored";

  return (
    <button
      type="button"
      className="w-full text-left px-5 py-3.5 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500/30"
      onClick={() => navigateTo(`/sessions/${session.sessionId}`)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">
            {trainee} · {manikin}
          </h3>
          <p className="mt-1 text-sm text-slate-500">{formatDateTime(session.endedAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone={session.ended ? "success" : "warning"} label={session.ended ? "Completed" : "Interrupted"} />
          <StatusBadge tone={hasSummary && score != null ? scoreTone(score) : "muted"} label={scoreLabel} />
        </div>
      </div>
    </button>
  );
}

function CompactEmpty({
  title,
  detail,
  actionLabel,
  path,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  path?: string;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
      {actionLabel && path && (
        <Button type="button" variant="secondary" size="sm" className="mt-3 bg-white" onClick={() => navigateTo(path)}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export default LocalHubHomePage;
