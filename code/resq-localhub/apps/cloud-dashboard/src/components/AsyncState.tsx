export function LoadingState({ message = "Loading synced sessions…" }: { message?: string }) {
  return (
    <div className="state-panel" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <h2>Loading</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <div>
        <p className="eyebrow">Connection problem</p>
        <h2>Cloud data could not be loaded</h2>
        <p>{message}</p>
        {onRetry ? <button className="button" onClick={onRetry}>Try again</button> : null}
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="state-panel">
      <div>
        <p className="eyebrow">No records yet</p>
        <h2>No synced sessions</h2>
        <p>Complete a LocalHub session with cloud sync enabled, then refresh this page.</p>
      </div>
    </div>
  );
}
