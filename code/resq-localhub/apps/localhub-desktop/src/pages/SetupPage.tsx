import { useEffect, useState } from "react";
import { getNetworkInfo } from "../lib/tauriApi";
import { generateAccessUrls } from "../lib/accessUrls";

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

  // Determine the chosen host/IP and generate access URLs
  const chosenHost = manualLanIpOverride ?? networkState.detectedIp ?? null;
  const { instructorUrl, traineeUrl } = generateAccessUrls(chosenHost);

  return (
    <section style={{ display: "grid", gap: "16px" }}>
      <div>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.01em" }}>Setup</h2>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.95rem" }}>
          Configure local network identity for future dashboard URLs and QR slices.
        </p>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px", display: "grid", gap: "10px", background: "#f8fafc" }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.95rem" }}>
          Network Status: {networkState.status === "checking" ? "Checking" : networkState.status === "ready" ? "Ready" : "Error"}
        </p>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
          Hostname: {networkState.hostname ?? "Unknown"}
        </p>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
          Detected IP: {networkState.detectedIp ?? "Not detected"}
        </p>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>{networkState.message}</p>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px", display: "grid", gap: "10px" }}>
        <label htmlFor="manual-lan-ip" style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          Manual LAN IP Override
        </label>
        <input
          id="manual-lan-ip"
          type="text"
          value={manualIpInput}
          onChange={(event) => setManualIpInput(event.target.value)}
          placeholder="Example: 192.168.1.20"
          style={{ padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.9rem", fontFamily: "inherit" }}
        />
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
          Active override: {manualLanIpOverride ?? "None"}
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button 
            type="button" 
            style={buttonStyle(!manualIpInput.trim())}
            onClick={handleApplyOverride} 
            disabled={!manualIpInput.trim()}
          >
            Save Override
          </button>
          <button 
            type="button" 
            style={buttonStyle(!manualLanIpOverride)}
            onClick={handleClearOverride} 
            disabled={!manualLanIpOverride}
          >
            Clear Override
          </button>
        </div>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "14px", display: "grid", gap: "10px", background: "#f8fafc" }}>
        <div>
          <p style={{ margin: "0 0 8px 0", fontWeight: 600, fontSize: "0.95rem" }}>Resulting URLs</p>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>
            These URLs will be used for dashboard access from your LAN.
          </p>
        </div>
        <div style={{ display: "grid", gap: "10px" }}>
          <div>
            <p style={{ margin: "0 0 6px 0", fontWeight: 500, fontSize: "0.9rem", color: "#0f172a" }}>Instructor Dashboard:</p>
            <code style={{ display: "block", padding: "10px 12px", background: "#ffffff", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.82rem", wordBreak: "break-all", color: "#0f172a", fontFamily: "monospace" }}>
              {instructorUrl ?? "Not available (set LAN IP first)"}
            </code>
          </div>
          <div>
            <p style={{ margin: "0 0 6px 0", fontWeight: 500, fontSize: "0.9rem", color: "#0f172a" }}>Trainee Dashboard:</p>
            <code style={{ display: "block", padding: "10px 12px", background: "#ffffff", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.82rem", wordBreak: "break-all", color: "#0f172a", fontFamily: "monospace" }}>
              {traineeUrl ?? "Not available (set LAN IP first)"}
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}
