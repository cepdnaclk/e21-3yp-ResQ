import { useEffect, useState } from "react";
import { QRCodeSVG as QR } from "qrcode.react";
import { Button, Input } from "./ui";
import {
  buildEspProvisioningUrl,
  buildFirmwareProvisioningPayload,
  fetchHubServiceInfo,
  type FirmwareProvisioningPayload,
  type HubServiceInfoResponse,
} from "../lib/browserManikinsProvisionApi";


function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5 1.8 15h14.4L9 2.5Z" fill="currentColor" opacity="0.18" />
      <path d="M9 6v4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="12.9" r="0.9" fill="currentColor" />
      <path d="M9 2.5 1.8 15h14.4L9 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function FirmwareProvisioningPanel() {
  const [espSetupBaseUrl, setEspSetupBaseUrl] = useState<string>("http://192.168.4.1");
  const [espProvisionPath, setEspProvisionPath] = useState<string>("/");
  const [provisioningWifiSsid, setProvisioningWifiSsid] = useState<string>("");
  const [provisioningWifiPassword, setProvisioningWifiPassword] = useState<string>("");
  const [provisioningBackendBaseUrl, setProvisioningBackendBaseUrl] = useState<string>("");
  const [provisioningAutoSave, setProvisioningAutoSave] = useState<boolean>(true);
  const [pairingLoading, setPairingLoading] = useState<boolean>(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [serviceInfo, setServiceInfo] = useState<HubServiceInfoResponse | null>(null);
  const [serviceInfoError, setServiceInfoError] = useState<string | null>(null);
  const [provisioningUrl, setProvisioningUrl] = useState<string | null>(null);
  const [provisioningPayload, setProvisioningPayload] = useState<FirmwareProvisioningPayload | null>(null);

  useEffect(() => {
    async function loadServiceInfo() {
      try {
        const info = await fetchHubServiceInfo();
        setServiceInfo(info);
        setServiceInfoError(null);
        if (!provisioningBackendBaseUrl.trim()) {
          setProvisioningBackendBaseUrl(info.backend_base_url);
        }
      } catch (error) {
        setServiceInfo(null);
        setServiceInfoError(error instanceof Error ? error.message : "LocalHub service info is unavailable.");
      }
    }
    void loadServiceInfo();
  }, []);

  async function handleRequestPairing() {
    if (!provisioningWifiSsid.trim()) return;

    setPairingLoading(true);
    setPairingError(null);
    setProvisioningUrl(null);
    setProvisioningPayload(null);

    try {
      const info = serviceInfo ?? await fetchHubServiceInfo();
      setServiceInfo(info);
      const backendBaseUrl = provisioningBackendBaseUrl.trim() || info.backend_base_url;
      const payload = buildFirmwareProvisioningPayload(
        {
          ...info,
          backend_base_url: backendBaseUrl,
        },
        provisioningWifiSsid.trim(),
        provisioningWifiPassword,
      );
      const url = buildEspProvisioningUrl({
        espSetupBaseUrl,
        espProvisionPath,
        wifiSsid: payload.wifi_ssid,
        wifiPassword: payload.wifi_pass,
        backendBaseUrl: payload.backend_base_url,
        autoSave: provisioningAutoSave,
      });

      setProvisioningPayload(payload);
      setProvisioningUrl(url);
    } catch (error) {
      setPairingError(
        error instanceof Error ? error.message : "Failed to generate provisioning payload."
      );
    } finally {
      setPairingLoading(false);
    }
  }

  const provisioningPayloadText = provisioningPayload
    ? JSON.stringify(provisioningPayload, null, 2)
    : "";
  const provisioningUrlText = provisioningUrl ?? "";
  const provisioningBackendUrl = (provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url || "").trim();
  const backendUrlHasLocalhost = provisioningBackendUrl.toLowerCase().includes("localhost");

  return (
    <div className="flex flex-col gap-6">

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div className="flex flex-col gap-1.5">
          <label>ESP setup base URL</label>
          <Input
            type="text"
            placeholder="ESP setup base URL"
            value={espSetupBaseUrl}
            onChange={(e) => {
              setEspSetupBaseUrl(e.target.value);
              setProvisioningUrl(null);
              setProvisioningPayload(null);
              setPairingError(null);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label>ESP provision path</label>
          <Input
            type="text"
            placeholder="ESP provision path"
            value={espProvisionPath}
            onChange={(e) => {
              setEspProvisionPath(e.target.value);
              setProvisioningUrl(null);
              setProvisioningPayload(null);
              setPairingError(null);
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div className="flex flex-col gap-1.5">
          <label>Wi-Fi SSID</label>
          <Input
            type="text"
            placeholder="Wi-Fi SSID"
            value={provisioningWifiSsid}
            onChange={(e) => {
              setProvisioningWifiSsid(e.target.value);
              setProvisioningUrl(null);
              setProvisioningPayload(null);
              setPairingError(null);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label>Wi-Fi password</label>
          <Input
            type="password"
            placeholder="Wi-Fi password"
            value={provisioningWifiPassword}
            onChange={(e) => {
              setProvisioningWifiPassword(e.target.value);
              setProvisioningUrl(null);
              setProvisioningPayload(null);
              setPairingError(null);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          Backend base URL
          {backendUrlHasLocalhost ? <span className="provisioning-warning-icon" aria-hidden="true"><WarningIcon /></span> : null}
        </label>
        <Input
          type="text"
          placeholder="Backend base URL"
          value={provisioningBackendBaseUrl}
          onChange={(e) => {
            setProvisioningBackendBaseUrl(e.target.value);
            setProvisioningUrl(null);
            setProvisioningPayload(null);
            setPairingError(null);
          }}
        />
      </div>

      <div className="flex flex-row items-center justify-between gap-8 flex-wrap" style={{ marginTop: "12px", marginBottom: "12px" }}>
        <Button
          type="button"
          disabled={pairingLoading || !provisioningWifiSsid.trim() || !(provisioningBackendBaseUrl.trim() || serviceInfo?.backend_base_url)}
          onClick={handleRequestPairing}
          className="btn-run-calibration"
          style={{ height: "40px", padding: "0 24px" }}
        >
          {pairingLoading ? "Generating..." : "Generate QR"}
        </Button>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="provisioningAutoSave"
            checked={provisioningAutoSave}
            onChange={(e) => {
              setProvisioningAutoSave(e.target.checked);
              setProvisioningUrl(null);
              setProvisioningPayload(null);
              setPairingError(null);
            }}
            style={{ width: "auto", margin: 0 }}
          />
          <label htmlFor="provisioningAutoSave" style={{ cursor: "pointer" }}>Auto-save on scan</label>
        </div>
      </div>

      <div style={{ display: "grid", gap: "6px", fontSize: "0.9rem", color: "#475569", background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
        <p style={{ margin: 0 }}>
          Service backend_base_url: <strong>{serviceInfo?.backend_base_url ?? "Unavailable"}</strong>
        </p>
        <p style={{ margin: 0 }}>
          Service mqtt_host: <strong>{serviceInfo?.mqtt_host ?? "Unavailable"}</strong>
        </p>
        <p style={{ margin: 0 }}>
          Service mqtt_port: <strong>{serviceInfo?.mqtt_port ?? "Unavailable"}</strong>
        </p>
        <p style={{ margin: 0 }}>
          Service local_ip: <strong>{serviceInfo?.local_ip ?? "Unavailable"}</strong>
        </p>
      </div>

      {serviceInfoError && (
        <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.9rem", fontWeight: 600 }}>
          {serviceInfoError}
        </p>
      )}

      {pairingError && (
        <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.9rem", fontWeight: 600 }}>
          {pairingError}
        </p>
      )}

      {provisioningPayload && provisioningUrl && (
        <div className="provisioning-qr-panel" style={{
          padding: "16px",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
          display: "grid",
          gap: "12px",
          justifyItems: "center",
        }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem" }}>
            Scan to provision firmware
          </p>
          <QR
            value={provisioningUrl}
            size={180}
            bgColor="#ffffff"
            fgColor="#0f172a"
            level="M"
          />
          <p style={{ margin: 0, color: "#475569", fontSize: "0.85rem", textAlign: "center" }}>
            QR URL includes wifi_ssid, wifi_pass, backend_base_url, and optional auto=1.
          </p>

          <div style={{ width: "100%", display: "grid", gap: "6px" }}>
            <p style={{ margin: 0, color: "#334155", fontSize: "0.9rem", fontWeight: 700 }}>
              Generated Provisioning URL
            </p>
            <code style={{
              display: "block",
              padding: "8px",
              background: "#e2e8f0",
              borderRadius: "4px",
              wordBreak: "break-all",
              fontSize: "0.8rem",
              color: "#0f172a",
            }}>
              {provisioningUrlText}
            </code>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(provisioningUrlText)}
              className="btn-reload"
            >
              Copy URL
            </Button>
          </div>

          <details style={{ width: "100%", fontSize: "0.85rem", color: "#64748b" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              Developer JSON copy
            </summary>
            <code style={{
              display: "block",
              marginTop: "6px",
              padding: "8px",
              background: "#e2e8f0",
              borderRadius: "4px",
              wordBreak: "break-all",
              fontSize: "0.8rem",
              color: "#0f172a",
            }}>
              {provisioningPayloadText}
            </code>
          </details>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(provisioningPayloadText)}
              className="btn-reload"
            >
              Copy JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
