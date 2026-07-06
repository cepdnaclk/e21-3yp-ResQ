import { useEffect, useState } from "react";
import { Button, Select, Alert, Skeleton } from "../components/ui";
import { Dialog } from "../components/ui/dialog";
import { fetchManikinInventory, type ManikinInventoryEntry } from "../lib/browserManikinsApi";
import { getHubApiBaseUrl } from "../lib/hubApiUrl";

function getDiagUrl(deviceId: string, path: "ping" | "request"): string {
  return `${getHubApiBaseUrl()}/api/devices/${encodeURIComponent(deviceId)}/diag/${path}`;
}

export default function DiagnosticsPage() {
  const [manikins, setManikins] = useState<ManikinInventoryEntry[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [pingLoading, setPingLoading] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [showReportDialog, setShowReportDialog] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchManikinInventory()
      .then((list) => {
        if (!mounted) return;
        setManikins(list);
        if (list.length > 0) setSelected(list[0].deviceId);
      })
      .catch(() => {
        if (!mounted) return;
        setManikins([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handlePing() {
    if (!selected) {
      setPingResult("Please select a manikin first.");
      return;
    }

    setPingLoading(true);
    setPingResult(null);
    try {
      const res = await fetch(getDiagUrl(selected, "ping"), { method: "POST", credentials: "include" });
      if (!res.ok) {
        setPingResult(`Ping failed (${res.status})`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && typeof data.latencyMs === "number") {
        setPingResult(`Ping successful - ${data.latencyMs}ms`);
      } else if (data && data.message) {
        setPingResult(String(data.message));
      } else {
        setPingResult("Ping successful");
      }
    } catch (err) {
      setPingResult(`Ping error: ${(err as Error).message}`);
    } finally {
      setPingLoading(false);
    }
  }

  async function handleRequestReport() {
    if (!selected) {
      setReport("Please select a manikin first.");
      setShowReportDialog(true);
      return;
    }

    setReportLoading(true);
    setReport(null);
    try {
      const res = await fetch(getDiagUrl(selected, "request"), { method: "POST", credentials: "include" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setReport(`Request failed (${res.status}) ${text}`);
        setShowReportDialog(true);
        return;
      }

      // Try JSON first, otherwise text
      const json = await res.json().catch(() => null);
      if (json) {
        setReport(JSON.stringify(json, null, 2));
      } else {
        const text = await res.text().catch(() => "(no content)");
        setReport(text);
      }
      setShowReportDialog(true);
    } catch (err) {
      setReport(`Request error: ${(err as Error).message}`);
      setShowReportDialog(true);
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <section>
      <h2 style={{ marginTop: 0 }}>Diagnostics</h2>
      <p style={{ color: "#4b5563" }}>Tools to run diagnostics against connected manikins.</p>

      <div style={{ marginTop: 18, display: "grid", gap: 12, maxWidth: 720 }}>
        <div>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>Select Manikin</label>
          {loading ? (
            <Skeleton />
          ) : (
            <Select value={selected} onChange={(e) => setSelected(e.currentTarget.value)}>
              <option value="">-- Select a manikin --</option>
              {(manikins ?? []).map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.deviceId} {m.ip ? `· ${m.ip}` : ""} {m.fw ? `· fw:${m.fw}` : ""} {m.status ? `· ${m.status}` : ""}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={handlePing} disabled={pingLoading || loading}>
            {pingLoading ? "Pinging…" : "Ping Manikin"}
          </Button>
          <Button variant="primary" onClick={handleRequestReport} disabled={reportLoading || loading}>
            {reportLoading ? "Requesting…" : "Request Diagnostic Report"}
          </Button>
        </div>

        {pingResult ? (
          <Alert title="Ping Result" detail={pingResult} />
        ) : null}
      </div>

      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog} title="Diagnostic Report">
        <div style={{ whiteSpace: "pre-wrap", fontFamily: "Cascadia Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace", fontSize: 13 }}>
          {reportLoading ? <Skeleton size="lg" /> : <pre style={{ margin: 0 }}>{report ?? "(no report)"}</pre>}
        </div>
      </Dialog>
    </section>
  );
}
