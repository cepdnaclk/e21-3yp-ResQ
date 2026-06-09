import { QRCodeSVG } from "qrcode.react";

const QR = QRCodeSVG as any;

type QrPanelProps = {
  instructorUrl: string | null;
  unavailableMessage: string;
};

export default function QrPanel({ instructorUrl, unavailableMessage }: QrPanelProps) {
  return (
    <div className="qr-card qr-card--dashboard">
      <div className="qr-card__glow" aria-hidden="true" />
      <div className="qr-card__header">
        <div className="qr-card__header-copy">
          <p className="qr-card__eyebrow">Dashboard Access</p>
          <h3 className="qr-card__title">Instructor Dashboard QR</h3>
          <p className="qr-card__detail">
            Scan this QR code to open the instructor dashboard from another device on the same LAN.
          </p>
        </div>
        <span className="qr-card__badge">LAN Ready</span>
      </div>

      <div className="qr-card__content">
        {instructorUrl ? (
          <div className="qr-hero">
            <div className="qr-code-wrapper">
              <QR value={instructorUrl} size={208} level="H" includeMargin={true} className="qr-code-svg" />
            </div>
            <div className="qr-code-info">
              <code className="qr-code-info__value">{instructorUrl}</code>
              <a href={instructorUrl} className="qr-code-info__link">
                Open Instructor Dashboard
              </a>
            </div>
          </div>
        ) : (
          <div className="qr-card__empty">{unavailableMessage}</div>
        )}
      </div>
    </div>
  );
}
