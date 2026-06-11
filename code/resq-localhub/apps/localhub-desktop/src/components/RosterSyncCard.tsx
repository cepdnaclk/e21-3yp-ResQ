/**
 * RosterSyncCard.tsx
 *
 * Admin-only card displaying cloud roster sync status and providing a
 * manual "Sync Now" trigger.
 *
 * ⚠️  Only render this component for ADMIN users. The component does not
 *     enforce this internally — the parent is responsible.
 */
import { useEffect, useState } from "react";
import {
  fetchSyncStatus,
  triggerRosterSync,
  type SyncStatusResponse,
} from "../lib/browserRosterSyncApi";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function StatCell({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: "8px",
        padding: "10px 14px",
        minWidth: "100px",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: "0.75rem",
          color: "#64748b",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "4px 0 0 0",
          fontSize: "1.35rem",
          fontWeight: 700,
          color: "#0f172a",
        }}
      >
        {value === null || value === undefined ? "—" : value}
      </p>
    </div>
  );
}

export function RosterSyncCard() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const data = await fetchSyncStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function handleSyncNow() {
    setSyncing(true);
    setSyncMessage(null);
    setSyncError(null);

    try {
      const result = await triggerRosterSync();
      setSyncMessage(result.message ?? "Sync triggered successfully.");
      // Refresh status after sync
      await loadStatus();
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : "Sync failed. Check backend configuration."
      );
    } finally {
      setSyncing(false);
    }
  }

  const credentialsMissing = status?.credentialsMissing === true;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "16px",
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.04)",
        padding: "24px",
        marginBottom: "28px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Cloud-sync icon */}
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
          </div>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              Cloud Roster Sync
            </h2>
            <p style={{ margin: "2px 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              Synchronise users, courses, and enrolments from the cloud
            </p>
          </div>
        </div>

        <button
          type="button"
          id="roster-sync-now-btn"
          onClick={handleSyncNow}
          disabled={syncing || loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "10px 18px",
            borderRadius: "10px",
            border: "none",
            background:
              syncing || loading
                ? "#e2e8f0"
                : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            color: syncing || loading ? "#94a3b8" : "#ffffff",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: syncing || loading ? "not-allowed" : "pointer",
            boxShadow:
              syncing || loading ? "none" : "0 4px 12px rgba(59, 130, 246, 0.3)",
            transition: "all 0.2s ease",
            whiteSpace: "nowrap",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              animation: syncing ? "spin 1s linear infinite" : "none",
            }}
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {/* Missing credentials warning */}
      {credentialsMissing && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "12px 16px",
            borderRadius: "10px",
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            color: "#92400e",
            fontSize: "0.9rem",
            marginBottom: "16px",
            fontWeight: 500,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: "1px" }}
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            <strong>Roster sync credentials are not fully configured.</strong> Please set the
            required backend cloud credentials in your LocalHub configuration before syncing.
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <p style={{ margin: "0 0 16px 0", color: "#64748b", fontSize: "0.9rem" }}>
          Loading sync status…
        </p>
      )}

      {/* Fetch error */}
      {error && !loading && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: "0.88rem",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      {/* Sync feedback */}
      {syncMessage && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "#dcfce7",
            color: "#166534",
            fontSize: "0.88rem",
            marginBottom: "16px",
          }}
        >
          {syncMessage}
        </div>
      )}
      {syncError && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: "0.88rem",
            marginBottom: "16px",
          }}
        >
          {syncError}
        </div>
      )}

      {/* Stats grid */}
      {status && !loading && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: "10px",
              marginBottom: "20px",
            }}
          >
            <StatCell label="Users Synced" value={status.lastUserCount} />
            <StatCell label="Courses Synced" value={status.lastCourseCount} />
            <StatCell label="Enrolments Synced" value={status.lastEnrollmentCount} />
          </div>

          <div
            style={{
              display: "grid",
              gap: "6px",
              fontSize: "0.85rem",
              color: "#475569",
            }}
          >
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "#0f172a", minWidth: "170px" }}>
                Last Sync Attempt:
              </span>
              <span>{formatDate(status.lastAttemptAt)}</span>
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "#0f172a", minWidth: "170px" }}>
                Last Successful Sync:
              </span>
              <span>{formatDate(status.lastSuccessAt)}</span>
            </div>
            {status.lastError && (
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color: "#991b1b",
                    minWidth: "170px",
                  }}
                >
                  Last Error:
                </span>
                <span
                  style={{
                    color: "#991b1b",
                    fontFamily: "monospace",
                    fontSize: "0.82rem",
                    wordBreak: "break-all",
                  }}
                >
                  {status.lastError}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
