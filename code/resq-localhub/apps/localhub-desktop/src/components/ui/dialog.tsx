import { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={() => onOpenChange(false)}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
          maxWidth: "500px",
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={{ padding: "20px", borderBottom: "1px solid #e2e8f0" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "#0f172a" }}>{title}</h2>
            {description && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.9rem", color: "#64748b" }}>{description}</p>
            )}
          </div>
        )}
        <div style={{ padding: "20px" }}>{children}</div>
      </div>
    </div>
  );
}

export function DialogContent({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "#0f172a" }}>{children}</h2>;
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <p style={{ margin: "4px 0 0 0", fontSize: "0.9rem", color: "#64748b" }}>{children}</p>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        justifyContent: "flex-end",
        marginTop: "20px",
        paddingTop: "20px",
        borderTop: "1px solid #e2e8f0",
      }}
    >
      {children}
    </div>
  );
}
