import { useEffect, useState, useMemo } from "react";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { fetchCourses } from "../../api/coursesApi";
import { fetchTrainees } from "../../api/traineesApi";
import { startSession, fetchCompletedSessions } from "../../api/sessionsApi";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { Course } from "../../types/course";
import type { TraineeRecord } from "../../types/trainee";
import type { CompletedSession } from "../../types/session";

// Import UI components
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import MetricTile from "../../components/ui/MetricTile";

// Import CPR components
import DeviceCard from "../../components/cpr/DeviceCard";
import { isDeviceReady, isSessionActive } from "../../utils/userFriendlyLabels";

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
  const [completedSessions, setCompletedSessions] = useState<CompletedSession[]>([]);
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
      const [manikinsRes, coursesRes, traineesRes, completedRes] = await Promise.all([
        fetchLiveManikins(),
        fetchCourses(),
        fetchTrainees(),
        fetchCompletedSessions().catch(() => []),
      ]);
      setManikins(manikinsRes);
      setCourses(coursesRes);
      setTrainees(traineesRes);
      setCompletedSessions(completedRes);
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

    // Sessions completed today
    const todayStr = new Date().toDateString();
    const sessionsToday = completedSessions.filter((s) => {
      if (!s.startedAt) return false;
      return new Date(s.startedAt).toDateString() === todayStr;
    }).length;

    return { total: manikins.length, ready, active, offline, sessionsToday };
  }, [manikins, completedSessions]);

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
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Instructor Dashboard"
        subtitle="Monitor connected manikins and manage live clinical training sessions."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onViewRecentSessions}>
              View Sessions
            </Button>
            <Button type="button" variant="primary" onClick={onPairNewManikin}>
              Pair Manikin
            </Button>
          </>
        }
      />

      {/* Summary Counts Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <MetricTile
          label="Ready Manikins"
          value={counts.ready}
          description="Ready for training sessions"
          tone="green"
        />
        <MetricTile
          label="Active Sessions"
          value={counts.active}
          description="Trainees currently practicing"
          tone="teal"
        />
        <MetricTile
          label="Needs Attention"
          value={counts.offline}
          description="Offline or calibration required"
          tone="slate"
        />
        <MetricTile
          label="Sessions Today"
          value={counts.sessionsToday}
          description="CPR practices completed today"
          tone="green"
        />
      </div>

      {/* Device Card Grid Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Paired Manikins</h2>
        </div>
        
        {manikins.length === 0 ? (
          <Card className="text-center py-16 max-w-xl mx-auto border border-dashed border-slate-200">
            <div className="text-slate-300 text-3xl font-black mb-3">◰</div>
            <p className="text-slate-500 text-sm font-semibold">No paired manikins found on this LocalHub.</p>
            <p className="text-slate-400 text-xs mt-1">Ensure you have a paired trainer hardware nearby.</p>
            <Button type="button" className="mt-6 font-bold" onClick={onPairNewManikin}>
              Pair Manikin
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {manikins.map((m) => (
              <DeviceCard
                key={m.deviceId}
                manikin={m}
                onRunReadinessCheck={onRunReadinessCheck}
                onOpenStartModal={(did) => {
                  setStartingForDevice(did);
                  setStartError(null);
                }}
                onViewSession={onStartSession}
              />
            ))}
          </div>
        )}
      </div>

      {/* Start Session Modal (Inline implementation with modern overlay) */}
      {startingForDevice && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="max-w-md w-full shadow-2xl animate-scaleUp border border-slate-100" padding="lg">
            <CardHeader
              title="Start CPR Training Session"
              subtitle={`Launch session for device: ${startingForDevice}`}
            />
            <form onSubmit={handleLaunchSession} className="space-y-5 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Select Course
                </label>
                <select
                  required
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="">-- Choose Course --</option>
                  {courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Select Trainee
                </label>
                <select
                  required
                  value={selectedTraineeId}
                  onChange={(e) => setSelectedTraineeId(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="">-- Choose Trainee --</option>
                  {trainees.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.displayName} ({t.traineeCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Scenario
                </label>
                <input
                  type="text"
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 focus:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Session Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 focus:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20 h-20 resize-none"
                  placeholder="Clinical notes or observations..."
                />
              </div>

              {startError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 leading-normal">
                  {startError}
                </div>
              )}

              <div className="flex gap-2.5 justify-end pt-4 border-t border-slate-100 mt-2">
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
