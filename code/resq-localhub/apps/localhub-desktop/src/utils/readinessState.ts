import type { FirmwareReadinessResponse } from "../types/firmware";
import type { ManikinLiveSummary } from "../types/manikin";

export type ReadinessUiState =
  | "OFFLINE"
  | "CALIBRATION_REQUIRED"
  | "CALIBRATING"
  | "READY"
  | "FAILED"
  | "ACTIVE_SESSION"
  | "ERROR"
  | "UNKNOWN";

export const REASON_MESSAGES: Record<string, string> = {
  "00000": "No issue detected.",
  "08101": "Invalid calibration values were sent.",
  "08102": "Calibration is already running.",
  "08401": "Reference pressure target was not reached.",
  "08402": "Left bladder pressure target was not reached.",
  "08403": "Right bladder pressure target was not reached.",
  "08404": "Hall baseline could not be read.",
  "08405": "Full press target was not reached.",
  "08406": "Full press pressure values could not be read.",
  "08407": "Left/right pressure imbalance is too high.",
  "08408": "Calibration values are outside the valid range.",
  "08409": "Sensor readings are stuck or too noisy.",
  "08701": "Calibration was cancelled."
};

export const ACTION_MESSAGES: Record<number, string> = {
  0: "No action required.",
  1: "Check the calibration values and try again.",
  2: "Wait for the current operation to finish or cancel it.",
  3: "Check the sensor placement and retry calibration.",
  4: "Check sensor wiring/noise and retry.",
  5: "Retry when the device is stable and connected.",
  6: "Return to idle and discard temporary calibration values.",
  13: "Device is in error state. Use firmware recovery actions."
};

export function getFriendlyReason(reasonId: string | null | undefined): string {
  if (!reasonId) return "Unknown failure reason.";
  return REASON_MESSAGES[reasonId] || `Error code: ${reasonId}.`;
}

export function getFriendlyAction(actionId: number | null | undefined): string {
  if (actionId === null || actionId === undefined) return "Please retry or request a debug snapshot.";
  return ACTION_MESSAGES[actionId] || "Please contact support if the issue persists.";
}

export function deriveReadinessUiState(
  liveSummary: ManikinLiveSummary | null | undefined,
  readiness: FirmwareReadinessResponse | null | undefined
): ReadinessUiState {
  const readinessFirmwareState = readiness?.firmwareState?.toUpperCase();

  if (
    readinessFirmwareState === "STARTING" ||
    readinessFirmwareState === "CALIBRATING"
  ) {
    return "CALIBRATING";
  }

  if (
    readinessFirmwareState === "CALIBRATION_FAIL" ||
    readinessFirmwareState === "CALIBRATION_CANCELLED" ||
    readiness?.latestResult?.toUpperCase() === "FAIL" ||
    readiness?.latestResult?.toUpperCase() === "CANCELLED"
  ) {
    return "FAILED";
  }

  if (readinessFirmwareState === "ERROR") {
    return "ERROR";
  }

  if (!liveSummary || !liveSummary.online || liveSummary.offline || liveSummary.stale) {
    return "OFFLINE";
  }

  const state = liveSummary.state?.toUpperCase();
  const sessionActive = liveSummary.sessionActive || state === "SESSION_ACTIVE";

  if (sessionActive) {
    return "ACTIVE_SESSION";
  }

  if (state === "READY_FOR_SESSION" && (readiness?.readyForSession || readiness?.ready)) {
    return "READY";
  }

  if (state === "CALIBRATING" || state === "CALIBRATION_ACTIVE") {
    return "CALIBRATING";
  }

  if (state === "CALIBRATION_FAIL" || state === "CALIBRATION_FAILED" || state === "FAIL") {
    return "FAILED";
  }

  if (state === "ERROR") {
    return "ERROR";
  }

  if (state === "PAIRED_IDLE") {
    if (readiness?.readyForSession || readiness?.ready) {
      return "READY";
    }
    return "CALIBRATION_REQUIRED";
  }

  // Fallback to check readiness fields
  if (readiness?.readyForSession || readiness?.ready) {
    return "READY";
  }
  if (readinessFirmwareState === "CALIBRATING") {
    return "CALIBRATING";
  }
  if (readinessFirmwareState === "CALIBRATION_FAIL") {
    return "FAILED";
  }
  if (readinessFirmwareState === "ERROR") {
    return "ERROR";
  }
  if (readinessFirmwareState === "PAIRED_IDLE") {
    return "CALIBRATION_REQUIRED";
  }

  return "UNKNOWN";
}
