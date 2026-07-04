import { useEffect, useState } from "react";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";
import { buildProvisioningUrl } from "../../utils/provisioningUrl";
import { fetchHubServiceInfo } from "../../lib/browserManikinsProvisionApi";
import { QRCodeSVG } from "qrcode.react";

type PairManikinPageProps = {
  onBack: () => void;
};

export function PairManikinPage({ onBack }: PairManikinPageProps) {
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [backendBaseUrl, setBackendBaseUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [localIp, setLocalIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-detect and prefill the LocalHub address on mount
  useEffect(() => {
    async function loadIp() {
      try {
        const info = await fetchHubServiceInfo();
        if (
          info &&
          info.local_ip &&
          info.local_ip !== "localhost" &&
          info.local_ip !== "127.0.0.1" &&
          info.local_ip !== "0.0.0.0"
        ) {
          setLocalIp(info.local_ip);
          setBackendBaseUrl(`http://${info.local_ip}:18080`);
        }
      } catch (err) {
        console.warn("Failed to retrieve LocalHub service info", err);
      }
    }
    loadIp();
  }, []);

  function handleGenerateQr(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!wifiSsid.trim()) {
      setError("Training Wi-Fi name is required.");
      return;
    }
    if (!wifiPassword.trim()) {
      setError("Training Wi-Fi password is required.");
      return;
    }
    if (!backendBaseUrl.trim()) {
      setError("LocalHub address is required.");
      return;
    }
    if (!backendBaseUrl.startsWith("http://") && !backendBaseUrl.startsWith("https://")) {
      setError("LocalHub address must start with 'http://' or 'https://'.");
      return;
    }

    setLoading(true);
    // Mimic quick visual feedback generator latency
    setTimeout(() => {
      const url = buildProvisioningUrl({
        wifiSsid: wifiSsid.trim(),
        wifiPassword: wifiPassword,
        backendBaseUrl: backendBaseUrl.trim(),
      });
      setQrUrl(url);
      setLoading(false);
    }, 400);
  }

  function handleClearDetails() {
    setWifiSsid("");
    setWifiPassword("");
    if (localIp) {
      setBackendBaseUrl(`http://${localIp}:18080`);
    } else {
      setBackendBaseUrl("");
    }
    setQrUrl(null);
    setError(null);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 select-none">
      <PageHeader
        title="Pair Manikin"
        subtitle="Connect a physical training manikin to your training setup."
        back={{ label: "Back to Dashboard", onClick: onBack }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: Guide & Illustration */}
        <Card className="bg-gradient-to-br from-[#0a232c] to-[#0e3543] text-white border-transparent p-8 flex flex-col justify-between shadow-lg">
          <div className="space-y-6">
            <span className="text-[10px] font-extrabold bg-teal-500/20 text-teal-400 px-3 py-1.5 rounded-full uppercase tracking-wider inline-block">
              Connection Guide
            </span>
            <div className="space-y-4">
              <h3 className="text-xl font-bold tracking-tight">Prepare the manikin</h3>
              <p className="text-xs text-slate-300 leading-relaxed font-normal font-sans">
                Follow these steps to connect your manikin sensors to the classroom training network:
              </p>
            </div>

            <ol className="space-y-4 text-xs text-slate-300 font-normal leading-relaxed font-sans">
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-teal-500/30 text-teal-300 font-bold flex items-center justify-center shrink-0">1</span>
                <span>Turn on the manikin.</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-teal-500/30 text-teal-300 font-bold flex items-center justify-center shrink-0">2</span>
                <span>Connect your phone or tablet to the Wi-Fi network created by the manikin (Manikin setup Wi-Fi).</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-teal-500/30 text-teal-300 font-bold flex items-center justify-center shrink-0">3</span>
                <span>Scan the QR code shown here on your phone or tablet.</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-teal-500/30 text-teal-300 font-bold flex items-center justify-center shrink-0">4</span>
                <span>The manikin will save these settings automatically, reconnect to the training Wi-Fi, and appear online.</span>
              </li>
            </ol>
          </div>

          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider pt-6 border-t border-teal-800/40">
            ResQ Provisioning Protocol
          </div>
        </Card>

        {/* Right: Actions form */}
        <Card className="p-8 sm:p-10 shadow-[0_8px_30px_rgba(15,23,42,0.02)] border border-slate-100 flex flex-col justify-center">
          {!qrUrl ? (
            <form onSubmit={handleGenerateQr} className="space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-800 tracking-tight leading-none mb-1.5">Connect Manikin to Training Wi-Fi</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-normal">Enter the training network details to configure the manikin sensors.</p>
              </div>

              <div>
                <label htmlFor="wifiSsid" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Training Wi-Fi name
                </label>
                <input
                  id="wifiSsid"
                  type="text"
                  required
                  value={wifiSsid}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  placeholder="e.g. TrainingRoom_Wi-Fi"
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label htmlFor="wifiPassword" className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Training Wi-Fi password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-teal-600 hover:text-teal-700 font-bold transition-colors cursor-pointer"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id="wifiPassword"
                  type={showPassword ? "text" : "password"}
                  required
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                />
              </div>

              {/* Advanced Settings Collapsible */}
              <div className="border-t border-slate-100 pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-700 transition-colors cursor-pointer"
                >
                  <svg
                    className={`w-3.5 h-3.5 transform transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  Advanced Network Settings
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4 animate-fadeIn">
                    <div>
                      <label htmlFor="backendBaseUrl" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                        LocalHub address
                      </label>
                      <input
                        id="backendBaseUrl"
                        type="text"
                        required
                        value={backendBaseUrl}
                        onChange={(e) => setBackendBaseUrl(e.target.value)}
                        placeholder="http://192.168.8.105:18080"
                        className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 font-medium"
                      />
                      {!localIp && (
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed font-sans">
                          Use the LocalHub address reachable from the training Wi-Fi. It usually looks like http://192.168.x.x:18080.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-100 text-xs font-semibold text-rose-700 leading-normal">
                  {error}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-3 border-t border-slate-100 mt-2">
                <Button type="button" variant="secondary" onClick={onBack}>
                  Cancel
                </Button>
                <Button type="submit" loading={loading}>
                  Generate setup QR
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-6 text-center py-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xl shadow-sm shadow-emerald-200">
                ✓
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-800 leading-tight">Setup QR Code Generated</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Scan this after connecting your phone/tablet to the manikin setup Wi-Fi network.
                </p>
              </div>

              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 max-w-xs mx-auto flex flex-col items-center gap-4">
                <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-inner">
                  <QRCodeSVG value={qrUrl} size={160} />
                </div>
                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                  Manikin will save these settings automatically
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-center gap-3 pt-5 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  className="font-bold border border-slate-200/80 bg-white"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(qrUrl);
                      alert("Provisioning link copied to clipboard.");
                    } catch (err) {
                      alert("Failed to copy link to clipboard.");
                    }
                  }}
                >
                  Copy Link
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="font-bold border border-slate-200/80 bg-white"
                  onClick={() => window.open(qrUrl, "_blank")}
                >
                  Open Setup Link
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="font-bold"
                  onClick={handleClearDetails}
                >
                  Clear Details
                </Button>
              </div>
              <div className="pt-2">
                <Button type="button" variant="primary" className="font-bold px-6" onClick={onBack}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default PairManikinPage;
