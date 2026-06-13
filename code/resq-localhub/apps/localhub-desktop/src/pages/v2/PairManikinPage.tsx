import { useState } from "react";
import { requestPairingToken } from "../../api/manikinsApi";
import type { ManikinPairTokenResponse } from "../../types/manikin";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import PageHeader from "../../components/ui/PageHeader";

type PairManikinPageProps = {
  onBack: () => void;
};

export function PairManikinPage({ onBack }: PairManikinPageProps) {
  const [deviceId, setDeviceId] = useState("");
  const [tokenInfo, setTokenInfo] = useState<ManikinPairTokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePairRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceId.trim()) return;

    setLoading(true);
    setError(null);
    setTokenInfo(null);

    try {
      const res = await requestPairingToken(deviceId.trim());
      setTokenInfo(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate pairing token.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Pair New Manikin"
        subtitle="Generate a authorization token to connect a physical manikin to this hub."
        back={{ label: "Back to Dashboard", onClick: onBack }}
      />

      <Card>
        {!tokenInfo ? (
          <form onSubmit={handlePairRequest} className="space-y-4">
            <div>
              <label htmlFor="deviceId" className="block text-sm font-semibold text-gray-700">
                Device Identifier (MAC Address / Serial Number)
              </label>
              <input
                id="deviceId"
                type="text"
                required
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="e.g. resq-manikin-01 or aa:bb:cc:dd:ee:ff"
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-900 bg-white"
              />
              <p className="text-xs text-gray-400 mt-1">
                Enter the unique hardware identifier printed on the manikin's control module or label.
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 border border-red-200 text-sm font-medium text-red-800">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="secondary" onClick={onBack}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Generate Pairing Token
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-6 py-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xl">
              ✓
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Pairing Token Generated</h3>
              <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                Enter this token code on the manikin's setup page or control screen to authorize the connection.
              </p>
            </div>

            <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 max-w-sm mx-auto">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Pairing Code</span>
              <div className="text-3xl font-mono font-black tracking-wider text-blue-600 mt-1 select-all">
                {tokenInfo.token}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Expires at {new Date(tokenInfo.expiresAt).toLocaleTimeString()}
              </div>
            </div>

            <div className="flex justify-center gap-3 pt-4 border-t border-gray-100">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setTokenInfo(null);
                  setDeviceId("");
                }}
              >
                Pair Another Device
              </Button>
              <Button type="button" variant="primary" onClick={onBack}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default PairManikinPage;
