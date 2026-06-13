import { useEffect, useState } from "react";
import { getJson } from "../../api/localHubClient";
import { getRosterSyncStatus, runRosterSync } from "../../lib/browserRosterSyncApi";
import type { SyncStateRecord } from "../../lib/browserRosterSyncApi";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import MetricTile from "../../components/ui/MetricTile";

type ServiceInfo = {
  ok: boolean;
  cloudSyncEnabled?: boolean;
  cloud_sync_enabled?: boolean;
  rosterSyncEnabled?: boolean;
  roster_sync_enabled?: boolean;
};

type SyncQueueItem = {
  id: string;
  entityType: string;
  entityId: string;
  syncStatus: "PENDING" | "SYNCED" | "FAILED";
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  syncedAt: string | null;
};

export function V2AdminSyncDashboardPage({ navigate }: { navigate: (path: string) => void }) {
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [rosterSync, setRosterSync] = useState<SyncStateRecord | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingRoster, setSyncingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    try {
      const [infoRes, rosterRes, queueRes] = await Promise.all([
        getJson<ServiceInfo>("/api/hub/service-info"),
        getRosterSyncStatus().catch(() => null),
        getJson<SyncQueueItem[]>("/api/sync-queue").catch(() => []),
      ]);
      setServiceInfo(infoRes);
      setRosterSync(rosterRes);
      setSyncQueue(queueRes);
    } catch (err) {
      setError("Failed to load sync dashboard metrics. Please check LocalHub connectivity.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleTriggerRosterSync() {
    setSyncingRoster(true);
    try {
      await runRosterSync();
      // Reload instantly
      const rosterRes = await getRosterSyncStatus().catch(() => null);
      setRosterSync(rosterRes);
      alert("Cloud roster sync triggered successfully.");
    } catch (err) {
      alert("Failed to run roster sync: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncingRoster(false);
    }
  }

  if (loading) {
    return <LoadingState message="Loading sync metrics..." />;
  }

  const cloudSyncEnabled = serviceInfo?.cloudSyncEnabled ?? serviceInfo?.cloud_sync_enabled ?? false;
  const rosterSyncEnabled = serviceInfo?.rosterSyncEnabled ?? serviceInfo?.roster_sync_enabled ?? false;

  // Aggregate queue metrics
  const totalQueue = syncQueue.length;
  const pendingCount = syncQueue.filter((item) => item.syncStatus === "PENDING").length;
  const syncedCount = syncQueue.filter((item) => item.syncStatus === "SYNCED").length;
  const failedCount = syncQueue.filter((item) => item.syncStatus === "FAILED").length;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <PageHeader
        title="Cloud Sync Dashboard"
        subtitle="Manage cloud roster replication, synchronization logs, and telemetry upload queue."
      />

      {error && (
        <Card className="border-rose-100 bg-rose-50 text-rose-800 rounded-3xl p-6">
          <p className="text-sm font-semibold">{error}</p>
        </Card>
      )}

      {/* Cloud Sync Disabled Banner */}
      {!cloudSyncEnabled && (
        <Card className="border-amber-100 bg-amber-50 text-amber-800 rounded-3xl p-6">
          <div className="flex gap-4 items-start">
            <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-black text-lg">
              !
            </div>
            <div>
              <h3 className="font-bold text-base text-amber-900 leading-tight">Cloud Sync Disabled</h3>
              <p className="text-sm mt-1.5 text-amber-700 leading-relaxed">
                Cloud sync is currently disabled. Sessions are saved locally.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Sync Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Roster Sync Status */}
        <Card className="flex flex-col justify-between" padding="lg">
          <div>
            <div className="flex justify-between items-start">
              <CardHeader
                title="Roster Synchronization"
                subtitle="Sync class cohorts, student profiles, and instructor metadata."
              />
              <StatusBadge
                tone={!rosterSyncEnabled ? "muted" : rosterSync?.lastError ? "danger" : "success"}
                label={!rosterSyncEnabled ? "Disabled" : rosterSync?.lastError ? "Error" : "Active"}
              />
            </div>

            <div className="mt-6 space-y-4 text-xs font-semibold">
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-400">Sync Config Status</span>
                <span className="text-slate-800 font-bold">{rosterSyncEnabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-400">Last Attempt</span>
                <span className="text-slate-800 font-mono">
                  {rosterSync?.lastAttemptAt ? new Date(rosterSync.lastAttemptAt).toLocaleString() : "Never"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-400">Last Success</span>
                <span className="text-slate-800 font-mono">
                  {rosterSync?.lastSuccessAt ? new Date(rosterSync.lastSuccessAt).toLocaleString() : "Never"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-400">Sync Counts</span>
                <span className="text-slate-800">
                  Courses: {rosterSync?.lastCourseCount ?? 0} | Students: {rosterSync?.lastUserCount ?? 0}
                </span>
              </div>
              {rosterSync?.lastError && (
                <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl mt-2 leading-relaxed">
                  <span className="font-bold block mb-0.5">Last Error:</span>
                  {rosterSync.lastError}
                </div>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 mt-6 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              loading={syncingRoster}
              disabled={!rosterSyncEnabled}
              onClick={handleTriggerRosterSync}
              className="font-bold text-xs"
            >
              Trigger Roster Sync Now
            </Button>
          </div>
        </Card>

        {/* Sync Queue Summary Card */}
        <Card padding="lg">
          <CardHeader
            title="Session Queue Statistics"
            subtitle="Local session logs stored and scheduled for upload to ResQ Cloud."
          />
          <div className="grid grid-cols-2 gap-4 mt-6">
            <MetricTile
              label="Pending Upload"
              value={pendingCount}
              description="Awaiting connection"
              tone={pendingCount > 0 ? "yellow" : "slate"}
            />
            <MetricTile
              label="Sync Failures"
              value={failedCount}
              description="Need retrying"
              tone={failedCount > 0 ? "yellow" : "slate"}
            />
            <MetricTile
              label="Successfully Uploaded"
              value={syncedCount}
              description="Confirmed in cloud"
              tone="green"
            />
            <MetricTile
              label="Total Queue Items"
              value={totalQueue}
              description="Processed logs"
              tone="teal"
            />
          </div>
        </Card>
      </div>

      {/* Sync Queue Item Table */}
      <Card padding="lg">
        <CardHeader
          title="Recent Sync Queue Log"
          subtitle="Real-time status of session telemetry transfers to ResQ Cloud."
        />
        <div className="mt-6 overflow-x-auto">
          {syncQueue.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm font-semibold border border-dashed border-slate-200 rounded-2xl">
              No session sync items in the queue logs.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs font-semibold text-slate-600">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase text-[9px] tracking-wider">
                  <th className="py-3 px-4">Entity ID</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Retries</th>
                  <th className="py-3 px-4">Created At</th>
                  <th className="py-3 px-4">Last Attempt</th>
                  <th className="py-3 px-4">Last Error</th>
                </tr>
              </thead>
              <tbody>
                {syncQueue.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-800">{item.entityId}</td>
                    <td className="py-3.5 px-4 uppercase tracking-wider text-[10px] text-teal-600 font-extrabold">{item.entityType}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[9.5px] uppercase font-extrabold tracking-wider ${
                          item.syncStatus === "SYNCED"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                            : item.syncStatus === "FAILED"
                            ? "bg-rose-50 text-rose-700 border-rose-100"
                            : "bg-amber-50 text-amber-700 border-amber-100"
                        }`}
                      >
                        {item.syncStatus}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono">{item.retryCount}</td>
                    <td className="py-3.5 px-4 font-mono">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      {item.lastAttemptAt ? new Date(item.lastAttemptAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-3.5 px-4 max-w-xs truncate text-rose-600" title={item.lastError || ""}>
                      {item.lastError || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

export default V2AdminSyncDashboardPage;
