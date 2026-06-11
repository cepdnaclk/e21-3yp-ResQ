import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { useCloudSessions } from "../hooks/useCloudSessions";
import { formatDate, formatNumber, shortId } from "../lib/format";
import { navigate } from "../router";

export function SessionsPage() {
  const { sessions, isLoading, error, reload } = useCloudSessions();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Cloud archive</p>
          <h2>Synced sessions</h2>
          <p>Completed training summaries received from LocalHub.</p>
        </div>
        <span className="count-badge">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
      </div>

      {sessions.length === 0 ? <EmptyState /> : (
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cloud session</th>
                  <th>Local hub</th>
                  <th>Local session</th>
                  <th>Device / manikin</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Depth</th>
                  <th>Rate</th>
                  <th>Recoil</th>
                  <th>Received</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.cloudSessionId}>
                    <td><code title={session.cloudSessionId}>{shortId(session.cloudSessionId)}</code></td>
                    <td>{session.payload.localHubId || "Unassigned"}</td>
                    <td>{session.payload.localSessionId}</td>
                    <td>
                      <strong>{session.payload.deviceId || "—"}</strong>
                      <span className="cell-subtext">{session.payload.manikinId || "No manikin ID"}</span>
                    </td>
                    <td><span className="status-badge">{session.payload.status || session.payload.result || "Unknown"}</span></td>
                    <td>{formatNumber(session.payload.score, 0)}</td>
                    <td>{formatNumber(session.payload.avgDepthMm)} mm</td>
                    <td>{formatNumber(session.payload.avgRateCpm)} cpm</td>
                    <td>{formatNumber(session.payload.recoilOkPct)}%</td>
                    <td>{formatDate(session.createdAt)}</td>
                    <td>{formatDate(session.updatedAt)}</td>
                    <td>
                      <a
                        className="detail-link"
                        href={`/sessions/${session.cloudSessionId}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/sessions/${session.cloudSessionId}`);
                        }}
                      >
                        View details
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
