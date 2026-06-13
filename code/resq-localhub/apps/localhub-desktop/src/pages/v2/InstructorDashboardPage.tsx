import { useEffect, useState, useMemo } from "react";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { fetchCourses } from "../../api/coursesApi";
import { fetchTrainees } from "../../api/traineesApi";
import { startSession } from "../../api/sessionsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { Course } from "../../types/course";
import type { TraineeRecord } from "../../types/trainee";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import {
  getDeviceStateLabel,
  getDeviceStateTone,
  isDeviceReady,
  isSessionActive,
} from "../../utils/userFriendlyLabels";

type InstructorDashboardPageProps = {
  onStartSession: (sessionId: string) => void;
  onRunReadinessCheck: (deviceId: string) => void;
  onPairNewManikin: () => void;
  onViewRecentSessions: () => void;
};

export function InstructorDashboardPage({
  onStartSession,
  onRunReadinessCheck,
  onPairNewManikin,
  onViewRecentSessions,
}: InstructorDashboardPageProps) {
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [trainees, setTrainees] = useState<TraineeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingForDevice, setStartingForDevice] = useState<string | null>(null);

  // Start session form states
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedTraineeId, setSelectedTraineeId] = useState("");
  const [selectedScenario, setSelectedScenario] = useState("Standard CPR");
  const [notes, setNotes] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [startLoading, setStartLoading] = useState(false);

  // Load initial data
  async function loadInitialData() {
    try {
      const [manikinsRes, coursesRes, traineesRes] = await Promise.all([
        fetchLiveManikins(),
        fetchCourses(),
        fetchTrainees(),
      ]);
      setManikins(manikinsRes);
      setCourses(coursesRes);
      setTrainees(traineesRes);
    } catch (err) {
      console.error("Failed to load initial dashboard data", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialData();

    // Subscribe to SSE updates for manikins
    const subscription = subscribeToManikinsLive((updatedManikins) => {
      setManikins(updatedManikins);
    }, (err) => {
      console.warn("Manikins live stream interrupted, retrying...", err);
    });

    return () => {
      subscription.stop();
    };
  }, []);

  const counts = useMemo(() => {
    let ready = 0;
    let active = 0;
    let offline = 0;

    manikins.forEach((m) => {
      if (!m.online || m.offline) {
        offline++;
      } else if (isSessionActive(m.state, m.sessionActive)) {
        active++;
      } else if (isDeviceReady(m.state, m.online, m.stale, m.offline)) {
        ready++;
      }
    });

    return { total: manikins.length, ready, active, offline };
  }, [manikins]);

  async function handleLaunchSession(e: React.FormEvent) {
    e.preventDefault();
    if (!startingForDevice || !selectedCourseId || !selectedTraineeId) return;

    setStartLoading(true);
    setStartError(null);

    try {
      const res = await startSession({
        deviceId: startingForDevice,
        courseId: selectedCourseId,
        traineeId: selectedTraineeId,
        scenario: selectedScenario,
        notes: notes,
      });
      onStartSession(res.sessionId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start the session.");
    } finally {
      setStartLoading(false);
    }
  }

  if (loading) {
    return <LoadingState message="Loading instructor dashboard..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Instructor Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Manage connected devices and initiate training sessions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onViewRecentSessions}>
            View Recent Sessions
          </Button>
          <Button type="button" variant="secondary" onClick={onPairNewManikin}>
            Pair New Manikin
          </Button>
        </div>
      </div>

      {/* Summary Counts Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card padding="sm" className="text-center">
          <div className="text-2xl font-bold text-gray-900">{counts.total}</div>
          <div className="text-xs text-gray-500 font-medium uppercase mt-0.5">Total Manikins</div>
        </Card>
        <Card padding="sm" className="text-center border-green-200 bg-green-50/50">
          <div className="text-2xl font-bold text-green-700">{counts.ready}</div>
          <div className="text-xs text-green-600 font-medium uppercase mt-0.5">Ready</div>
        </Card>
        <Card padding="sm" className="text-center border-blue-200 bg-blue-50/50">
          <div className="text-2xl font-bold text-blue-700">{counts.active}</div>
          <div className="text-xs text-blue-600 font-medium uppercase mt-0.5">Active Session</div>
        </Card>
        <Card padding="sm" className="text-center border-gray-200 bg-gray-50">
          <div className="text-2xl font-bold text-gray-600">{counts.offline}</div>
          <div className="text-xs text-gray-500 font-medium uppercase mt-0.5">Offline</div>
        </Card>
      </div>

      {/* Device grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {manikins.length === 0 ? (
          <div className="md:col-span-3">
            <Card className="text-center py-12">
              <p className="text-gray-500 text-sm">No paired manikins found.</p>
              <Button type="button" className="mt-4" onClick={onPairNewManikin}>
                Pair your first manikin
              </Button>
            </Card>
          </div>
        ) : (
          manikins.map((m) => {
            const isOnline = m.online && !m.offline;
            const isReadyDevice = isDeviceReady(m.state, m.online, m.stale, m.offline);
            const isActive = isSessionActive(m.state, m.sessionActive);
            const displayState = isOnline ? (isActive ? "SESSION_ACTIVE" : m.state) : "offline";

            return (
              <Card key={m.deviceId} className="flex flex-col justify-between hover:border-gray-300 transition-all">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <span className="font-bold text-gray-800 tracking-tight font-mono">{m.deviceId}</span>
                    <StatusBadge
                      tone={getDeviceStateTone(displayState)}
                      label={getDeviceStateLabel(displayState)}
                    />
                  </div>

                  <div className="space-y-1.5 text-sm text-gray-600">
                    <div className="flex justify-between">
                      <span>Connection:</span>
                      <span className="font-semibold text-gray-800">
                        {isOnline ? (m.stale ? "Signal Weak" : "Good") : "Disconnected"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-3 mt-4 flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onRunReadinessCheck(m.deviceId)}
                  >
                    Readiness Check
                  </Button>
                  {isReadyDevice && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setStartingForDevice(m.deviceId);
                        setStartError(null);
                      }}
                    >
                      Start Session
                    </Button>
                  )}
                  {isActive && m.activeSessionId && (
                    <Button
                      type="button"
                      variant="success"
                      size="sm"
                      onClick={() => onStartSession(m.activeSessionId!)}
                    >
                      View Session
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Start Session Modal (Inline implementation) */}
      {startingForDevice && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <Card className="max-w-md w-full" padding="lg">
            <CardHeader
              title="Start CPR Training Session"
              subtitle={`Launch session for device: ${startingForDevice}`}
            />
            <form onSubmit={handleLaunchSession} className="space-y-4 mt-2">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Select Course
                </label>
                <select
                  required
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                >
                  <option value="">-- Select Course --</option>
                  {courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Select Trainee
                </label>
                <select
                  required
                  value={selectedTraineeId}
                  onChange={(e) => setSelectedTraineeId(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                >
                  <option value="">-- Select Trainee --</option>
                  {trainees.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.displayName} ({t.traineeCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Scenario
                </label>
                <input
                  type="text"
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Session Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white h-20"
                  placeholder="Optional notes..."
                />
              </div>

              {startError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                  {startError}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setStartingForDevice(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={startLoading}>
                  Start Live Session
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

export default InstructorDashboardPage;
