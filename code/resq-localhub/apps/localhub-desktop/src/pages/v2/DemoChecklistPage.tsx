import { useEffect, useState } from "react";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { fetchCourses } from "../../api/coursesApi";
import { fetchCompletedSessions } from "../../api/sessionsApi";
import { getJson } from "../../api/localHubClient";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { Course } from "../../types/course";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";

type HubHealth = {
  ok: boolean;
  service: string;
  timestamp: string;
  mqtt_connected?: boolean;
};

type DemoChecklistPageProps = {
  navigate: (path: string) => void;
};

export function V2DemoChecklistPage({ navigate }: DemoChecklistPageProps) {
  const [health, setHealth] = useState<HubHealth | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);
  const [reportsOk, setReportsOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    try {
      const [healthRes, coursesRes, manikinsRes, sessionsRes] = await Promise.all([
        getJson<HubHealth>("/api/hub/health").catch(() => null),
        fetchCourses().catch(() => []),
        fetchLiveManikins().catch(() => []),
        fetchCompletedSessions().then(() => true).catch(() => false),
      ]);

      setHealth(healthRes);
      setCourses(coursesRes);
      setManikins(manikinsRes);
      setReportsOk(sessionsRes);
    } catch (err) {
      console.warn("Error checking system readiness:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
  }

  if (loading) {
    return <LoadingState message="Running demo checklist audit..." />;
  }

  const onlineManikins = manikins.filter((m) => m.online && !m.offline);
  const readyManikins = onlineManikins.filter((m) => m.state === "READY_FOR_SESSION");
  const failedManikins = onlineManikins.filter((m) => m.state === "CALIBRATION_FAIL");

  // Checklist Items Calculations
  const checkHub = health?.ok === true;
  const checkTelemetry = health?.mqtt_connected === true;
  const checkRoster = courses.length > 0;
  const checkManikinOnline = onlineManikins.length > 0;
  const checkReadinessPassed = readyManikins.length > 0;
  const checkFlowReady = checkRoster && checkReadinessPassed;
  const checkReportsSaving = reportsOk === true;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <PageHeader
        title="Demo Readiness Checklist"
        subtitle="Verify the end-to-end simulation setup, roster replication, and local hub operational state."
        actions={
          <Button type="button" variant="secondary" loading={refreshing} onClick={handleRefresh}>
            Refresh Checklist
          </Button>
        }
      />

      {/* Demo Fallback Note */}
      <Card className="border-sky-100 bg-sky-50 text-sky-800 rounded-3xl p-6">
        <div className="flex gap-4 items-start">
          <div className="shrink-0 w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-black text-lg">
            ℹ
          </div>
          <div>
            <h3 className="font-bold text-base text-sky-900 leading-tight">Demo Mode Simulation</h3>
            <p className="text-sm mt-1.5 text-sky-700 leading-relaxed font-semibold">
              Demo mode is not enabled. Use the real manikin or firmware simulator for live metrics.
            </p>
          </div>
        </div>
      </Card>

      {/* Checklist Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. LocalHub is running */}
        <Card padding="lg" className="flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-800">LocalHub Service</h3>
                <p className="text-xs text-slate-400 mt-1">Status of the local server process and telemetry engine.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full border text-xs font-bold ${
                  checkHub && checkTelemetry
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : checkHub
                    ? "bg-amber-50 text-amber-700 border-amber-100"
                    : "bg-rose-50 text-rose-700 border-rose-100"
                }`}
              >
                {checkHub && checkTelemetry
                  ? "Running & Connected"
                  : checkHub
                  ? "Running (Degraded)"
                  : "Unreachable"}
              </span>
            </div>

            <div className="mt-6 space-y-3.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${checkHub ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span>LocalHub Server: {checkHub ? "Online" : "Offline / Check system service"}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${checkTelemetry ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span>Telemetry Engine: {checkTelemetry ? "Active" : "Offline / Restart broker service"}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* 2. Roster is available */}
        <Card padding="lg" className="flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-800">Classroom Roster</h3>
                <p className="text-xs text-slate-400 mt-1">Course structures and trainee accounts for assignments.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full border text-xs font-bold ${
                  checkRoster
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : "bg-amber-50 text-amber-700 border-amber-100"
                }`}
              >
                {checkRoster ? "Roster Ready" : "No Courses"}
              </span>
            </div>

            <div className="mt-6 space-y-3.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${checkRoster ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span>Active Classroom Courses: {courses.length} courses mapped</span>
              </div>
            </div>
          </div>

          {!checkRoster && (
            <div className="pt-6 border-t border-slate-100 mt-6 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate("/admin/sync")}
                className="font-bold text-xs"
              >
                Go to Sync Dashboard
              </Button>
            </div>
          )}
        </Card>

        {/* 3. Manikin is online */}
        <Card padding="lg" className="flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-800">Manikin Online</h3>
                <p className="text-xs text-slate-400 mt-1">State of wireless training manikin links.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full border text-xs font-bold ${
                  checkManikinOnline
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : "bg-amber-50 text-amber-700 border-amber-100"
                }`}
              >
                {checkManikinOnline ? "Connected" : "No Manikins"}
              </span>
            </div>

            <div className="mt-6 space-y-3.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${checkManikinOnline ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span>Active Trainer Links: {onlineManikins.length} devices online</span>
              </div>
              {onlineManikins.map((m) => (
                <div key={m.deviceId} className="pl-4 text-[11px] text-slate-500 font-medium">
                  • {m.deviceId} — Battery: {m.battery ?? "—"}% | Signal: {m.rssi ?? "—"} dBm
                </div>
              ))}
            </div>
          </div>

          {!checkManikinOnline && (
            <div className="pt-6 border-t border-slate-100 mt-6 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate("/instructor")}
                className="font-bold text-xs"
              >
                Pair New Manikin
              </Button>
            </div>
          )}
        </Card>

        {/* 4. Readiness check passed */}
        <Card padding="lg" className="flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-800">Readiness Check</h3>
                <p className="text-xs text-slate-400 mt-1">Calibration status and readiness tests of trainer sensors.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full border text-xs font-bold ${
                  checkReadinessPassed
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : failedManikins.length > 0
                    ? "bg-rose-50 text-rose-700 border-rose-100"
                    : "bg-amber-50 text-amber-700 border-amber-100"
                }`}
              >
                {checkReadinessPassed
                  ? "Passed"
                  : failedManikins.length > 0
                  ? "Calibration Failed"
                  : "Needs Calibration"}
              </span>
            </div>

            <div className="mt-6 space-y-3.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    checkReadinessPassed
                      ? "bg-emerald-500"
                      : failedManikins.length > 0
                      ? "bg-rose-500"
                      : "bg-amber-500"
                  }`}
                />
                <span>
                  {checkReadinessPassed
                    ? "Manikin is calibrated and ready for session"
                    : failedManikins.length > 0
                    ? "Calibration error detected. Re-calibrate hardware."
                    : "Calibrate device sensors before starting training."}
                </span>
              </div>
            </div>
          </div>

          {onlineManikins.length > 0 && !checkReadinessPassed && (
            <div className="pt-6 border-t border-slate-100 mt-6 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/instructor/manikins/${onlineManikins[0].deviceId}/readiness`)}
                className="font-bold text-xs"
              >
                Run Readiness Check
              </Button>
            </div>
          )}
        </Card>

        {/* 5. Training flow ready */}
        <Card padding="lg" className="flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-800">Training Flow State</h3>
                <p className="text-xs text-slate-400 mt-1">Verification of the complete pipeline prerequisite checks.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full border text-xs font-bold ${
                  checkFlowReady
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : "bg-amber-50 text-amber-700 border-amber-100"
                }`}
              >
                {checkFlowReady ? "Flow Ready" : "Pending Setup"}
              </span>
            </div>

            <div className="mt-6 space-y-3.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${checkFlowReady ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span>
                  {checkFlowReady
                    ? "Ready to run active session simulation."
                    : "Requires an online manikin in 'Ready' state and at least one class roster available."}
                </span>
              </div>
            </div>
          </div>

          {checkFlowReady && (
            <div className="pt-6 border-t border-slate-100 mt-6 flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => navigate("/start-session")}
                className="font-bold text-xs shadow-md"
              >
                Start Session Wizard
              </Button>
            </div>
          )}
        </Card>

        {/* 6. Reports are saving */}
        <Card padding="lg" className="flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-black text-slate-800">Database Storage</h3>
                <p className="text-xs text-slate-400 mt-1">Checks local SQL storage reliability for session summaries.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full border text-xs font-bold ${
                  checkReportsSaving
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : "bg-rose-50 text-rose-700 border-rose-100"
                }`}
              >
                {checkReportsSaving ? "Healthy" : "Storage Fail"}
              </span>
            </div>

            <div className="mt-6 space-y-3.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${checkReportsSaving ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span>Completed Sessions Database: {checkReportsSaving ? "Writable & Storing" : "Read/Write Fail"}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default V2DemoChecklistPage;
