import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  getStudentDashboardStatus,
  refreshStudentDashboardAddress,
  type StudentDashboardStatus,
} from "../lib/tauriApi";
import { isTauriRuntime } from "../lib/hubApiUrl";
import Button from "./ui/Button";
import Card from "./ui/Card";
import StatusBadge from "./ui/StatusBadge";

type StudentTabletAccessPanelProps = {
  backendAvailable: boolean;
  activeSessionId?: string | null;
  canShareActiveSession?: boolean;
};

export function buildSessionDashboardUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/trainee/sessions/${encodeURIComponent(sessionId)}/live`;
}

export function StudentTabletAccessPanel({
  backendAvailable,
  activeSessionId,
  canShareActiveSession = false,
}: StudentTabletAccessPanelProps) {
  const [status, setStatus] = useState<StudentDashboardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"dashboard" | "session" | null>(null);
  const inTauri = isTauriRuntime();

  useEffect(() => {
    if (!inTauri) {
      setLoading(false);
      return;
    }

    let active = true;
    void getStudentDashboardStatus()
      .then((next) => {
        if (active) {
          setStatus(next);
          setPanelError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPanelError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [inTauri]);

  const sessionUrl = useMemo(() => {
    if (!status?.url || !activeSessionId || !canShareActiveSession) return null;
    return buildSessionDashboardUrl(status.url, activeSessionId);
  }, [activeSessionId, canShareActiveSession, status?.url]);

  if (!inTauri) return null;

  async function copyUrl(url: string, kind: "dashboard" | "session") {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setPanelError("The link could not be copied. Select and copy the displayed URL manually.");
    }
  }

  async function refreshAddress() {
    setLoading(true);
    setPanelError(null);
    try {
      setStatus(await refreshStudentDashboardAddress());
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const dashboardReady = status?.running === true && Boolean(status.url);
  const warning = panelError ?? status?.error ?? null;

  return (
    <Card className="border-teal-100 bg-gradient-to-br from-white to-teal-50/40" aria-labelledby="student-tablet-access-title">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="student-tablet-access-title" className="text-lg font-semibold text-slate-900">Student Tablet Access</h2>
            <StatusBadge
              tone={status?.running ? "success" : loading ? "muted" : "danger"}
              label={status?.running ? "Dashboard running" : loading ? "Checking" : "Dashboard unavailable"}
            />
            <StatusBadge
              tone={backendAvailable ? "success" : "warning"}
              label={backendAvailable ? "Backend available" : "Backend unavailable"}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Connect the student tablet to the same Wi-Fi network as this computer, then scan the QR code.
          </p>

          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="inline font-semibold text-slate-700">Dashboard: </dt>
              <dd className="inline break-all text-slate-600">{status?.url ?? "No LAN address detected"}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-slate-700">Backend: </dt>
              <dd className="inline break-all text-slate-600">{status?.backendUrl ?? "No LAN address detected"}</dd>
            </div>
          </dl>

          {warning && (
            <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {warning}
            </p>
          )}
          {status?.running && !status.lanIp && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              Connect this computer to Wi-Fi or Ethernet, then refresh the network address.
            </p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            If the tablet cannot connect, allow ResQ Local Hub on private networks in Windows Firewall. Port 1883 is not used by tablet browsers.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!dashboardReady}
              onClick={() => status?.url && void copyUrl(status.url, "dashboard")}
            >
              {copied === "dashboard" ? "Link copied" : "Copy Link"}
            </Button>
            <Button type="button" variant="secondary" size="sm" loading={loading} onClick={() => void refreshAddress()}>
              Refresh Network
            </Button>
          </div>
        </div>

        {dashboardReady && status?.url && (
          <div className="flex flex-col gap-4 sm:flex-row xl:flex-col">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <QRCodeSVG value={status.url} size={152} level="M" title="General student dashboard QR code" />
              <p className="mt-2 text-xs font-semibold text-slate-600">General dashboard</p>
            </div>
            {sessionUrl && (
              <div className="rounded-2xl border border-teal-200 bg-white p-3 text-center shadow-sm">
                <QRCodeSVG value={sessionUrl} size={152} level="M" title="Active trainee session QR code" />
                <p className="mt-2 text-xs font-semibold text-slate-600">Assigned active session</p>
                <p className="mt-1 max-w-[152px] break-all text-[10px] text-slate-500">{sessionUrl}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => void copyUrl(sessionUrl, "session")}
                >
                  {copied === "session" ? "Link copied" : "Copy Session Link"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default StudentTabletAccessPanel;
