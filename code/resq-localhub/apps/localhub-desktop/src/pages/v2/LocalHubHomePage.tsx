import { useEffect, useState } from "react";
import { getJson } from "../../api/localHubClient";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";

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

type LocalHubHomePageProps = {
  onOpenInstructorDashboard: () => void;
  onOpenTraineeDashboard: () => void;
};

export function LocalHubHomePage({
  onOpenInstructorDashboard,
  onOpenTraineeDashboard,
}: LocalHubHomePageProps) {
  const [health, setHealth] = useState<HubHealth | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, infoRes] = await Promise.all([
        getJson<HubHealth>("/api/hub/health"),
        getJson<ServiceInfo>("/api/hub/service-info"),
      ]);
      setHealth(healthRes);
      setServiceInfo(infoRes);
    } catch (err) {
      setError("Unable to communicate with the training system backend. Please verify that the ResQ LocalHub service is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 20000); // Poll every 20 seconds
    return () => clearInterval(interval);
  }, []);

  const isReady = health?.ok && serviceInfo?.ok;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Hero Welcome banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 sm:p-8 text-white shadow-md">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          Welcome to ResQ Training Hub
        </h1>
        <p className="mt-2 text-sm sm:text-base text-blue-100 max-w-2xl">
          Supervise CPR training sessions, run manikin readiness checks, and manage courses from this local station.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="success"
            className="font-semibold px-5 py-2.5 shadow-sm"
            onClick={onOpenInstructorDashboard}
          >
            Instructor Center
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="bg-white/10 hover:bg-white/20 border-transparent text-white font-semibold px-5 py-2.5"
            onClick={onOpenTraineeDashboard}
          >
            Trainee View
          </Button>
        </div>
      </div>

      {loading && !health ? (
        <LoadingState message="Checking system status..." />
      ) : error ? (
        <Card className="border-red-200 bg-red-50 text-red-800">
          <div className="flex gap-3 items-start">
            <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold">
              !
            </div>
            <div>
              <h3 className="font-bold text-base">Connection Issue</h3>
              <p className="text-sm mt-1 text-red-700">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 bg-white hover:bg-gray-50 border-red-200 text-red-800"
                onClick={loadStatus}
              >
                Retry Check
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Status Panel */}
          <Card className="md:col-span-2">
            <CardHeader
              title="Training Station Status"
              subtitle="Current operational readiness of the local hub system."
            />
            <div className="mt-4 flex items-center gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-xl shrink-0 font-bold ${
                  isReady ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                }`}
              >
                {isReady ? "✓" : "!"}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">
                  {isReady ? "Training System Ready" : "Training System Needs Attention"}
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {isReady
                    ? "The LocalHub server and database are operational. Manikins can connect and pair."
                    : "The system is running but some internal services may be initializing."}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-between items-center text-xs text-gray-400">
              <span>Last checked: {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : "Just now"}</span>
              <button
                type="button"
                className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
                onClick={loadStatus}
              >
                Refresh status
              </button>
            </div>
          </Card>

          {/* Quick Statistics/Info */}
          <Card>
            <CardHeader title="Access Guide" />
            <div className="space-y-4 mt-2">
              <div className="text-sm">
                <span className="font-semibold text-gray-700 block">System Mode</span>
                <p className="text-xs text-gray-500 mt-1">
                  The LocalHub is running in primary training mode. Ensure manikins are turned on and nearby.
                </p>
              </div>
              <div className="border-t border-gray-100 pt-3 text-sm">
                <span className="font-semibold text-gray-700 block">Device Role</span>
                <span className="mt-1 inline-block">
                  <StatusBadge tone="success" label="Local Server Console" dot={false} />
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default LocalHubHomePage;
