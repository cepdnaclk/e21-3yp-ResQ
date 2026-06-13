import { useEffect, useState } from "react";
import { fetchCompletedSession } from "../../api/sessionsApi";
import { downloadSessionJson, downloadSessionCsv } from "../../api/exportsApi";
import type { CompletedSession } from "../../types/session";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import { CompressionQualitySummary } from "../../components/cpr/CompressionQualitySummary";

type SessionReviewPageProps = {
  sessionId: string;
  onBack: () => void;
};

export function SessionReviewPage({ sessionId, onBack }: SessionReviewPageProps) {
  const [session, setSession] = useState<CompletedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const data = await fetchCompletedSession(sessionId);
        setSession(data);
      } catch (err) {
        setError("Failed to load session details.");
      } finally {
        setLoading(false);
      }
    }
    loadSession();
  }, [sessionId]);

  if (loading) {
    return <LoadingState message="Loading training session review..." />;
  }

  if (error || !session) {
    return (
      <Card className="text-center max-w-lg mx-auto py-12">
        <h3 className="text-lg font-bold text-gray-900">Review Unavailable</h3>
        <p className="text-sm text-gray-500 mt-1">{error || "Unable to load session."}</p>
        <Button type="button" className="mt-6" onClick={onBack}>
          Back to History
        </Button>
      </Card>
    );
  }

  // Derive simple suggestions/improvement areas based on metrics
  const summary = session.summary;
  let improvementArea = "Excellent performance! Maintain consistent rhythm and chest recoil.";
  if (summary.avgDepthMm && summary.avgDepthMm < 45) {
    improvementArea = "Focus on compressing deeper to reach the target range of 50-60 mm.";
  } else if (summary.avgDepthMm && summary.avgDepthMm > 65) {
    improvementArea = "Reduce compression depth slightly to avoid excessive pressure.";
  } else if (summary.avgRateCpm && summary.avgRateCpm < 100) {
    improvementArea = "Speed up compressions slightly to maintain a steady rhythm of 100-120 compressions per minute.";
  } else if (summary.avgRateCpm && summary.avgRateCpm > 125) {
    improvementArea = "Slow down compressions slightly. Keep within the recommended rate of 100-120 per minute.";
  } else if (summary.recoilPct && summary.recoilPct < 85) {
    improvementArea = "Ensure you fully release the chest between compressions to allow correct heart refilling.";
  } else if (summary.pausesCount > 2) {
    improvementArea = "Minimize interruptions or pauses during CPR cycles.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Training Session Review"
        subtitle={`Session for trainee: ${session.traineeId || "Anonymous"}`}
        back={{ label: "Back to History", onClick: onBack }}
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadSessionCsv(sessionId)}
            >
              Export CSV Session Report
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadSessionJson(sessionId)}
            >
              Export JSON Session Report
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Quality Summary Grid */}
        <div className="md:col-span-2 space-y-6">
          <Card>
            <h3 className="text-base font-semibold text-gray-900 mb-4">Performance Metrics</h3>
            <CompressionQualitySummary summary={summary} />
          </Card>
        </div>

        {/* Actionable Insights */}
        <div className="space-y-6">
          <Card className="border-blue-100 bg-blue-50/50">
            <h3 className="text-base font-bold text-blue-900 mb-2">Key Improvement Area</h3>
            <p className="text-sm text-blue-800 leading-relaxed">{improvementArea}</p>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2 mb-3">Session Metadata</h3>
            <div className="space-y-2.5 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Start Time:</span>
                <span className="font-semibold text-gray-900">{new Date(session.startedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>End Time:</span>
                <span className="font-semibold text-gray-900">{new Date(session.endedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Scenario:</span>
                <span className="font-semibold text-gray-900">{session.scenario || "Standard CPR"}</span>
              </div>
              {session.notes && (
                <div className="border-t border-gray-100 pt-2 mt-2">
                  <span className="font-semibold text-gray-700 block mb-1">Instructor Notes:</span>
                  <p className="text-gray-600 font-sans italic">{session.notes}</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default SessionReviewPage;
