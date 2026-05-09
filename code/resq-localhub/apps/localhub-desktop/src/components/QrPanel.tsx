import { QRCodeSVG } from "qrcode.react";
const QR = QRCodeSVG as any;
import { Card, Badge } from "./ui";

type QrPanelProps = {
  instructorUrl: string | null;
  unavailableMessage: string;
};

function QrTile({ title, url }: { title: string; url: string | null }) {
  const hasUrl = Boolean(url);

  return (
    <Card className="" aria-label={title}>
      <h4 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: "600", textAlign: "center" }}>{title}</h4>
      {hasUrl && url ? (
        <div style={{ padding: "12px", display: "inline-block", textAlign: "center" }}>
          <QR value={url} size={168} bgColor="#ffffff" fgColor="#0f172a" level="M" />
        </div>
      ) : (
        <div style={{ height: "168px", width: "168px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #d1d5db", borderRadius: "8px", backgroundColor: "#f9fafb", margin: "0 auto", color: "#6b7280", fontSize: "14px" }}>
          URL unavailable
        </div>
      )}
      <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#6b7280", wordBreak: "break-all" }}>
        {url ?? "Set a LAN host in Setup to generate this QR."}
      </p>
    </Card>
  );
}

export default function QrPanel({ instructorUrl, unavailableMessage }: QrPanelProps) {
  return (
    <Card>
      <div style={{ marginBottom: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "#1f2937" }}>Access QR</h3>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: "14px", color: "#6b7280", lineHeight: "1.5" }}>
        Scan to open secure local dashboards used for clinical training and device oversight.
      </p>

      {!instructorUrl ? (
        <p style={{ margin: "0 0 12px", fontSize: "14px", color: "#b45309" }}>
          {unavailableMessage}
        </p>
      ) : null}

      <div style={{ display: "flex", justifyContent: "center" }}>
        <QrTile title="Instructor Dashboard" url={instructorUrl} />
      </div>
    </Card>
  );
}
