import React, { type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

type AppErrorBoundaryProps = {
  children: ReactNode;
};

export default class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: "",
    };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Fatal UI render error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f3f6fb" }}>
          <div style={{ maxWidth: "680px", width: "100%", background: "#ffffff", border: "1px solid #dbe5f1", borderRadius: "14px", padding: "18px", boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)" }}>
            <h1 style={{ margin: "0 0 8px", fontSize: "1.2rem", color: "#0f172a" }}>ResQ UI failed to render</h1>
            <p style={{ margin: "0 0 12px", color: "#334155" }}>
              A runtime error occurred while rendering the desktop UI. Use Refresh All or restart the app after fixing the error.
            </p>
            <pre style={{ margin: 0, padding: "10px", borderRadius: "8px", background: "#f8fafc", color: "#991b1b", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {this.state.message}
            </pre>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
