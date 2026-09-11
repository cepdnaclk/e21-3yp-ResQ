import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ErrorState from "./ErrorState";

interface Props {
  children?: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="py-12 select-none animate-fadeIn">
          <ErrorState
            title="Application Error"
            message={
              this.props.fallbackMessage ||
              this.state.error?.message ||
              "An unexpected error occurred in the user interface."
            }
            onRetry={this.handleReload}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
