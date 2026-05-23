import { useEffect, useMemo, useState } from "react";
import { getNetworkInfo } from "../lib/tauriApi";
import { generateAccessUrls } from "../lib/accessUrls";
import { Badge, Button, Card, Skeleton } from "../components/ui";

type SetupPageProps = {
  manualLanIpOverride: string | null;
  onApplyManualLanIpOverride: (value: string) => void;
  onClearManualLanIpOverride: () => void;
};

type SetupNetworkState = {
  status: "checking" | "ready" | "error";
  hostname?: string;
  detectedIp?: string | null;
  message: string;
};

type NetworkTone = "ready" | "checking" | "error";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }
  }

  return "Unknown error";
}

function buttonStyle(disabled: boolean = false): React.CSSProperties {
  return {
    padding: "8px 14px",
    background: disabled ? "#e5e7eb" : "#0f172a",
    color: disabled ? "#9ca3af" : "#ffffff",
    border: "1px solid " + (disabled ? "#d1d5db" : "#0f172a"),
    borderRadius: "6px",
    fontSize: "0.9rem",
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.2s ease-in-out",
    opacity: disabled ? 0.6 : 1,
  };
}

function getNetworkTone(status: SetupNetworkState["status"]): NetworkTone {
  if (status === "ready") {
    return "ready";
  }

  if (status === "error") {
    return "error";
  }

  return "checking";
}

function getNetworkFrameClass(tone: NetworkTone): string {
  return `network-frame network-frame--${tone}`;
}

export default function SetupPage({
  manualLanIpOverride,
  onApplyManualLanIpOverride,
  onClearManualLanIpOverride,
}: SetupPageProps) {
  const [manualIpInput, setManualIpInput] = useState(manualLanIpOverride ?? "");
  const [networkState, setNetworkState] = useState<SetupNetworkState>({
    status: "checking",
    message: "Checking LAN info...",
  });
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    setManualIpInput(manualLanIpOverride ?? "");
  }, [manualLanIpOverride]);

  useEffect(() => {
    async function loadNetworkInfo() {
      try {
        const info = await getNetworkInfo();
        setNetworkState({
          status: "ready",
          hostname: info.hostname,
          detectedIp: info.primaryIpv4,
          message: info.primaryIpv4
            ? "Auto-detection found a usable local IPv4 address."
            : "No usable local IPv4 detected. You can set a manual override below.",
        });
      } catch (error) {
        setNetworkState({
          status: "error",
          message: `Failed to read network info. ${getErrorMessage(error)}`,
        });
      }
    }

    loadNetworkInfo();
  }, []);

  function handleApplyOverride() {
    const normalized = manualIpInput.trim();

    if (!normalized) {
      return;
    }

    onApplyManualLanIpOverride(normalized);
  }

  function handleClearOverride() {
    setManualIpInput("");
    onClearManualLanIpOverride();
  }

  async function handleCopyNetworkInfo() {
    const payload = {
      hostname: networkState.hostname ?? null,
      detectedIp: networkState.detectedIp ?? null,
      activeOverride: manualLanIpOverride ?? null,
      chosenHost: chosenHost,
      status: networkState.status,
      message: networkState.message,
      urls: {
        instructor: instructorUrl,
        trainee: traineeUrl,
      },
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("idle");
    }
  }

  // Determine the chosen host/IP and generate access URLs
  const chosenHost = manualLanIpOverride ?? networkState.detectedIp ?? null;
  const { instructorUrl, traineeUrl } = generateAccessUrls(chosenHost);
  const networkTone = getNetworkTone(networkState.status);
  const overrideActive = Boolean(manualLanIpOverride);
  const detectedMatchesOverride = Boolean(manualLanIpOverride && networkState.detectedIp && manualLanIpOverride === networkState.detectedIp);
  const autoDetectionReady = networkState.status === "ready" && Boolean(networkState.detectedIp);
  const networkCopyPayload = useMemo(
    () => ({
      hostname: networkState.hostname ?? null,
      detectedIp: networkState.detectedIp ?? null,
      activeOverride: manualLanIpOverride ?? null,
      chosenHost,
      status: networkState.status,
      message: networkState.message,
      urls: {
        instructor: instructorUrl,
        trainee: traineeUrl,
      },
    }),
    [chosenHost, instructorUrl, manualLanIpOverride, networkState.detectedIp, networkState.hostname, networkState.message, networkState.status, traineeUrl]
  );

  return (
    <section className="network-setup-page">
      <div>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.01em" }}>Setup</h2>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.95rem" }}>
          Configure local network identity for future dashboard URLs and QR slices.
        </p>
      </div>

      <div className={getNetworkFrameClass(networkTone)}>
        <Card className="network-card network-card--status">
          <div className="network-card__header">
            <div>
              <p className="network-card__eyebrow">Network Status</p>
              <div className="network-status-banner">
                {networkState.status === "checking" ? (
                  <Skeleton className="network-status-dot" />
                ) : (
                  <span className={`network-status-dot network-status-dot--${networkTone}`} aria-hidden="true" />
                )}
                <div className="network-status-copy">
                  <Badge variant="status" className={`status-badge--${networkTone === "ready" ? "success" : networkTone === "error" ? "danger" : "info"}`}>
                    {networkState.status === "checking" ? "Checking" : networkState.status === "ready" ? "Ready" : "Error"}
                  </Badge>
                  <p className="network-status-copy__title">Ready</p>
                  <p className="network-status-copy__subtitle">All services reachable</p>
                </div>
              </div>
            </div>
            <Button variant="secondary" onClick={handleCopyNetworkInfo} className="network-copy-button">
              {copyState === "copied" ? "Copied" : "Copy Network Info"}
            </Button>
          </div>
          <p className="network-card__detail">{networkState.message}</p>
        </Card>
      </div>

      <div className="network-grid">
        <Card className="network-card">
          <div className="network-card__header network-card__header--stacked">
            <div>
              <p className="network-card__eyebrow">Identity</p>
              <h3 className="network-card__title">Local network snapshot</h3>
            </div>
          </div>

          <div className="network-field-grid">
            <div className="network-field-card">
              <p className="network-field-card__label"><span className="network-field-card__icon" aria-hidden="true">🖥️</span> Hostname</p>
              <div className="network-field-card__row">
                <span className="network-field-card__value">{networkState.hostname ?? "Unknown"}</span>
                <Badge variant="status" className="status-badge--info">Neutral</Badge>
              </div>
            </div>

            <div className="network-field-card">
              <p className="network-field-card__label"><span className="network-field-card__icon" aria-hidden="true">🌐</span> Detected IP</p>
              <div className="network-field-card__row">
                <span className="network-field-card__value">{networkState.detectedIp ?? "Not detected"}</span>
                <Badge variant="status" className={`status-badge--${detectedMatchesOverride ? "success" : "info"}`}>
                  {detectedMatchesOverride ? "Matches override" : autoDetectionReady ? "Detected" : "Pending"}
                </Badge>
              </div>
            </div>

            <div className="network-field-card">
              <p className="network-field-card__label"><span className="network-field-card__icon" aria-hidden="true">✅</span> Auto-detection</p>
              <div className="network-field-card__row">
                <span className="network-field-card__value">{autoDetectionReady ? "Ready" : networkState.status === "error" ? "Unavailable" : "Checking"}</span>
                <Badge variant="status" className={`status-badge--${autoDetectionReady ? "success" : networkState.status === "error" ? "danger" : "warning"}`}>
                  {autoDetectionReady ? "Ready" : networkState.status === "error" ? "Error" : "Polling"}
                </Badge>
              </div>
            </div>

            <div className="network-field-card network-field-card--override">
              <p className="network-field-card__label"><span className="network-field-card__icon" aria-hidden="true">🔁</span> Active override</p>
              <div key={manualLanIpOverride ?? "none"} className="network-override-value network-override-value--animate">
                <span>Active override:</span>
                <strong>{manualLanIpOverride ?? "None"}</strong>
                <Badge variant="status" className={`status-badge--${overrideActive ? "info" : "warning"}`}>
                  {overrideActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          </div>
        </Card>

        <Card className="network-card">
          <div className="network-card__header network-card__header--stacked">
            <div>
              <p className="network-card__eyebrow">Override</p>
              <h3 className="network-card__title">Manual LAN IP Override</h3>
              <p className="network-card__detail">Update the saved LAN IP and let the card reflect the change smoothly.</p>
            </div>
          </div>

          <div style={{ display: "grid", gap: "12px" }}>
            <label htmlFor="manual-lan-ip" style={{ display: "grid", gap: "8px" }}>
              <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>Manual LAN IP Override</span>
              <input
                id="manual-lan-ip"
                type="text"
                value={manualIpInput}
                onChange={(event) => setManualIpInput(event.target.value)}
                placeholder="Example: 192.168.1.20"
                style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: "10px", fontSize: "0.9rem", fontFamily: "inherit" }}
              />
            </label>

            <div className="network-override-actions">
              <Button type="button" variant="primary" onClick={handleApplyOverride} disabled={!manualIpInput.trim()}>
                Save Override
              </Button>
              <Button type="button" variant="secondary" onClick={handleClearOverride} disabled={!manualLanIpOverride}>
                Clear Override
              </Button>
            </div>
          </div>
        </Card>

        <Card className="network-card network-card--urls">
          <div className="network-card__header network-card__header--stacked">
            <div>
              <p className="network-card__eyebrow">Access URLs</p>
              <h3 className="network-card__title">Resulting dashboard URLs</h3>
              <p className="network-card__detail">These URLs will be used for dashboard access from your LAN.</p>
            </div>
          </div>

          <div className="network-url-list">
            <div className="network-url-item">
              <p className="network-url-item__label">Instructor Dashboard</p>
              <code className="network-url-item__code">{instructorUrl ?? "Not available (set LAN IP first)"}</code>
            </div>
            <div className="network-url-item">
              <p className="network-url-item__label">Trainee Dashboard</p>
              <code className="network-url-item__code">{traineeUrl ?? "Not available (set LAN IP first)"}</code>
            </div>
          </div>

          <pre className="network-json-preview">{JSON.stringify(networkCopyPayload, null, 2)}</pre>
        </Card>
      </div>

      {/* QR functionality removed */}
    </section>
  );
}
