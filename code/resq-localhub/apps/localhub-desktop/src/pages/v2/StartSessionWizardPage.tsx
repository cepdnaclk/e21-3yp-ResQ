import { useEffect, useState } from "react";
import { fetchCourses, fetchCourseStudents } from "../../api/coursesApi";
import { fetchLiveManikins } from "../../api/manikinsApi";
import { fetchDeviceReadiness } from "../../api/firmwareApi";
import { startSession } from "../../api/sessionsApi";
import type { Course, CourseStudent } from "../../types/course";
import type { ManikinLiveSummary } from "../../types/manikin";
import type { FirmwareReadinessResponse } from "../../types/firmware";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import LoadingState from "../../components/ui/LoadingState";
import StatusBadge from "../../components/ui/StatusBadge";
import { subscribeToManikinsLive } from "../../api/liveEventsClient";
import { DeviceReadinessPanel } from "../../components/cpr/DeviceReadinessPanel";

export function StartSessionWizardPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lists data
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<CourseStudent[]>([]);
  const [manikins, setManikins] = useState<ManikinLiveSummary[]>([]);

  // Selection states
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedTrainee, setSelectedTrainee] = useState<CourseStudent | null>(null);
  const [selectedManikin, setSelectedManikin] = useState<ManikinLiveSummary | null>(null);

  // Scenario & notes
  const [scenario, setScenario] = useState("Adult CPR");
  const [notes, setNotes] = useState("");
  const [starting, setStarting] = useState(false);

  // Cached device readiness details (fetched on-demand)
  const [deviceReadiness, setDeviceReadiness] = useState<Record<string, FirmwareReadinessResponse | null>>({});
  const [loadingReadiness, setLoadingReadiness] = useState<Record<string, boolean>>({});

  // Helper to extract query parameters
  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [coursesRes, manikinsRes] = await Promise.all([
          fetchCourses(),
          fetchLiveManikins(),
        ]);
        setCourses(coursesRes);
        setManikins(manikinsRes);

        // Parse query params
        const params = new URLSearchParams(window.location.search);
        const preselectedCourseId = params.get("courseId");
        const preselectedTraineeId = params.get("traineeId");
        if (preselectedCourseId) {
          const foundCourse = coursesRes.find(
            (c) => (c.cloudCourseId || c.courseId || (c as any).id) === preselectedCourseId
          );
          if (foundCourse) {
            setSelectedCourse(foundCourse);
            const resolvedCourseId = foundCourse.cloudCourseId || foundCourse.courseId || (foundCourse as any).id;
            try {
              const studentsRes = await fetchCourseStudents(resolvedCourseId);
              setStudents(studentsRes);
              
              if (preselectedTraineeId) {
                const foundTrainee = studentsRes.find(
                  (s) => (s.cloudUserId || s.traineeId || (s as any).id || (s as any).userId || (s as any).username) === preselectedTraineeId
                );
                if (foundTrainee) {
                  setSelectedTrainee(foundTrainee);
                  setStep(3); // Jump directly to manikin selection
                } else {
                  setStep(2);
                }
              } else {
                setStep(2);
              }
            } catch (studentErr) {
              setError("Students could not be loaded. Run roster sync or check course assignments.");
            }
          }
        }
      } catch (err) {
        setError("Failed to load starting wizard context. Please check LocalHub backend connection.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Subscribe to SSE updates for manikins
  useEffect(() => {
    const subscription = subscribeToManikinsLive((updatedManikins) => {
      setManikins(updatedManikins);
    }, (err) => {
      console.warn("Manikins live stream interrupted, retrying...", err);
    });

    return () => {
      subscription.stop();
    };
  }, []);

  // Handle course selection
  async function handleSelectCourse(course: Course) {
    setSelectedCourse(course);
    setLoading(true);
    setError(null);
    const resolvedCourseId = course.cloudCourseId || course.courseId || (course as any).id;
    try {
      const studentsRes = await fetchCourseStudents(resolvedCourseId);
      setStudents(studentsRes);
      setStep(2);
    } catch (err) {
      setError("Students could not be loaded. Run roster sync or check course assignments.");
    } finally {
      setLoading(false);
    }
  }

  // Handle student selection
  function handleSelectTrainee(student: CourseStudent) {
    setSelectedTrainee(student);
    setStep(3);
  }

  // Check if a specific manikin is ready (Correction 4)
  function isManikinReady(m: ManikinLiveSummary) {
    if (m.online && !m.offline && !m.stale) {
      if (m.state === "READY_FOR_SESSION" || (m as any).readyForSession === true) return true;
    }
    return false;
  }

  // Handle device selection
  async function handleSelectManikin(m: ManikinLiveSummary) {
    setSelectedManikin(m);
    setStep(4);
  }

  // Handle Start Session launch (Correction 5 & 6)
  async function handleLaunchSession() {
    if (!selectedManikin || !selectedCourse || !selectedTrainee) return;

    // Find the latest live state of the manikin from the live list
    const liveM = manikins.find((m) => m.deviceId === selectedManikin.deviceId);
    const online = liveM?.online && !liveM?.offline && !liveM?.stale;

    if (!online) {
      setError("Cannot start training: manikin must be online.");
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const readiness = await fetchDeviceReadiness(selectedManikin.deviceId);
      const isReady = readiness.firmwareState === "READY_FOR_SESSION" && readiness.readyForSession === true;
      if (!isReady) {
        setError("Cannot start training: manikin must be in READY_FOR_SESSION state and successfully calibrated.");
        setStarting(false);
        return;
      }
    } catch (err) {
      setError("Failed to verify manikin readiness. Please try again.");
      setStarting(false);
      return;
    }

    const resolvedCourseId = selectedCourse.cloudCourseId || selectedCourse.courseId || (selectedCourse as any).id;
    const resolvedTraineeId =
      selectedTrainee.cloudUserId ||
      selectedTrainee.traineeId ||
      (selectedTrainee as any).id ||
      (selectedTrainee as any).userId ||
      (selectedTrainee as any).username;

    try {
      const res = await startSession({
        deviceId: selectedManikin.deviceId,
        courseId: resolvedCourseId,
        traineeId: resolvedTraineeId,
        scenario: scenario,
        notes: notes,
      });

      // Navigate to detailed instructor live page
      window.history.pushState({}, "", `/instructor/sessions/${res.sessionId}/live`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError("Could not start the session. Check course, trainee, and manikin readiness.");
      setStarting(false);
    }
  }


  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  if (loading) {
    return <LoadingState message="Loading training launch wizard..." />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 select-none">
      <PageHeader
        title="Start Training Session"
        subtitle="Configure and start a supervised real-time CPR session."
        actions={
          <Button type="button" variant="secondary" onClick={() => navigateTo("/")}>
            Cancel Wizard
          </Button>
        }
      />

      {/* Step Indicators */}
      <div className="flex items-center justify-between max-w-lg mx-auto bg-white border border-slate-100 p-4.5 rounded-2xl shadow-sm">
        {[1, 2, 3, 4, 5].map((s) => {
          const labels = ["Course", "Trainee", "Manikin", "Pre-Check", "Launch"];
          const isActive = step === s;
          const isDone = step > s;

          return (
            <div key={s} className="flex flex-col items-center gap-1.5 flex-1 relative">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border transition-all ${
                  isActive
                    ? "bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-500/20"
                    : isDone
                    ? "bg-teal-50 border-teal-100 text-teal-600"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                {isDone ? "✓" : s}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? "text-teal-600 font-extrabold" : "text-slate-400"}`}>
                {labels[s - 1]}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <Card className="border-rose-100 bg-rose-50/50 p-6 text-rose-800 text-center max-w-md mx-auto">
          <p className="text-sm font-semibold">{error}</p>
        </Card>
      )}

      {/* STEP 1: Select Course */}
      {step === 1 && (
        <div className="space-y-4 animate-fadeIn">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center">Step 1 — Select a Classroom Course</h3>
          {courses.length === 0 ? (
            <Card className="text-center py-12 max-w-md mx-auto">
              <p className="text-slate-500 text-sm font-semibold">No courses assigned yet. Ask the LocalHub admin to sync the roster or assign you to a course.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {courses.map((course) => {
                const resolvedId = course.cloudCourseId || course.courseId || (course as any).id;
                return (
                  <button
                    key={resolvedId}
                    type="button"
                    onClick={() => handleSelectCourse(course)}
                    className="text-left w-full hover:scale-[1.01] transition-transform"
                  >
                    <Card className="border border-slate-100 hover:border-teal-500 hover:shadow-md cursor-pointer transition-colors p-6">
                      <span className="text-[10px] font-extrabold bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-100 uppercase tracking-wider">
                        {course.courseCode || "CPR-COURSE"}
                      </span>
                      <h4 className="text-sm font-black text-slate-800 mt-3">{course.title || course.name}</h4>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Select Trainee */}
      {step === 2 && selectedCourse && (
        <div className="space-y-4 animate-fadeIn">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center">
            Step 2 — Select Trainee for {selectedCourse.courseCode || "Course"}
          </h3>
          {students.length === 0 ? (
            <Card className="text-center py-12 max-w-md mx-auto space-y-4">
              <p className="text-slate-550 text-sm font-bold text-rose-700">No trainees are enrolled in this course yet.</p>
              <Button type="button" variant="secondary" className="mt-4" onClick={() => setStep(1)}>
                Back to Courses
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {students.map((student) => {
                const resolvedTraineeId =
                  student.cloudUserId ||
                  student.traineeId ||
                  (student as any).id ||
                  (student as any).userId ||
                  (student as any).username;
                return (
                  <button
                    key={resolvedTraineeId}
                    type="button"
                    onClick={() => handleSelectTrainee(student)}
                    className="text-left w-full hover:scale-[1.01] transition-transform"
                  >
                    <Card className="border border-slate-100 hover:border-teal-500 hover:shadow-md cursor-pointer transition-colors p-4">
                      <div className="font-bold text-slate-800 text-xs">{student.displayName}</div>
                      {student.email && <div className="text-[10px] text-slate-400 mt-1 font-medium">{student.email}</div>}
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-start">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              Back to Courses
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Select Manikin */}
      {step === 3 && selectedCourse && selectedTrainee && (
        <div className="space-y-4 animate-fadeIn">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center">
            Step 3 — Select a Manikin Device
          </h3>
          {manikins.length === 0 ? (
            <Card className="text-center py-12 max-w-md mx-auto space-y-4">
              <p className="text-slate-650 text-sm font-bold">No manikins available. Please pair a manikin first.</p>
              <div className="flex gap-2.5 justify-center">
                <Button type="button" variant="secondary" onClick={() => setStep(2)}>
                  Back to Trainee
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  className="text-white font-bold"
                  onClick={() => navigateTo("/instructor/pair")}
                >
                  Pair Manikin
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {manikins.map((m) => {
                const isSelected = selectedManikin?.deviceId === m.deviceId;
                const ready = isManikinReady(m);
                const online = m.online && !m.offline && !m.stale;

                return (
                  <button
                    key={m.deviceId}
                    type="button"
                    onClick={() => handleSelectManikin(m)}
                    className="text-left w-full transition-transform hover:scale-[1.01] cursor-pointer"
                  >
                    <Card
                      className={`border cursor-pointer transition-all p-5 flex flex-col justify-between h-32 ${
                        isSelected
                          ? "border-teal-600 bg-teal-50/10 shadow-sm"
                          : "border-slate-100 hover:border-slate-300"
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-xs text-slate-800">{m.deviceId}</span>
                          {ready ? (
                            <StatusBadge tone="success" label="Ready" dot={true} />
                          ) : online ? (
                            <StatusBadge tone="warning" label="Needs Pre-Check" dot={true} />
                          ) : (
                            <StatusBadge tone="muted" label="Offline" dot={false} />
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 font-medium">
                          {online ? "Online & connected" : "Offline / Unreachable"}
                        </p>
                      </div>
                      {!ready && online && (
                        <p className="text-[9px] text-amber-600 font-bold mt-1">
                          Pre-check pre-requisite. Setup and calibrate in the next step.
                        </p>
                      )}
                    </Card>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-between mt-6">
            <Button type="button" variant="secondary" onClick={() => setStep(2)}>
              Back to Trainee
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!selectedManikin}
              onClick={() => setStep(4)}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: Calibration Pre-Check */}
      {step === 4 && selectedCourse && selectedTrainee && selectedManikin && (
        <div className="space-y-4 animate-fadeIn">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center font-bold">
            Step 4 — Manikin Calibration Pre-Check
          </h3>
          <DeviceReadinessPanel
            deviceId={selectedManikin.deviceId}
            liveSummary={manikins.find((m) => m.deviceId === selectedManikin.deviceId) || selectedManikin}
            onContinue={() => setStep(5)}
            continueLabel="Continue to Launch"
            showBack={true}
            onBack={() => setStep(3)}
          />
        </div>
      )}

      {/* STEP 5: Confirm and Launch */}
      {step === 5 && selectedCourse && selectedTrainee && selectedManikin && (
        <div className="max-w-md mx-auto space-y-6 animate-fadeIn">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider text-center font-bold">Step 5 — Confirm Session Settings</h3>
          <Card className="p-6 space-y-4">
            <div className="space-y-3">
              <div>
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Selected Course</span>
                <span className="text-xs font-bold text-slate-800 block mt-0.5">{selectedCourse.title || selectedCourse.name}</span>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Trainee Name</span>
                <span className="text-xs font-bold text-slate-800 block mt-0.5">{selectedTrainee.displayName}</span>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Device / Manikin ID</span>
                <span className="text-xs font-bold text-slate-800 block mt-0.5">{selectedManikin.deviceId}</span>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Scenario Template
                </label>
                <input
                  type="text"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 focus:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Supervisor Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 focus:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20 h-24 resize-none"
                  placeholder="E.g. clinical remarks or custom checklist rules..."
                />
              </div>
            </div>
          </Card>

          <div className="flex justify-between">
            <Button type="button" variant="secondary" onClick={() => setStep(4)}>
              Back to Pre-Check
            </Button>
            {(() => {
              const liveM = manikins.find((m) => m.deviceId === selectedManikin.deviceId);
              const isLaunchEnabled = liveM ? isManikinReady(liveM) : false;
              return (
                <Button
                  type="button"
                  variant="primary"
                  loading={starting}
                  disabled={!isLaunchEnabled}
                  onClick={handleLaunchSession}
                  className="text-white"
                >
                  Start Live Session
                </Button>
              );
            })()}
          </div>

        </div>
      )}
    </div>
  );
}

export default StartSessionWizardPage;
