import { useEffect, useState } from "react";
import { fetchCloudSession, type CloudSessionRecord } from "../api/cloudApi";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { displayValue, formatDate, formatDuration } from "../lib/format";
import { navigate } from "../router";

export function SessionDetailPage({ cloudSessionId }: { cloudSessionId: string }) {
  const [session, setSession] = useState<CloudSessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError(null);
    fetchCloudSession(cloudSessionId)
      .then((record) => active && setSession(record))
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : "Could not load session."));
    return () => {
      active = false;
    };
  }, [cloudSessionId]);

  if (error) return <ErrorState message={error} />;
  if (!session) return <LoadingState message="Loading session detail…" />;

  const payload = session.payload;
  const fields = [
    ["Cloud session ID", session.cloudSessionId],
    ["Idempotency key", session.idempotencyKey],
    ["Local hub ID", payload.localHubId],
    ["Local session ID", payload.localSessionId],
    ["Session ID", payload.sessionId],
    ["Device ID", payload.deviceId],
    ["Manikin ID", payload.manikinId],
    ["Trainee ID", payload.traineeId],
    ["Instructor ID", payload.instructorId],
    ["Status", payload.status || payload.result],
    ["Duration", formatDuration(payload.durationMs)],
    ["Total compressions", payload.totalCompressions],
    ["Valid compressions", payload.validCompressions],
    ["Average depth", payload.avgDepthMm == null ? null : `${payload.avgDepthMm} mm`],
    ["Average rate", payload.avgRateCpm == null ? null : `${payload.avgRateCpm} cpm`],
    ["Recoil OK", payload.recoilOkPct == null ? null : `${payload.recoilOkPct}%`],
    ["Pause count", payload.pauseCount],
    ["Score", payload.score],
    ["Source", payload.source],
    ["Generated at", formatDate(payload.generatedAt)],
    ["Received at", formatDate(session.createdAt)],
    ["Updated at", formatDate(session.updatedAt)],
  ] as const;

  return (
    <section className="page-section">
      <button className="back-link" onClick={() => navigate("/sessions")}>← Back to sessions</button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Session detail</p>
          <h2>{payload.localSessionId}</h2>
          <p>Cloud record and the original versioned LocalHub payload.</p>
        </div>
        <span className="status-badge status-badge--large">{payload.status || payload.result || "Unknown"}</span>
      </div>

      <div className="detail-grid">
        {fields.map(([label, value]) => (
          <div className="detail-item" key={label}>
            <dt>{label}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </div>

      <div className="json-card">
        <div>
          <p className="eyebrow">Source contract</p>
          <h3>Raw payload JSON</h3>
        </div>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </section>
  );
}
