import type { SessionLiveView } from "../types/live";

export const DEFAULT_TARGET_DEPTH_MM = 50;

export interface NormalizedTelemetry {
  instantaneousDepthMm: number | null;
  depthMm: number | null;
  depthPercent: number | null;
  rateCpm: number | null;
  recoilPct: number | null;
  pauseS: number | null;
  flags: string | string[] | null;
  isDerivedDepth: boolean;
  handPlacement: string | null;
  hasRecoilCounts: boolean;
  recoilTotal: number;
  pressureBalanceScorePct: number | null;
  completedCompressionCount: number;
  lastCompressionPeakDepthMm: number | null;
  usesCompletedCompressionDepth: boolean;
}

export function normalizeTelemetry(session: SessionLiveView | null): NormalizedTelemetry {
  if (!session) {
    return {
      instantaneousDepthMm: null,
      depthMm: null,
      depthPercent: null,
      rateCpm: null,
      recoilPct: null,
      pauseS: null,
      flags: null,
      isDerivedDepth: false,
      handPlacement: null,
      hasRecoilCounts: false,
      recoilTotal: 0,
      pressureBalanceScorePct: null,
      completedCompressionCount: 0,
      lastCompressionPeakDepthMm: null,
      usesCompletedCompressionDepth: false,
    };
  }

  const latestMetric = session.latestMetric as any;

  // 1. depthMm derivation
  let instantaneousDepthMm: number | null = session.latestDepthMm ?? null;
  let isDerivedDepth = false;

  if (instantaneousDepthMm === null && latestMetric) {
    const rawDepthMm = latestMetric.depthMm ?? latestMetric.depth_mm;
    if (rawDepthMm !== null && rawDepthMm !== undefined) {
      instantaneousDepthMm = rawDepthMm;
    } else {
      const depthProgress = latestMetric.depthProgress ?? latestMetric.depth_progress;
      if (depthProgress !== null && depthProgress !== undefined) {
        instantaneousDepthMm = depthProgress * DEFAULT_TARGET_DEPTH_MM;
        isDerivedDepth = true;
      }
    }
  }

  const completedCompressionCount =
    latestMetric?.completedCompressionCount ??
    latestMetric?.completed_compression_count ??
    0;
  const lastCompressionPeakDepthMm =
    latestMetric?.lastCompressionPeakDepthMm ??
    latestMetric?.last_compression_peak_depth_mm ??
    latestMetric?.lastCompressionDepthMm ??
    latestMetric?.last_compression_depth_mm ??
    null;
  const averageCompletedCompressionPeakDepthMm =
    latestMetric?.averageCompletedCompressionPeakDepthMm ??
    latestMetric?.average_completed_compression_peak_depth_mm ??
    latestMetric?.averageCompressionDepthMm ??
    latestMetric?.average_compression_depth_mm ??
    null;
  const usesCompletedCompressionDepth =
    completedCompressionCount > 0 &&
    averageCompletedCompressionPeakDepthMm !== null;
  /*
   * New firmware cards use the stable average of one peak per completed
   * compression. Legacy payloads do not have completion counters, so retain
   * their instantaneous depth rather than leaving the card blank.
   */
  const depthMm = usesCompletedCompressionDepth
    ? averageCompletedCompressionPeakDepthMm
    : instantaneousDepthMm;

  // 2. depthPercent
  let depthPercent: number | null = null;
  if (latestMetric) {
    const depthProgress = latestMetric.depthProgress ?? latestMetric.depth_progress;
    if (depthProgress !== null && depthProgress !== undefined) {
      depthPercent = depthProgress * 100;
    }
  }

  // 3. rateCpm
  const rateCpm = session.latestRateCpm ?? latestMetric?.rateCpm ?? latestMetric?.rate_cpm ?? null;

  // 4. recoilPct
  let recoilPct: number | null = null;
  let recoilTotal = 0;
  let hasRecoilCounts = false;

  if (latestMetric) {
    const hasOkCount = (latestMetric.recoilOkCount !== null && latestMetric.recoilOkCount !== undefined) ||
                       (latestMetric.recoil_ok_count !== null && latestMetric.recoil_ok_count !== undefined);
    const hasIncompleteCount = (latestMetric.incompleteRecoilCount !== null && latestMetric.incompleteRecoilCount !== undefined) ||
                               (latestMetric.incomplete_recoil_count !== null && latestMetric.incomplete_recoil_count !== undefined);

    if (hasOkCount || hasIncompleteCount) {
      hasRecoilCounts = true;
      const recoilOkCount = latestMetric.recoilOkCount ?? latestMetric.recoil_ok_count ?? 0;
      const incompleteRecoilCount = latestMetric.incompleteRecoilCount ?? latestMetric.incomplete_recoil_count ?? 0;
      recoilTotal = recoilOkCount + incompleteRecoilCount;
      if (recoilTotal > 0) {
        recoilPct = (recoilOkCount / recoilTotal) * 100;
      }
    } else {
      const recoilOk = latestMetric.recoilOk ?? latestMetric.recoil_ok ?? session.latestRecoilOk ?? null;
      if (recoilOk === true) {
        recoilPct = 100;
      } else if (recoilOk === false) {
        recoilPct = 0;
      }
    }
  } else {
    const recoilOk = session.latestRecoilOk ?? null;
    if (recoilOk === true) {
      recoilPct = 100;
    } else if (recoilOk === false) {
      recoilPct = 0;
    }
  }

  // 5. pauseS
  const pauseS = session.latestPauseS ?? latestMetric?.pauseS ?? latestMetric?.pause_s ?? null;

  // 6. flags
  const flags = session.latestFlags ?? latestMetric?.flags ?? latestMetric?.quality_flags ?? null;

  // 7. handPlacement
  const handPlacement = latestMetric?.handPlacement ?? latestMetric?.hand_placement ?? null;

  // 8. pressureBalanceScorePct
  const pressureBalanceScorePct =
    latestMetric?.pressureBalanceScorePct ??
    latestMetric?.pressure_balance_score_pct ??
    latestMetric?.pressureBalancePct ??
    latestMetric?.pressure_balance_pct ??
    session.pressureBalanceScorePct ??
    null;

  return {
    instantaneousDepthMm,
    depthMm,
    depthPercent,
    rateCpm,
    recoilPct,
    pauseS,
    flags,
    isDerivedDepth,
    handPlacement,
    hasRecoilCounts,
    recoilTotal,
    pressureBalanceScorePct,
    completedCompressionCount,
    lastCompressionPeakDepthMm,
    usesCompletedCompressionDepth,
  };
}
