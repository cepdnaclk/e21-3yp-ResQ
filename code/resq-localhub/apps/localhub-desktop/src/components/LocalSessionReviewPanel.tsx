import { type CompletedSession, getSessionReviewExportUrl } from "../lib/browserSessionsApi";

type LocalSessionReviewPanelProps = {
  latestEndedSession: CompletedSession | null;
  sessions: CompletedSession[];
  loading: boolean;
  error: string | null;
  canExport: boolean;
  expandedSessionId: string | null;
  expandedSessionDetail: CompletedSession | null;
  expandedSessionLoading: boolean;
  expandedSessionError: string | null;
  onSelectSession: (sessionId: string) => void;
  onRefresh: () => void;
};

export function LocalSessionReviewPanel({
  latestEndedSession,
  sessions,
  loading,
  error,
  canExport,
  expandedSessionId,
  expandedSessionDetail,
  expandedSessionLoading,
  expandedSessionError,
  onSelectSession,
  onRefresh,
}: LocalSessionReviewPanelProps) {
  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.heading}>Local Session Review</h2>
          <p style={styles.subheading}>Review recent local and simulator sessions, then export a clean demo package.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} style={styles.refreshButton}>
          Refresh
        </button>
      </div>

      {latestEndedSession ? (
        <div style={styles.summaryBanner}>
          <div style={styles.bannerLabel}>Latest completed session</div>
          <div style={styles.bannerTitle}>
            {latestEndedSession.deviceId} • {latestEndedSession.sessionId}
          </div>
          <div style={styles.bannerMeta}>
            Trainee {latestEndedSession.traineeId ?? "-"} • {formatDateTime(latestEndedSession.endedAt)} • Score {latestEndedSession.summary.score}
          </div>
          <div style={styles.metricRow}>
            <Metric label="Samples" value={String(latestEndedSession.summary.sampleCount)} />
            <Metric label="Compressions" value={`${latestEndedSession.summary.validCompressions}/${latestEndedSession.summary.totalCompressions}`} />
            <Metric label="Depth" value={formatDepth(latestEndedSession.summary)} />
            <Metric label="Rate" value={`${latestEndedSession.summary.avgRateCpm.toFixed(1)} cpm`} />
          </div>
        </div>
      ) : null}

      {loading ? <p style={styles.message}>Loading completed sessions...</p> : null}
      {error ? <p style={styles.error}>{error}</p> : null}

      {!loading && !error && sessions.length === 0 ? <p style={styles.message}>No completed sessions yet.</p> : null}

      <div style={styles.grid}>
        <div style={styles.listColumn}>
          {sessions.map((session) => {
            const isSelected = expandedSessionId === session.sessionId;
            return (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => onSelectSession(session.sessionId)}
                style={isSelected ? styles.sessionButtonSelected : styles.sessionButton}
              >
                <div style={styles.sessionTitleRow}>
                  <div>
                    <div style={styles.sessionTitle}>{session.deviceId}</div>
                    <div style={styles.sessionSubtitle}>{session.sessionId}</div>
                  </div>
                  <div style={styles.scorePill}>Score {session.summary.score}</div>
                </div>
                <div style={styles.sessionMetaRow}>
                  <span>Started {formatDateTime(session.startedAt)}</span>
                  <span>Ended {formatDateTime(session.endedAt)}</span>
                </div>
                <div style={styles.sessionMetaRow}>
                  <span>Samples {session.summary.sampleCount}</span>
                  <span>Depth {formatDepth(session.summary)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div style={styles.detailColumn}>
          {expandedSessionLoading ? <p style={styles.message}>Loading session details...</p> : null}
          {expandedSessionError ? <p style={styles.error}>{expandedSessionError}</p> : null}
          {!expandedSessionLoading && !expandedSessionError && expandedSessionDetail ? (
            <div style={styles.detailCard}>
              <div style={styles.detailHeaderRow}>
                <div>
                  <div style={styles.detailTitle}>{expandedSessionDetail.deviceId}</div>
                  <div style={styles.detailSubtitle}>{expandedSessionDetail.sessionId}</div>
                </div>
                {canExport ? (
                  <div style={styles.exportRow}>
                    <a href={getSessionReviewExportUrl(expandedSessionDetail.sessionId, "json")} style={styles.linkButton}>
                      JSON
                    </a>
                    <a href={getSessionReviewExportUrl(expandedSessionDetail.sessionId, "csv")} style={styles.linkButton}>
                      CSV
                    </a>
                  </div>
                ) : null}
              </div>

              <div style={styles.detailMetricGrid}>
                <Metric label="Trainee" value={expandedSessionDetail.traineeId ?? "-"} />
                <Metric label="Duration" value={`${expandedSessionDetail.summary.durationSeconds}s`} />
                <Metric label="Samples" value={String(expandedSessionDetail.summary.sampleCount)} />
                <Metric label="Compressions" value={`${expandedSessionDetail.summary.validCompressions}/${expandedSessionDetail.summary.totalCompressions}`} />
                <Metric label="Depth mm" value={expandedSessionDetail.summary.avgDepthMm.toFixed(1)} />
                <Metric label="Depth progress" value={formatProgress(expandedSessionDetail.summary.avgDepthProgress)} />
                <Metric label="Rate" value={`${expandedSessionDetail.summary.avgRateCpm.toFixed(1)} cpm`} />
                <Metric label="Recoil ok" value={String(expandedSessionDetail.summary.recoilOkCount)} />
                <Metric label="Recoil incomplete" value={String(expandedSessionDetail.summary.incompleteRecoilCount)} />
                <Metric label="Pauses" value={String(expandedSessionDetail.summary.pausesCount)} />
                <Metric label="Score" value={String(expandedSessionDetail.summary.score)} />
                <Metric label="Flags" value={expandedSessionDetail.summary.latestFlags ?? "-"} />
              </div>
            </div>
          ) : null}
          {!expandedSessionLoading && !expandedSessionError && !expandedSessionDetail ? <p style={styles.message}>Select a session to inspect the full summary.</p> : null}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatProgress(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  if (value <= 1) {
    return `${(value * 100).toFixed(0)}%`;
  }

  return value.toFixed(2);
}

function formatDepth(summary: CompletedSession["summary"]): string {
  if (summary.avgDepthProgress != null && summary.avgDepthMm === 0) {
    return formatProgress(summary.avgDepthProgress);
  }

  if (summary.avgDepthProgress != null) {
    return `${summary.avgDepthMm.toFixed(1)} mm / ${formatProgress(summary.avgDepthProgress)}`;
  }

  return `${summary.avgDepthMm.toFixed(1)} mm`;
}

const styles = {
  card: {
    padding: "20px",
    borderRadius: "16px",
    border: "1px solid #dbe4f0",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
    display: "grid",
    gap: "16px",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  heading: {
    margin: 0,
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "#0f172a",
  },
  subheading: {
    margin: "6px 0 0 0",
    fontSize: "0.88rem",
    color: "#52627a",
  },
  refreshButton: {
    padding: "8px 12px",
    borderRadius: "999px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 700,
    fontSize: "0.85rem",
    cursor: "pointer",
  },
  summaryBanner: {
    padding: "16px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
    color: "#ffffff",
    display: "grid",
    gap: "8px",
  },
  bannerLabel: {
    fontSize: "0.72rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.72)",
    fontWeight: 700,
  },
  bannerTitle: {
    fontSize: "1.05rem",
    fontWeight: 700,
  },
  bannerMeta: {
    fontSize: "0.86rem",
    color: "rgba(255,255,255,0.86)",
  },
  metricRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
    marginTop: "4px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 0.9fr) minmax(0, 1.1fr)",
    gap: "14px",
  },
  listColumn: {
    display: "grid",
    gap: "10px",
  },
  detailColumn: {
    minWidth: 0,
  },
  sessionButton: {
    textAlign: "left" as const,
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #dbe4f0",
    background: "#ffffff",
    cursor: "pointer",
    display: "grid",
    gap: "8px",
  },
  sessionButtonSelected: {
    textAlign: "left" as const,
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #1d4ed8",
    background: "#eff6ff",
    cursor: "pointer",
    display: "grid",
    gap: "8px",
  },
  sessionTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
  },
  sessionTitle: {
    fontWeight: 700,
    color: "#0f172a",
  },
  sessionSubtitle: {
    marginTop: "4px",
    fontSize: "0.8rem",
    color: "#52627a",
  },
  scorePill: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: "0.78rem",
    fontWeight: 700,
    whiteSpace: "nowrap" as const,
  },
  sessionMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap" as const,
    fontSize: "0.8rem",
    color: "#52627a",
  },
  detailCard: {
    padding: "16px",
    borderRadius: "14px",
    border: "1px solid #dbe4f0",
    background: "#ffffff",
    display: "grid",
    gap: "14px",
  },
  detailHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  detailTitle: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "#0f172a",
  },
  detailSubtitle: {
    marginTop: "4px",
    fontSize: "0.8rem",
    color: "#52627a",
  },
  exportRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  linkButton: {
    padding: "7px 11px",
    borderRadius: "999px",
    border: "1px solid #cbd5e1",
    textDecoration: "none",
    color: "#0f172a",
    background: "#ffffff",
    fontWeight: 700,
    fontSize: "0.82rem",
  },
  detailMetricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
  },
  metricCard: {
    padding: "10px",
    borderRadius: "12px",
    border: "1px solid #dbe4f0",
    background: "#f8fbff",
    display: "grid",
    gap: "4px",
  },
  metricLabel: {
    fontSize: "0.72rem",
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    fontWeight: 700,
  },
  metricValue: {
    fontSize: "0.88rem",
    color: "#0f172a",
    fontWeight: 600,
    wordBreak: "break-word" as const,
  },
  message: {
    margin: 0,
    color: "#52627a",
    fontSize: "0.9rem",
  },
  error: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "0.9rem",
  },
} as const;
