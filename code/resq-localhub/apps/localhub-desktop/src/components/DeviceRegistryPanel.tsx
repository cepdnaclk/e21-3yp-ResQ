import { type ManikinRegistryEntry } from "../lib/browserManikinRegistryApi";
import DeviceRegistryIcon from "./icons/DeviceRegistryIcon";

type DeviceRegistryPanelProps = {
  registry: ManikinRegistryEntry[];
  loading: boolean;
  error: string | null;
};

export function DeviceRegistryPanel({
  registry,
  loading,
  error,
}: DeviceRegistryPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center border-b border-gray-200 pb-4 mb-2 flex-wrap gap-3">
        <div className="flex items-center gap-2 text-gray-650">
          <DeviceRegistryIcon size={18} />
          <span className="text-sm font-semibold uppercase tracking-wider">Registered Manikins</span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && !error && (
            <span
              className="text-xs font-bold bg-blue-50 text-[#005A9C] px-3 py-1.5 rounded-full border border-blue-100"
              style={{ display: "inline-flex", alignItems: "center", transform: "translateY(-2px)" }}
            >
              {registry.filter((m) => m.online).length} / {registry.length}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading device registry...</p>
      ) : error ? (
        <p className="text-sm text-[#D13438]">{error}</p>
      ) : registry.length === 0 ? (
        <p className="text-sm text-gray-500">
          No devices in registry yet. Manikins appear here once they connect and publish status.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {registry.map((manikin) => (
            <div
              key={manikin.deviceId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderRadius: "8px",
                border: manikin.online ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                background: manikin.online ? "#f0fdf4" : "#f8fafc",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "grid", gap: "2px" }}>
                <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                  {manikin.deviceId}
                </span>
                <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
                  {manikin.ip ?? "No IP"} · FW {manikin.fw ?? "unknown"}
                </span>
              </div>

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: "999px",
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    background: manikin.online ? "#dcfce7" : "#fee2e2",
                    color: manikin.online ? "#166534" : "#991b1b",
                  }}
                >
                  {manikin.online ? "Online" : "Offline"}
                </span>

                {manikin.state && (
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "999px",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      background: "#e2e8f0",
                      color: "#334155",
                    }}
                  >
                    {manikin.state}
                  </span>
                )}

                {manikin.rssi !== null && (
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "999px",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      background:
                        manikin.rssi > -60
                          ? "#dcfce7"
                          : manikin.rssi > -75
                            ? "#fef3c7"
                            : "#fee2e2",
                      color:
                        manikin.rssi > -60
                          ? "#166534"
                          : manikin.rssi > -75
                            ? "#92400e"
                            : "#991b1b",
                    }}
                  >
                    {manikin.rssi} dBm
                  </span>
                )}

                <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                  {manikin.lastSeen
                    ? `${new Date(manikin.lastSeen).toLocaleTimeString()}`
                    : "Never"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
