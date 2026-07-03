import type { DeviceReadinessState } from "../../types/manikin";
import StatusBadge from "../ui/StatusBadge";

type DeviceReadinessBadgeProps = {
  readiness?: DeviceReadinessState | null;
  loading?: boolean;
  error?: string | null;
};

export function DeviceReadinessBadge({ readiness, loading, error }: DeviceReadinessBadgeProps) {
  if (loading) {
    return <StatusBadge tone="muted" label="Checking..." dot={true} />;
  }

  if (error) {
    return <StatusBadge tone="danger" label="Readiness unavailable" dot={false} />;
  }

  if (!readiness) {
    return <StatusBadge tone="muted" label="Unknown" dot={true} />;
  }

  switch (readiness.calibrationState) {
    case "READY":
      return <StatusBadge tone="success" label="Ready" dot={true} />;
    case "CALIBRATING":
      return <StatusBadge tone="info" label="Calibrating" dot={true} />;
    case "STARTING":
      return <StatusBadge tone="info" label="Starting calibration" dot={true} />;
    case "FAILED":
      return <StatusBadge tone="danger" label="Calibration failed" dot={true} />;
    case "INTERRUPTED":
      return <StatusBadge tone="danger" label="Interrupted" dot={true} />;
    case "CANCELLED":
      return <StatusBadge tone="warning" label="Cancelled" dot={true} />;
    case "NOT_READY":
      return <StatusBadge tone="warning" label="Not calibrated" dot={true} />;
    case "UNKNOWN":
    default:
      return <StatusBadge tone="muted" label="Unknown" dot={true} />;
  }
}

export default DeviceReadinessBadge;
