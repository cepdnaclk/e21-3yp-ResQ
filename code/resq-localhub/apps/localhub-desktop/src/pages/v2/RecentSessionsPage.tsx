import { useEffect, useState } from "react";
import { fetchCompletedSessions } from "../../api/sessionsApi";
import type { CompletedSession } from "../../types/session";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  formatDateTime,
  formatDuration,
  getScoreLabel,
  getScoreTone,
} from "../../utils/userFriendlyLabels";

type RecentSessionsPageProps = {
  onSelectSession: (sessionId: string) => void;
};

export function RecentSessionsPage({ onSelectSession }: RecentSessionsPageProps) {
  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCompletedSessions();
      setSessions(data);
    } catch (err) {
      setError("Failed to retrieve completed session history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, []);

  if (loading) {
    return <LoadingState message="Loading session history..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session History"
        subtitle="Review past CPR training performance and export report logs."
      />

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-red-800">
          <p className="text-sm font-semibold">{error}</p>
          <Button variant="secondary" size="sm" className="mt-3 bg-white" onClick={loadSessions}>
            Retry Load
          </Button>
        </Card>
      )}

      {!error && sessions.length === 0 ? (
        <Card className="text-center py-16">
          <p className="text-gray-500 text-sm">No completed training sessions found.</p>
        </Card>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Trainee
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Performance Score
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 text-sm text-gray-600">
                {sessions.map((s) => {
                  const score = s.summary?.score ?? 0;
                  const scoreTone = getScoreTone(score);
                  const label = getScoreLabel(score);
                  const badgeTone: "success" | "info" | "warning" | "danger" | "muted" =
                    scoreTone === "excellent"
                      ? "success"
                      : scoreTone === "good"
                      ? "info"
                      : scoreTone === "fair"
                      ? "warning"
                      : "danger";

                  return (
                    <tr key={s.sessionId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                        {s.traineeId || "Anonymous"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {formatDateTime(s.startedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {formatDuration(s.summary?.durationSeconds)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">{score}%</span>
                          <StatusBadge tone={badgeTone} label={label} dot={false} />
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelectSession(s.sessionId)}
                        >
                          Review details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecentSessionsPage;
