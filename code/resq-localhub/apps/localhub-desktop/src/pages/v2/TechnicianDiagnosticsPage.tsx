import { useEffect, useState } from "react";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { fetchDeviceDiagnostics, requestDebugSnapshot } from "../../api/firmwareApi";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { FirmwareDeviceDiagnosticsResponse } from "../../types/firmware";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { getJson } from "../../api/localHubClient";

type HubHealth = {
  ok: boolean;
  service: string;
  timestamp: string;
};

type ServiceInfo = {
  ok: boolean;
  backend_base_url: string;
  mqtt_host: string;
  mqtt_port: number;
  dashboard_url: string;
  local_ip: string;
};

export function TechnicianDiagnosticsPage() {
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [diagnostics, setDiagnostics] = useState<FirmwareDeviceDiagnosticsResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hub operational & access info states
  const [hubHealth, setHubHealth] = useState<HubHealth | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [loadingHub, setLoadingHub] = useState(false);

  async function loadManikins() {
    setLoadingList(true);
    try {
      const list = await fetchLiveManikins();
      setManikins(list);
      if (list.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(list[0].deviceId);
      }
    } catch (err) {
      setError("Failed to load manikins list.");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDiagnostics(deviceId: string) {
    if (!deviceId) return;
    setLoadingDiag(true);
    setError(null);
    try {
      const diagData = await fetchDeviceDiagnostics(deviceId);
      setDiagnostics(diagData);
    } catch (err) {
      setError("Failed to load device diagnostics bundle.");
    } finally {
      setLoadingDiag(false);
    }
  }

  async function loadHubStatus() {
    setLoadingHub(true);
    try {
      const [healthRes, infoRes] = await Promise.all([
        getJson<HubHealth>("/api/hub/health").catch(() => null),
        getJson<ServiceInfo>("/api/hub/service-info").catch(() => null),
      ]);
      setHubHealth(healthRes);
      setServiceInfo(infoRes);
    } catch (err) {
      console.warn("Could not load hub system status details", err);
    } finally {
      setLoadingHub(false);
    }
  }

  useEffect(() => {
    loadManikins();
    loadHubStatus();
  }, []);

  useEffect(() => {
    if (selectedDeviceId) {
      loadDiagnostics(selectedDeviceId);
    }
  }, [selectedDeviceId]);

  async function handleRequestDebug() {
    if (!selectedDeviceId) return;
    setBusyAction(true);
    setError(null);
    try {
      await requestDebugSnapshot(selectedDeviceId);
      alert("Debug snapshot requested successfully.");
      await loadDiagnostics(selectedDeviceId);
    } catch (err) {
      setError("Failed to request debug snapshot.");
    } finally {
      setBusyAction(false);
    }
  }

  if (loadingList) {
    return <LoadingState message="Loading manikins directory..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technician Diagnostics Console"
        subtitle="Troubleshoot wireless signal strength, firmware flags, and raw sensor readings."
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fadeIn">
        {/* Selection & Status Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader title="Select Device" />
            <div className="space-y-4">
              <div>
                <label htmlFor="deviceSelect" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Connected Manikins
                </label>
                <select
                  id="deviceSelect"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium cursor-pointer"
                >
                  <option value="">-- Choose Device --</option>
                  {manikins.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.deviceId} ({m.online ? "Online" : "Offline"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2">
                <Button
                  type="button"
                  className="w-full justify-center"
                  loading={busyAction}
                  disabled={!selectedDeviceId}
                  onClick={handleRequestDebug}
                >
                  Request Debug Snapshot
                </Button>
              </div>

              <div className="pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-center"
                  disabled={!selectedDeviceId}
                  onClick={() => selectedDeviceId && loadDiagnostics(selectedDeviceId)}
                >
                  Refresh Diagnostics
                </Button>
              </div>
            </div>
          </Card>

          {/* LocalHub System Status details (Correction 2) */}
          <Card>
            <CardHeader title="LocalHub System & Access" />
            <div className="space-y-4 text-xs font-medium text-slate-600">
              {loadingHub ? (
                <p className="text-slate-400">Loading operational info...</p>
              ) : (
                <>
                  <div>
                    <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">System Operational Health</span>
                    {hubHealth?.ok ? (
                      <StatusBadge tone="success" label="Core Services Ready" dot={true} />
                    ) : (
                      <StatusBadge tone="warning" label="Needs Attention" dot={true} />
                    )}
                  </div>

                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div>
                      <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Database Status</span>
                      <span className="font-mono text-slate-700">{hubHealth?.ok ? "ONLINE" : "UNHEALTHY / CHECK LOGS"}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Service Orchestrator</span>
                      <span className="font-mono text-slate-700">{hubHealth?.service || "LocalHub-Core"}</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div>
                      <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">LAN Shared Access Link</span>
                      <a
                        href={`http://${serviceInfo?.local_ip || "localhost"}:1420`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-teal-600 hover:underline break-all block mt-0.5"
                      >
                        http://{serviceInfo?.local_ip || "localhost"}:1420
                      </a>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Backend Base URL</span>
                      <span className="font-mono text-slate-700 break-all block mt-0.5">{serviceInfo?.backend_base_url || "N/A"}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Wireless MQTT Broker</span>
                      <span className="font-mono text-slate-700 block mt-0.5">
                        {serviceInfo?.mqtt_host || "127.0.0.1"}:{serviceInfo?.mqtt_port || 1883}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Diagnostics Results */}
        <div className="lg:col-span-3 space-y-6">
          {error && (
            <Card className="border-red-200 bg-red-50 text-red-800 p-4">
              <p className="text-sm font-semibold">{error}</p>
            </Card>
          )}

          {loadingDiag ? (
            <LoadingState message="Fetching diagnostics bundle..." />
          ) : !diagnostics ? (
            <Card className="text-center py-16">
              <p className="text-gray-500 text-sm">Select a device to view diagnostics details.</p>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Device Hardware Spec Card */}
              <Card>
                <CardHeader title="Hardware Specifications" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
                  <Stat label="IP Address" value={diagnostics.liveSummary?.ip || "N/A"} />
                  <Stat label="Firmware Version" value={diagnostics.liveSummary?.fw || "N/A"} />
                  <Stat label="Wi-Fi Signal (RSSI)" value={diagnostics.liveSummary?.rssi !== null ? `${diagnostics.liveSummary?.rssi} dBm` : "N/A"} />
                  <Stat label="Battery Level" value={diagnostics.liveSummary?.battery !== null ? `${diagnostics.liveSummary?.battery}%` : "N/A"} />
                </div>
              </Card>

              {/* Sensor Raw Values */}
              <Card>
                <CardHeader title="Raw Sensor Diagnostics" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
                  <Stat label="Force Sensor 1 (Raw)" value={diagnostics.liveSummary?.latestForce1 !== null ? String(diagnostics.liveSummary?.latestForce1) : "N/A"} />
                  <Stat label="Force Sensor 2 (Raw)" value={diagnostics.liveSummary?.latestForce2 !== null ? String(diagnostics.liveSummary?.latestForce2) : "N/A"} />
                  <Stat label="Pressure Balance" value={diagnostics.liveSummary?.pressureBalancePct !== null ? `${diagnostics.liveSummary?.pressureBalancePct}%` : "N/A"} />
                  <Stat label="Pressure Skewed" value={diagnostics.liveSummary?.pressureSkewed ? "True (Skewed)" : "False"} />
                </div>
              </Card>

              {/* Event Logs & Debug Snapshots */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Recent Events */}
                <Card>
                  <CardHeader title="Recent Firmware Events" />
                  <div className="space-y-3 mt-2 max-h-80 overflow-y-auto pr-1">
                    {diagnostics.recentEvents.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">No events received.</p>
                    ) : (
                      diagnostics.recentEvents.map((evt) => (
                        <div key={evt.id} className="text-xs border-b border-gray-100 pb-2">
                          <div className="flex justify-between font-semibold text-gray-700">
                            <span>{evt.eventType}</span>
                            <span className="font-mono text-gray-400">{evt.eventId || "No ID"}</span>
                          </div>
                          <pre className="mt-1 bg-gray-50 p-1.5 rounded text-[10px] overflow-x-auto text-gray-600">
                            {JSON.stringify(evt.payload, null, 2)}
                          </pre>
                          <div className="text-[10px] text-gray-400 mt-1">
                            Received: {new Date(evt.receivedAt).toLocaleTimeString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                {/* Debug Snapshots */}
                <Card>
                  <CardHeader title="Debug Snapshots" />
                  <div className="space-y-3 mt-2 max-h-80 overflow-y-auto pr-1">
                    {diagnostics.debugSnapshots.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">No debug snapshots recorded.</p>
                    ) : (
                      diagnostics.debugSnapshots.map((snap) => (
                        <div key={snap.id} className="text-xs border-b border-gray-100 pb-2">
                          <pre className="bg-gray-50 p-2 rounded text-[10px] overflow-x-auto text-gray-600">
                            {JSON.stringify(snap.payload, null, 2)}
                          </pre>
                          <div className="text-[10px] text-gray-400 mt-1">
                            Captured: {new Date(snap.receivedAt).toLocaleTimeString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100/80">
      <span className="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">{label}</span>
      <span className="text-sm font-black text-slate-800 font-mono mt-1 block tracking-tight">{value}</span>
    </div>
  );
}

export default TechnicianDiagnosticsPage;
