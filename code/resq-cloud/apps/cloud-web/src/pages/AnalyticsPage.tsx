import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { useCloudSessions } from "../hooks/useCloudSessions";
import { computeSessionAnalytics } from "../lib/analytics";
import { formatDate, formatNumber } from "../lib/format";

export function AnalyticsPage() {
  const { sessions, isLoading, error, reload } = useCloudSessions();

  if (isLoading) return <LoadingState message="Calculating cloud session analytics…" />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (sessions.length === 0) return <EmptyState />;

  const analytics = computeSessionAnalytics(sessions);
  const cards = [
    ["Total synced sessions", String(analytics.totalSessions), "All cloud records"],
    ["Completed sessions", String(analytics.completedSessions), "Status or result is completed"],
    ["Average score", formatNumber(analytics.averageScore, 1), "Across scored sessions"],
    ["Average depth", `${formatNumber(analytics.averageDepth, 1)} mm`, "Across recorded depth values"],
    ["Average rate", `${formatNumber(analytics.averageRate, 1)} cpm`, "Across recorded rate values"],
    ["Average recoil", `${formatNumber(analytics.averageRecoil, 1)}%`, "Across recorded recoil values"],
  ];

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Aggregate review</p>
          <h2>Analytics</h2>
          <p>Client-side summaries computed from the synced session list.</p>
        </div>
      </div>

      <div className="analytics-grid">
        {cards.map(([label, value, note]) => (
          <article className="metric-card" key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <span>{note}</span>
          </article>
        ))}
      </div>

      <div className="latest-card">
        <span>Latest synced session</span>
        <strong>{formatDate(analytics.latestSyncedAt)}</strong>
      </div>
    </section>
  );
}
