import { useEffect, useState } from "react";
import { getJson } from "../../api/localHubClient";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import LoadingState from "../../components/ui/LoadingState";
import ActionTile from "../../components/ui/ActionTile";
import { useAuth } from "../../auth/AuthContext";

type HubHealth = {
  ok: boolean;
  service: string;
  timestamp: string;
};

type LocalHubHomePageProps = {
  onOpenInstructorDashboard: () => void;
  onOpenTraineeDashboard: () => void;
};

export function LocalHubHomePage({
  onOpenInstructorDashboard,
  onOpenTraineeDashboard,
}: LocalHubHomePageProps) {
  const { currentUser } = useAuth();
  const [health, setHealth] = useState<HubHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const healthRes = await getJson<HubHealth>("/api/hub/health");
      setHealth(healthRes);
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

  // Manual navigations matching AppShell routing actions
  const navigateTo = (path: string) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const isReady = health?.ok === true;

  if (loading && !health) {
    return <LoadingState message="Checking local server status..." />;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Welcome Hero Banner */}
      <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-indigo-900 rounded-3xl p-8 sm:p-10 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-extrabold bg-white/20 text-white px-3 py-1.5 rounded-full uppercase tracking-wider inline-block">
              System Console
            </span>
            {isReady ? (
              <StatusBadge tone="success" label="LocalHub Ready" className="bg-white/20 text-white border-transparent" />
            ) : (
              <StatusBadge tone="warning" label="Needs Attention" className="bg-white/20 text-white border-transparent" />
            )}
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl leading-tight">
            Welcome back, {currentUser?.displayName ?? "Instructor"}
          </h1>
          <p className="text-sm sm:text-base text-teal-100/90 max-w-xl font-normal leading-relaxed">
            Ready to start CPR training. Select a course, prepare a manikin, or review recent sessions.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <Button
            type="button"
            variant="primary"
            className="font-bold px-6 py-3 shadow-md text-white text-sm"
            onClick={() => navigateTo("/start-session")}
          >
            Start Training
          </Button>
          {currentUser?.role === "ADMIN" && (
            <Button
              type="button"
              variant="secondary"
              className="bg-white/10 hover:bg-white/20 border-transparent text-white font-bold px-6 py-3 text-sm"
              onClick={onOpenTraineeDashboard}
            >
              Trainee View
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card className="border-rose-100 bg-rose-50/50 text-rose-800">
          <div className="flex gap-4 items-start">
            <div className="shrink-0 w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-black text-lg">
              !
            </div>
            <div>
              <h3 className="font-bold text-base text-rose-900 leading-tight">Connection Issue</h3>
              <p className="text-sm mt-1.5 text-rose-700 leading-relaxed">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4 bg-white border-rose-200/60 hover:bg-rose-50 text-rose-800 font-bold"
                onClick={loadStatus}
              >
                Retry System Check
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Quick Menu Grid */}
          <div className="space-y-3.5">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <ActionTile
                title="My Courses"
                description="View assigned classroom courses and rosters."
                onClick={() => navigateTo("/courses")}
                variant="primary"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.168.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                }
              />
              <ActionTile
                title="Start Training"
                description="Launch a guided wizard to pair students with ready manikins."
                onClick={() => navigateTo("/start-session")}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              <ActionTile
                title="Active Sessions"
                description="Monitor running CPR practices and view student performance."
                onClick={() => navigateTo("/live-sessions")}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                }
              />
              <ActionTile
                title="Manikins Directory"
                description="Pair devices, run readiness checks, and manage hardware settings."
                onClick={onOpenInstructorDashboard}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                }
              />
              <ActionTile
                title="Session History"
                description="Review completed training logs and download session reports."
                onClick={() => navigateTo("/sessions")}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 012 2v3m-6-3a1 1 0 11-2 0 1 1 0 012 0zm7-2a1 1 0 11-2 0 1 1 0 012 0z" />
                  </svg>
                }
              />
              {currentUser?.role === "ADMIN" && (
                <ActionTile
                  title="Diagnostics Console"
                  description="Troubleshoot wireless signal, battery levels, and raw telemetry streams."
                  onClick={() => navigateTo("/diagnostics")}
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  }
                />
              )}
              {currentUser?.role === "ADMIN" && (
                <ActionTile
                  title="User Management"
                  description="Create administrative and instructor credentials."
                  onClick={() => navigateTo("/admin/users")}
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LocalHubHomePage;
