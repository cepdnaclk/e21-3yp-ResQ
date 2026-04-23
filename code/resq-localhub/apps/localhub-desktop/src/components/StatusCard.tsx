import type { ReactNode } from "react";

type StatusCardProps = {
  title: string;
  status: string;
  detail: string;
  statusTone?: "healthy" | "ready" | "running" | "stopped" | "checking" | "error";
  actions?: ReactNode;
};

function toneStyles(tone: NonNullable<StatusCardProps["statusTone"]>): React.CSSProperties {
  switch (tone) {
    case "healthy":
    case "ready":
    case "running":
      return { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" };
    case "stopped":
    case "error":
      return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" };
    case "checking":
      return { background: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" };
    default:
      return { background: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" };
  }
}

export default function StatusCard({ title, status, detail, statusTone = "checking", actions }: StatusCardProps) {
  return (
    <article
      style={{
        border: "1px solid #dbe3ee",
        borderRadius: "12px",
        padding: "14px",
        background: "#ffffff",
        boxShadow: "0 3px 10px rgba(15, 23, 42, 0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>{title}</h3>
        <span
          style={{
            ...toneStyles(statusTone),
            borderRadius: "999px",
            fontSize: "0.76rem",
            fontWeight: 700,
            letterSpacing: "0.02em",
            padding: "4px 10px",
            whiteSpace: "nowrap",
          }}
        >
          {status}
        </span>
      </div>
      <p style={{ margin: 0, color: "#475569", fontSize: "0.92rem", lineHeight: 1.4 }}>{detail}</p>
      {actions ? <div style={{ marginTop: "10px" }}>{actions}</div> : null}
    </article>
  );
}
