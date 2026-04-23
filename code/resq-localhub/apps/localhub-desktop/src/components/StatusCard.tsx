import type { ReactNode } from "react";

type StatusCardProps = {
  title: string;
  status: string;
  detail: string;
  actions?: ReactNode;
};

export default function StatusCard({ title, status, detail, actions }: StatusCardProps) {
  return (
    <article style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px" }}>
      <h3 style={{ margin: "0 0 6px" }}>{title}</h3>
      <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{status}</p>
      <p style={{ margin: 0, color: "#6b7280", fontSize: "0.92rem" }}>{detail}</p>
      {actions ? <div style={{ marginTop: "10px" }}>{actions}</div> : null}
    </article>
  );
}
