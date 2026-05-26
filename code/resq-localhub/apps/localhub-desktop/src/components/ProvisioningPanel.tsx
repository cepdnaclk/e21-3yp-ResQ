import React, { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { requestManikinPairing } from "../lib/browserManikinsProvisionApi";
import { fetchManikinInventory } from "../lib/browserManikinsApi";

const QR = QRCodeSVG as any;

export default function ProvisioningPanel() {
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [provisionUrl, setProvisionUrl] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);
  const [pairState, setPairState] = useState<"idle" | "copied" | "generating">("idle");
  const [knownDevices, setKnownDevices] = useState<string[]>([]);
  const confettiRef = useRef<HTMLDivElement | null>(null);

  // Build a demo provisioning URL for the QR (keeps functionality while letting devices parse token/device)
  function buildProvisionUrl(device: string, token: string) {
    // Use the device's soft AP setup host which devices commonly expose
    return `http://192.168.4.1/setup?deviceId=${encodeURIComponent(device)}&pairingToken=${encodeURIComponent(token)}`;
  }

  async function handleGenerate() {
    const id = deviceId.trim() || `MANIKIN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setLoading(true);
    setPairState("generating");

    try {
      const resp = await requestManikinPairing(id);
      setTokenExpiresAt(resp.expiresAt);
      setProvisionUrl(buildProvisionUrl(resp.deviceId, resp.token));
      setPairState("idle");
      // copy url to clipboard state shortcut
      try {
        await navigator.clipboard.writeText(buildProvisionUrl(resp.deviceId, resp.token));
        setPairState("copied");
        window.setTimeout(() => setPairState("idle"), 1400);
      } catch {}
    } catch (err) {
      console.error("Failed to request pairing token:", err);
      setPairState("idle");
    } finally {
      setLoading(false);
    }
  }

  // Poll inventory to detect newly registered devices and trigger confetti
  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function poll() {
      try {
        const entries = await fetchManikinInventory();
        if (!mounted) return;
        const ids = entries.map((e) => e.deviceId).filter(Boolean);
        // detect new devices
        const newOnes = ids.filter((id) => !knownDevices.includes(id));
        if (newOnes.length > 0 && knownDevices.length > 0) {
          // dynamic import confetti so it's only used if needed
            try {
            // Use @vite-ignore so the bundler won't try to resolve this at build-time
            const confettiModule = await import(/* @vite-ignore */ "canvas-confetti");
            const confetti = confettiModule.default || confettiModule;
            confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
          } catch (e) {
            // ignore if library not available
          }
        }
        setKnownDevices(ids);
      } catch (e) {
        // ignore polling errors
      } finally {
        timer = window.setTimeout(poll, 5000) as unknown as number;
      }
    }

    void poll();

    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [knownDevices]);

  // detect localhost backend (simple heuristic)
  const backendIsLocalhost = typeof window !== "undefined" && /localhost|127\.0\.0\.1/.test(window.location.hostname);

  return (
    <div className="qr-card qr-card--provisioning">
      <div className="qr-card__header">
        <div className="qr-card__header-copy">
          <p className="qr-card__eyebrow">Manikin Setup</p>
          <h3 className="qr-card__title">Provisioning QR Code</h3>
          <p className="qr-card__detail">Scan this QR to open the manikin's setup page with Wi‑Fi and broker details pre‑filled.</p>
        </div>
        <span className="qr-card__badge">Provision</span>
      </div>

      <div className="qr-card__content">
        <div className="qr-code-tile">
          <div className="qr-code-wrapper provision-qr-wrapper">
            {provisionUrl ? (
              <QR value={provisionUrl} size={192} level="H" includeMargin={true} className="qr-code-svg" />
            ) : (
              <div style={{ padding: 20, color: "#64748b" }}>Generate a provisioning QR to begin pairing.</div>
            )}
          </div>

          <div className="qr-code-info">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>SSID</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input placeholder="ResQ-XXXX" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }} />
                <span className="wifi-icon" aria-hidden="true" title="Wi‑Fi strength (demo)">
                  <svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="8" width="3" height="6" rx="1" fill="#0f172a" />
                    <rect x="8" y="5" width="3" height="9" rx="1" fill="#0f172a" />
                    <rect x="14" y="2" width="3" height="12" rx="1" fill="#0f172a" />
                  </svg>
                </span>
              </div>
            </label>

            <p className="qr-code-info__label" style={{ marginTop: 8 }}>Instructions</p>
            <code className="qr-code-info__value" style={{ fontSize: "0.85rem" }}>
              1. Scan QR with phone
              <br />2. Connect to ResQ‑XXXX Wi‑Fi
              <br />3. Open setup page URL
            </code>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="button button--primary" onClick={handleGenerate} disabled={loading}>
                {loading ? "Generating..." : "Generate QR"}
              </button>
              <button
                className="button button--secondary"
                onClick={async () => {
                  if (!provisionUrl) return;
                  try {
                    await navigator.clipboard.writeText(provisionUrl);
                    setPairState("copied");
                    window.setTimeout(() => setPairState("idle"), 1200);
                  } catch {}
                }}
                disabled={!provisionUrl}
              >
                {pairState === "copied" ? "Copied" : "Copy URL"}
              </button>
            </div>

            {tokenExpiresAt ? <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>Token expires: {new Date(tokenExpiresAt).toLocaleTimeString()}</p> : null}

            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <div className="need-help-tooltip">
                Need help?
                <span className="tooltip-arrow" aria-hidden="true">➜</span>
                <div className="tooltip-panel">Follow the steps above to provision a new manikin.</div>
              </div>

              {backendIsLocalhost ? <div className="shaking-warning" title="Backend running on localhost — devices on other hosts may not reach this host">⚠️ Localhost</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
