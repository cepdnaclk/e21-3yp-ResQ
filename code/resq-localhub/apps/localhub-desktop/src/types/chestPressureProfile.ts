export type ChestPressureProfile = {
  profileId: string;
  displayName: string;

  referenceTargetRaw: number;

  leftBladderTargetAboveReferenceRaw: number;
  rightBladderTargetAboveReferenceRaw: number;

  pressureToleranceRaw: number;
  maxBalanceDifferenceRaw: number;

  hallDeltaRaw?: number;
  pressureBalanceAllowedPct?: number;
};
