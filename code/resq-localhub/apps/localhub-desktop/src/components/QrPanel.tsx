import { QRCodeSVG } from "qrcode.react";

type QrPanelProps = {
  instructorUrl: string | null;
  unavailableMessage: string;
};

function QrTile({ title, url }: { title: string; url: string | null }) {
  const hasUrl = Boolean(url);

  return (
    <article
      style={{
        border: "1px solid #dbe3ee",
        borderRadius: "12px",
        padding: "12px",
        display: "grid",
        gap: "10px",
        justifyItems: "center",
      }}
    >
      <h4 style={{ margin: 0, fontSize: "0.95rem" }}>{title}</h4>
      {hasUrl && url ? (
        <QRCodeSVG value={url} size={144} bgColor="#ffffff" fgColor="#0f172a" level="M" />
      ) : (
        <div
          style={{
            width: 144,
            height: 144,
            borderRadius: "10px",
            border: "1px dashed #cbd5e1",
            display: "grid",
            placeItems: "center",
            color: "#64748b",
            fontSize: "0.85rem",
            textAlign: "center",
            padding: "8px",
          }}
        >
          URL unavailable
        </div>
      )}
      <p
        style={{
          margin: 0,
          color: "#475569",
          fontSize: "0.82rem",
          lineHeight: 1.35,
          wordBreak: "break-all",
          textAlign: "center",
        }}
      >
        {url ?? "Set a LAN host in Setup to generate this QR."}
      </p>
    </article>
  );
}

export default function QrPanel({ instructorUrl, unavailableMessage }: QrPanelProps) {
  return (
    <section
      style={{
        border: "1px solid #dbe3ee",
        borderRadius: "12px",
        padding: "14px",
        background: "#ffffff",
        boxShadow: "0 3px 10px rgba(15, 23, 42, 0.04)",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: "6px" }}>Access QR Codes</h3>
      <p style={{ marginTop: 0, marginBottom: "12px", color: "#64748b", fontSize: "0.92rem" }}>
        Scan to open local dashboards. Keep devices on the same LAN.
      </p>

      {!instructorUrl ? (
        <p style={{ marginTop: 0, marginBottom: "12px", color: "#b45309", fontSize: "0.88rem" }}>
          {unavailableMessage}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" }}>
        <QrTile title="Instructor Dashboard" url={instructorUrl} />
      </div>
    </section>
  );
}
