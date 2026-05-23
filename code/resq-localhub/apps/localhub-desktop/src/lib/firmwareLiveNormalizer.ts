import type { ActionId, EventId, FirmwareState, ProgressId, ReasonId } from "@resq/shared";

export type FirmwareLiveFields = {
  deviceId: string | null;
  sessionId: string | null;
  firmwareState: FirmwareState | string | null;
  calibrated: boolean | null;
  sessionActive: boolean | null;
  lastErrorId: ReasonId | string | null;
  reasonId: ReasonId | string | null;
  actionId: ActionId | number | null;
  progressId: ProgressId | number | null;
  eventId: EventId | number | null;
  depthProgress: number | null;
  depthOk: boolean | null;
  rateCpm: number | null;
  compressionCount: number | null;
  validCompressionCount: number | null;
  recoilOkCount: number | null;
  incompleteRecoilCount: number | null;
  pauseS: number | null;
  handPlacement: string | null;
  pressureBalancePct: number | null;
  flags: string | string[] | null;
  tsMs: number | null;
  timestamp: string | number | null;
  debugRaw: unknown;
  rawPayload: Record<string, unknown>;
};

export function normalizeFirmwareLivePayload(raw: unknown): FirmwareLiveFields | null {
  if (!isRecord(raw)) {
    return null;
  }

  const rawPayload = raw as Record<string, unknown>;
  const firmwareState = text(rawPayload.firmwareState) ?? text(rawPayload.firmware_state) ?? text(rawPayload.state);
  const deviceId = text(rawPayload.deviceId) ?? text(rawPayload.device_id);
  const sessionId = text(rawPayload.sessionId) ?? text(rawPayload.session_id);
  const calibrated = booleanOrNull(rawPayload.calibrated);
  const sessionActive = booleanOrNull(rawPayload.sessionActive ?? rawPayload.session_active);
  const lastErrorId = text(rawPayload.lastErrorId) ?? text(rawPayload.last_error_id);
  const reasonId = text(rawPayload.reasonId) ?? text(rawPayload.reason_id);
  const actionId = intOrNull(rawPayload.actionId ?? rawPayload.action_id);
  const progressId = intOrNull(rawPayload.progressId ?? rawPayload.progress_id);
  const eventId = intOrNull(rawPayload.eventId ?? rawPayload.event_id);
  const depthProgress = numberOrNull(rawPayload.depthProgress ?? rawPayload.depth_progress);
  const depthOk = booleanOrNull(rawPayload.depthOk ?? rawPayload.depth_ok);
  const rateCpm = numberOrNull(rawPayload.rateCpm ?? rawPayload.rate_cpm);
  const compressionCount = intOrNull(rawPayload.compressionCount ?? rawPayload.compression_count ?? rawPayload.total_compressions);
  const validCompressionCount = intOrNull(rawPayload.validCompressionCount ?? rawPayload.valid_compression_count);
  const recoilOkCount = intOrNull(rawPayload.recoilOkCount ?? rawPayload.recoil_ok_count);
  const incompleteRecoilCount = intOrNull(rawPayload.incompleteRecoilCount ?? rawPayload.incomplete_recoil_count);
  const pauseS = numberOrNull(rawPayload.pauseS ?? rawPayload.pause_s);
  const handPlacement = text(rawPayload.handPlacement) ?? text(rawPayload.hand_placement);
  const pressureBalancePct = numberOrNull(rawPayload.pressureBalancePct ?? rawPayload.pressure_balance_pct);
  const flags = flagsOrNull(rawPayload.flags);
  const tsMs = intOrNull(rawPayload.tsMs ?? rawPayload.ts_ms);
  const timestamp = timestampOrNull(rawPayload.timestamp);
  const debugRaw = rawPayload.debugRaw ?? rawPayload.debug_raw ?? rawPayload;

  return {
    deviceId,
    sessionId,
    firmwareState,
    calibrated,
    sessionActive,
    lastErrorId,
    reasonId,
    actionId,
    progressId,
    eventId,
    depthProgress,
    depthOk,
    rateCpm,
    compressionCount,
    validCompressionCount,
    recoilOkCount,
    incompleteRecoilCount,
    pauseS,
    handPlacement,
    pressureBalancePct,
    flags,
    tsMs,
    timestamp,
    debugRaw,
    rawPayload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function timestampOrNull(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function flagsOrNull(value: unknown): string | string[] | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return null;
}
