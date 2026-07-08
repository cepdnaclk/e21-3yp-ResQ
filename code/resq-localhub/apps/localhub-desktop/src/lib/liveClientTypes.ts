import type { LiveConnectionState, LiveMetricPayload, LiveMetricSourceMode } from "@resq/shared";
import { normalizeFirmwareLivePayload } from "./firmwareLiveNormalizer";

export type LiveClientUpdate = {
  deviceId: string;
  sessionId?: string | null;
  latestMetric?: LiveMetricPayload | null;
  lastSeenAt?: string | number | null;
  heartbeatSeen?: boolean;
  statusSeen?: boolean;
  eventType?: string | null;
  connectionState?: LiveConnectionState | null;
  stale?: boolean | null;
  offline?: boolean | null;
  firmwareState?: string | null;
  calibrated?: boolean | null;
  sessionActive?: boolean | null;
  lastErrorId?: string | null;
  reasonId?: string | null;
  actionId?: number | null;
  progressId?: number | null;
  eventId?: number | null;
  debugRaw?: unknown;
};

export function isLiveUpdateForSelection(
  update: Pick<LiveClientUpdate, "deviceId" | "sessionId">,
  deviceId: string,
  sessionId?: string | null,
): boolean {
  if (update.deviceId !== deviceId) {
    return false;
  }

  if (sessionId) {
    return update.sessionId === sessionId;
  }

  return true;
}

export function toLiveClientUpdate(raw: unknown): LiveClientUpdate | null {
  if (!isRecord(raw)) {
    return null;
  }

  const firmware = normalizeFirmwareLivePayload(raw);
  const latestMetric = isRecord(raw.latestMetric) ? toLiveMetric(raw.latestMetric) : null;
  const latestFromFirmware = latestMetric ?? toLiveMetric(raw);
  const deviceId = text(raw.deviceId) ?? firmware?.deviceId ?? latestFromFirmware?.deviceId;
  if (!deviceId) {
    return null;
  }

  const sessionId = text(raw.sessionId) ?? firmware?.sessionId ?? latestFromFirmware?.sessionId ?? null;

  return {
    deviceId,
    sessionId,
    latestMetric: latestMetric ?? latestFromFirmware,
    lastSeenAt:
      timestampOrNull(raw.lastSeenAt) ??
      timestampOrNull(raw.lastSeen) ??
      timestampOrNull(raw.timestamp) ??
      latestFromFirmware?.timestamp ??
      latestFromFirmware?.tsMs ??
      null,
    heartbeatSeen: false,
    statusSeen: false,
    eventType: text(raw.lastEventType) ?? text(raw.eventType) ?? text(raw.type) ?? numberOrNullText(firmware?.eventId),
    connectionState: liveConnectionState(raw.connectionState),
    stale: booleanOrNull(raw.stale),
    offline: booleanOrNull(raw.offline),
    firmwareState: text(raw.firmwareState) ?? text(raw.firmware_state) ?? firmware?.firmwareState ?? null,
    calibrated: booleanOrNull(raw.calibrated) ?? firmware?.calibrated ?? null,
    sessionActive: booleanOrNull(raw.sessionActive) ?? booleanOrNull(raw.session_active) ?? firmware?.sessionActive ?? null,
    lastErrorId: text(raw.lastErrorId) ?? text(raw.last_error_id) ?? firmware?.lastErrorId ?? null,
    reasonId: text(raw.reasonId) ?? text(raw.calibrationReasonId) ?? text(raw.reason_id) ?? firmware?.reasonId ?? null,
    actionId: numberOrNull(raw.actionId) ?? numberOrNull(raw.calibrationActionId) ?? numberOrNull(raw.action_id) ?? firmware?.actionId ?? null,
    progressId: numberOrNull(raw.progressId) ?? numberOrNull(raw.calibrationProgressId) ?? numberOrNull(raw.progress_id) ?? firmware?.progressId ?? null,
    eventId: numberOrNull(raw.eventId) ?? numberOrNull(raw.event_id) ?? firmware?.eventId ?? null,
    debugRaw: raw.debugRaw ?? raw.debug_raw ?? firmware?.debugRaw,
  };
}

export function toLiveMetric(raw: unknown): LiveMetricPayload | null {
  const normalized = normalizeTelemetryPayload(raw);
  return normalized.ok ? normalized.value : null;
}

export type TelemetryNormalizationResult =
  | { ok: true; value: LiveMetricPayload; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

export function normalizeTelemetryPayload(raw: unknown): TelemetryNormalizationResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, reason: "payload must be an object", warnings };
  }

  const firmware = normalizeFirmwareLivePayload(raw);

  const deviceId = text(raw.deviceId) ?? text(raw.device_id) ?? firmware?.deviceId;
  const sessionId = text(raw.sessionId) ?? text(raw.session_id) ?? firmware?.sessionId;
  if (!deviceId || !sessionId) {
    return { ok: false, reason: "payload deviceId/sessionId is missing", warnings };
  }

  let depthMm = numberOrNull(raw.depthMm ?? raw.depth_mm);
  const depthProgress = numberOrNull(raw.depthProgress ?? raw.depth_progress ?? firmware?.depthProgress);
  let sourceMode = sourceModeOrNull(raw.sourceMode ?? raw.source_mode ?? raw.depthSource ?? raw.depth_source);
  if (depthMm === null) {
    depthMm = numberOrNull(raw.current_delta ?? raw.currentDelta);
    if (depthMm !== null) {
      warnings.push("used raw current_delta/currentDelta as fallback depthMm");
      if (!sourceMode || sourceMode === "real") {
        sourceMode = "simulator";
      }
    }
  }

  const rateCpm = numberOrNull(raw.rateCpm ?? raw.rate_cpm ?? firmware?.rateCpm);
  const recoilOk = booleanOrNull(raw.recoilOk ?? raw.recoil_ok ?? raw.recoil);
  const feedback = text(raw.feedback);
  let flags = flagsOrNull(raw.flags ?? firmware?.flags);
  if (!flags && feedback) {
    const mapped = mapFeedbackToFlag(feedback);
    if (mapped) {
      flags = mapped;
      warnings.push("mapped legacy feedback to flags");
    } else {
      warnings.push("ignored unknown legacy feedback value");
    }
  }

  if (depthMm === null && rateCpm === null && recoilOk === null) {
    return { ok: false, reason: "payload is missing required metric-first fields", warnings };
  }

  return {
    ok: true,
    value: {
      deviceId,
      manikinId: text(raw.manikinId) ?? text(raw.manikin_id),
      sessionId,
      seq: numberOrNull(raw.seq),
      tsMs: numberOrNull(raw.tsMs ?? raw.ts_ms ?? firmware?.tsMs),
      timestamp: timestampOrNull(raw.timestamp),
      depthMm,
      depthProgress,
      depthOk: booleanOrNull(raw.depthOk ?? raw.depth_ok ?? firmware?.depthOk),
      rateCpm,
      recoilOk,
      pauseS: numberOrNull(raw.pauseS ?? raw.pause_s ?? firmware?.pauseS),
      compressionCount: numberOrNull(
        raw.compressionCount ?? raw.compression_count ?? raw.total_compressions ?? firmware?.compressionCount,
      ),
      handPlacement: text(raw.handPlacement) ?? text(raw.hand_placement) ?? firmware?.handPlacement ?? null,
      flags,
      sourceMode: sourceMode ?? undefined,
      sessionActive: booleanOrNull(raw.sessionActive ?? raw.session_active ?? firmware?.sessionActive) ?? null,
      firmwareState: text(raw.firmwareState) ?? text(raw.firmware_state) ?? firmware?.firmwareState ?? null,
      calibrated: booleanOrNull(raw.calibrated) ?? firmware?.calibrated ?? null,
      lastErrorId: text(raw.lastErrorId) ?? text(raw.last_error_id) ?? firmware?.lastErrorId ?? null,
      eventId: numberOrNull(raw.eventId ?? raw.event_id ?? firmware?.eventId),
      reasonId: text(raw.reasonId) ?? text(raw.calibrationReasonId) ?? text(raw.reason_id) ?? firmware?.reasonId ?? null,
      actionId: numberOrNull(raw.actionId ?? raw.calibrationActionId ?? raw.action_id ?? firmware?.actionId),
      progressId: numberOrNull(raw.progressId ?? raw.calibrationProgressId ?? raw.progress_id ?? firmware?.progressId),
      validCompressionCount: numberOrNull(raw.validCompressionCount ?? raw.valid_compression_count ?? firmware?.validCompressionCount),
      recoilOkCount: numberOrNull(raw.recoilOkCount ?? raw.recoil_ok_count ?? firmware?.recoilOkCount),
      incompleteRecoilCount: numberOrNull(raw.incompleteRecoilCount ?? raw.incomplete_recoil_count ?? firmware?.incompleteRecoilCount),
      pressureBalancePct: numberOrNull(raw.pressureBalancePct ?? raw.pressure_balance_pct ?? firmware?.pressureBalancePct),
      rawPayload: raw,
      debugRaw: raw.debugRaw ?? raw.debug_raw ?? firmware?.debugRaw,
    },
    warnings,
  };
}

function liveConnectionState(value: unknown): LiveConnectionState | null {
  if (
    value === "CONNECTING" ||
    value === "MQTT_WS_LIVE" ||
    value === "BACKEND_SSE_FALLBACK" ||
    value === "BACKEND_POLLING_DEGRADED" ||
    value === "STALE" ||
    value === "OFFLINE" ||
    value === "ERROR"
  ) {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberOrNullText(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function timestampOrNull(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
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

function sourceModeOrNull(value: unknown): LiveMetricSourceMode | null {
  if (value === "real" || value === "simulator" || value === "calibration" || value === "debug" || value === "hall") {
    return value;
  }
  if (typeof value === "string" && value.trim().toUpperCase() === "HALL") {
    return "hall";
  }
  if (typeof value === "string" && value.trim()) {
    return "debug";
  }
  return null;
}

function mapFeedbackToFlag(value: string): string | null {
  switch (value.trim().toUpperCase()) {
    case "PERFECT":
    case "OK":
    case "GOOD":
    case "NONE":
      return "DEPTH_OK,RATE_OK,RECOIL_OK";
    case "TOO_SHALLOW":
    case "SHALLOW":
    case "DEPTH_LOW":
      return "DEPTH_LOW";
    case "TOO_DEEP":
    case "DEEP":
    case "DEPTH_HIGH":
      return "DEPTH_HIGH";
    case "TOO_SLOW":
    case "SLOW":
    case "RATE_SLOW":
      return "RATE_SLOW";
    case "TOO_FAST":
    case "FAST":
    case "RATE_FAST":
      return "RATE_FAST";
    case "BAD_RECOIL":
    case "RECOIL_INCOMPLETE":
      return "RECOIL_INCOMPLETE";
    case "PAUSE":
    case "PAUSE_DETECTED":
      return "PAUSE_DETECTED";
    case "HAND_PLACEMENT_WARNING":
    case "BAD_HAND_PLACEMENT":
      return "HAND_PLACEMENT_WARNING";
    default:
      return null;
  }
}
