import type { CalibrationStartRequest } from "../types/manikin";

export type CalibrationTargetStatus =
  | "PENDING"
  | "ACTIVE"
  | "BELOW_TARGET"
  | "NEAR_TARGET"
  | "REACHED"
  | "ABOVE_TARGET"
  | "INVALID"
  | "COMPLETED"
  | "FAILED";

export type CalibrationRawSample = {
  pressure0Raw: number | null;
  pressure0RawValid: boolean;
  pressure1Raw: number | null;
  pressure1RawValid: boolean;
  pressure2Raw: number | null;
  pressure2RawValid: boolean;
  hallRaw: number | null;
  hallRawValid: boolean;
  hallMm: number | null;
  hallMmValid: boolean;
  receivedAt: string | null;
};

export type CalibrationTargetDisplay = {
  id: "reference" | "bladder1" | "bladder2" | "baseline" | "full";
  label: string;
  targetValue: number | null;
  targetLabel?: string;
  currentValue: number | null;
  unit: string;
  difference: number | null;
  progressPercent: number | null;
  status: CalibrationTargetStatus;
  guidance: string;
  active: boolean;
  rawValid: boolean;
  reached: boolean;
  currentHallRaw?: number | null;
  capturedHallBaseline?: number | null;
  currentHallDelta?: number | null;
  maximumHallDelta?: number | null;
  targetHallDelta?: number | null;
  currentDepthMm?: number | null;
  targetDepthMm?: number | null;
  depthEstimated?: boolean;
};

export const INVALID_RAW_SENTINEL = -999999;

const FAILURE_STAGE: Record<string, CalibrationTargetDisplay["id"]> = {
  "08401": "reference",
  "08402": "bladder1",
  "08403": "bladder2",
  "08404": "baseline",
  "08405": "full",
  "08412": "full",
  "08413": "full",
  "08414": "full",
  "08418": "baseline",
};

const COMPLETION_PROGRESS: Record<CalibrationTargetDisplay["id"], number> = {
  reference: 3,
  bladder1: 5,
  bladder2: 7,
  baseline: 8,
  full: 10,
};

const ACTIVE_PROGRESS: Partial<Record<number, CalibrationTargetDisplay["id"]>> = {
  2: "reference",
  4: "bladder1",
  6: "bladder2",
  7: "baseline",
  9: "full",
};

export function isUsableRaw(value: number | null | undefined, valid: boolean | null | undefined): value is number {
  return valid === true && typeof value === "number" && Number.isFinite(value) && value !== INVALID_RAW_SENTINEL;
}

export function estimateCalibrationDepthMm(
  currentHallDelta: number | null,
  targetHallDelta: number | null,
  fullDepthMm: number | null,
): number | null {
  if (
    currentHallDelta === null || targetHallDelta === null || fullDepthMm === null ||
    !Number.isFinite(currentHallDelta) || !Number.isFinite(targetHallDelta) || !Number.isFinite(fullDepthMm) ||
    targetHallDelta <= 0 || fullDepthMm <= 0
  ) return null;
  const estimate = (currentHallDelta / targetHallDelta) * fullDepthMm;
  return Number.isFinite(estimate) ? estimate : null;
}

export function buildCalibrationTargets(input: {
  config: CalibrationStartRequest | null;
  sample: CalibrationRawSample | null;
  progressId: number;
  lastCompletedProgressId: number;
  reasonId: string | null;
  hallBaselineRaw: number | null;
  fullDepthMm: number | null;
  maxHallDelta?: number | null;
}): CalibrationTargetDisplay[] {
  const { config, sample, progressId, lastCompletedProgressId, reasonId, hallBaselineRaw, fullDepthMm, maxHallDelta = null } = input;
  const effectiveProgress = progressId >= 12 ? lastCompletedProgressId : progressId;
  const activeId = ACTIVE_PROGRESS[progressId];
  const failedId = progressId === 12 && reasonId ? FAILURE_STAGE[reasonId] : undefined;

  const pressure = (
    id: "reference" | "bladder1" | "bladder2",
    label: string,
    target: number | null,
    current: number | null,
    valid: boolean,
  ): CalibrationTargetDisplay => compareTarget({
    id,
    label,
    target,
    current,
    valid: isUsableRaw(current, valid),
    active: activeId === id,
    completed: effectiveProgress >= COMPLETION_PROGRESS[id],
    failed: failedId === id,
    unit: "counts",
  });

  const hallValid = isUsableRaw(sample?.hallRaw, sample?.hallRawValid);
  const currentHallRaw = hallValid ? sample!.hallRaw! : null;
  const baselineCompleted = effectiveProgress >= COMPLETION_PROGRESS.baseline;
  const baselineFailed = failedId === "baseline";
  const currentDelta = currentHallRaw !== null && hallBaselineRaw !== null
    ? Math.abs(currentHallRaw - hallBaselineRaw)
    : null;
  const achievedDelta = failedId === "full" && maxHallDelta !== null ? maxHallDelta : currentDelta;
  const targetDelta = config?.hall_delta ?? null;
  const validatedDepth = sample?.hallMmValid === true && typeof sample.hallMm === "number" && Number.isFinite(sample.hallMm)
    ? sample.hallMm
    : null;
  const estimatedDepth = validatedDepth === null
    ? estimateCalibrationDepthMm(achievedDelta, targetDelta, fullDepthMm)
    : null;

  const baseline: CalibrationTargetDisplay = {
    id: "baseline",
    label: "Hall Baseline",
    targetValue: null,
    targetLabel: "Captured during calibration",
    currentValue: currentHallRaw,
    unit: "counts",
    difference: null,
    progressPercent: null,
    status: baselineFailed ? "FAILED" : baselineCompleted ? "COMPLETED" : activeId === "baseline" ? (hallValid ? "ACTIVE" : "INVALID") : "PENDING",
    guidance: baselineFailed
      ? "Keep the manikin fully released and retry"
      : baselineCompleted
        ? "Baseline captured"
        : activeId === "baseline"
          ? "Do not press while baseline is being captured"
          : "Keep the manikin fully released",
    active: activeId === "baseline",
    rawValid: hallValid,
    reached: baselineCompleted,
  };

  const full = compareTarget({
    id: "full",
    label: "Full Compression",
    target: targetDelta,
    current: achievedDelta,
    valid: achievedDelta !== null,
    active: activeId === "full",
    completed: effectiveProgress >= COMPLETION_PROGRESS.full,
    failed: failedId === "full",
    unit: "counts delta",
  });
  full.currentHallRaw = currentHallRaw;
  full.capturedHallBaseline = hallBaselineRaw;
  full.currentHallDelta = currentDelta;
  full.maximumHallDelta = maxHallDelta;
  full.targetHallDelta = targetDelta;
  full.currentDepthMm = validatedDepth ?? estimatedDepth;
  full.targetDepthMm = fullDepthMm;
  full.depthEstimated = validatedDepth === null && estimatedDepth !== null;
  if (failedId === "full" && reasonId === "08405") {
    full.guidance = "Full compression target was not reached.";
  } else if (full.active) {
    full.guidance = full.status === "REACHED"
      ? "Full-depth target reached — hold steady"
      : full.status === "NEAR_TARGET"
        ? "Almost at full depth"
        : "Press deeper";
  }

  return [
    pressure("reference", "Reference Pressure", config?.ref_pressure ?? null, sample?.pressure0Raw ?? null, sample?.pressure0RawValid ?? false),
    pressure("bladder1", "Bladder 1 Pressure", config?.bladder_1_pressure ?? null, sample?.pressure1Raw ?? null, sample?.pressure1RawValid ?? false),
    pressure("bladder2", "Bladder 2 Pressure", config?.bladder_2_pressure ?? null, sample?.pressure2Raw ?? null, sample?.pressure2RawValid ?? false),
    baseline,
    full,
  ];
}

function compareTarget(input: {
  id: CalibrationTargetDisplay["id"];
  label: string;
  target: number | null;
  current: number | null;
  valid: boolean;
  active: boolean;
  completed: boolean;
  failed: boolean;
  unit: string;
}): CalibrationTargetDisplay {
  const { id, label, target, current, valid, active, completed, failed, unit } = input;
  const difference = valid && target !== null && current !== null ? current - target : null;
  const progressPercent = valid && target !== null && target !== 0 && current !== null
    ? Math.abs(current) / Math.abs(target) * 100
    : null;
  const tolerance = target === null ? 0 : Math.max(Math.abs(target) * 0.02, 1);
  const nearTolerance = target === null ? 0 : Math.max(Math.abs(target) * 0.05, tolerance);

  let status: CalibrationTargetStatus = "PENDING";
  if (failed) status = "FAILED";
  else if (completed) status = "COMPLETED";
  else if (active && !valid) status = "INVALID";
  else if (active && target === null) status = "ACTIVE";
  else if (active && difference !== null) {
    if (Math.abs(difference) <= tolerance) status = "REACHED";
    else if (Math.abs(difference) <= nearTolerance) status = "NEAR_TARGET";
    else if (difference < 0) status = "BELOW_TARGET";
    else status = "ABOVE_TARGET";
  }

  return {
    id,
    label,
    targetValue: target,
    currentValue: valid ? current : null,
    unit,
    difference,
    progressPercent,
    status,
    guidance: guidanceFor(id, status),
    active,
    rawValid: valid,
    reached: completed || status === "REACHED",
  };
}

function guidanceFor(id: CalibrationTargetDisplay["id"], status: CalibrationTargetStatus): string {
  if (status === "INVALID") return "Reading unavailable";
  if (status === "FAILED") return "Target was not reached — check the setup and retry";
  if (status === "COMPLETED") return "Stage completed by firmware";
  if (status === "REACHED") return "Target reached — hold steady";
  if (status === "ABOVE_TARGET") return "Reduce pressure slightly";
  if (status === "PENDING") return "Waiting for this calibration stage";
  if (id === "reference") return status === "NEAR_TARGET" ? "Reference pressure is close" : "Increase reference pressure";
  if (id === "bladder1") return status === "NEAR_TARGET" ? "Bladder 1 target nearly reached" : "Increase Bladder 1 pressure";
  if (id === "bladder2") return status === "NEAR_TARGET" ? "Bladder 2 target nearly reached" : "Increase Bladder 2 pressure";
  return status === "NEAR_TARGET" ? "Almost at full depth" : "Press deeper";
}
