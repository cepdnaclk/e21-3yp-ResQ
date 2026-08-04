# ResQ CPR scoring method

ResQ LocalHub is the only authority for the overall CPR score. Firmware supplies calibrated measurements and separate live/scored signals; the frontend displays the result it receives. The authoritative defaults are in `code/resq-localhub/services/hub-api/src/main/java/lk/resq/localhub/service/CprScoringConfig.java`. The current scoring version is `moderate-v1`.

## Metrics, targets, and weights

| Component | Raw session metric | Ideal target | Failure limits | Weight |
|---|---|---:|---:|---:|
| Depth | Mean completed-compression peak | 50–60 mm | 35–75 mm | 30% |
| Rate | Mean completed interval rate | 100–120 cpm | 70–150 cpm | 25% |
| Recoil | Completed compressions with complete recoil | ≥90% | ≤40% | 20% |
| Hand placement | Completed compressions classified `CENTER` from calibrated pressure distribution | ≥90% | ≤40% | 15% |
| Compression fraction | Session time not attributed to between-compression pauses | ≥80% | ≤40% | 10% |

Depth produces useful blood flow, rate maintains perfusion, recoil permits refilling, centered hand pressure reduces ineffective or unsafe force, and compression fraction rewards limited interruptions.

## Formulas

For depth and rate, `band_score(value, ideal_low, ideal_high, fail_low, fail_high)` is 100 inside the ideal band, 0 outside the failure limits, and linearly interpolated between each failure limit and the nearest ideal boundary.

For recoil and hand placement, a quality percentage at or below 40% scores 0; 40–60% maps linearly to 0–60; 60–90% maps linearly to 60–100; and 90% or more scores 100.

Compression fraction at or below 40% scores 0; 40–60% maps to 0–50; 60–80% maps to 50–100; and 80% or more scores 100.

The uncapped total is:

```text
0.30 × depth + 0.25 × rate + 0.20 × recoil
+ 0.15 × hand placement + 0.10 × compression fraction
```

All components and the rounded overall result are clamped to 0–100. Required evidence is never silently reweighted.

## Caps, evidence, and grades

- Depth score below 40 caps the overall result at 69.
- Rate score below 40 caps the overall result at 69.
- Raw compression fraction below 40% caps it at 59.
- Every applied cap reason is returned.
- Fewer than 10 completed valid compressions makes the result provisional.
- Missing depth, rate, recoil, calibrated placement, or compression-fraction evidence makes the score unavailable, not zero.

Grades are: 90–100 Excellent, 75–89 Good, 60–74 Developing, and 0–59 Needs improvement.

For example, component scores 85, 90, 75, 80, and 70 yield `25.5 + 22.5 + 15 + 12 + 7 = 82`, graded Good unless a visible critical cap applies.

## Live versus scoring filters

Dashboard depth and recoil use the newest fresh valid sample:

```text
display = 0.85 × newest + 0.15 × previous_display
```

The first valid sample initializes directly. Invalid, duplicate, and stale samples preserve the previous display value. Scoring signals retain an independent five-value arithmetic mean followed by EMA alpha 0.60. There is no frontend smoothing and no second scoring filter in LocalHub.

## Fine tuning

To make scoring easier, widen ideal ranges, move failure limits farther away, reduce the quality ideal threshold, relax critical caps, or reduce the minimum compression count. To make it stricter, do the opposite or add an explicit critical cap.

To emphasize a metric, increase its weight and decrease other weights so the total remains exactly 1.0. Configuration validation rejects invalid totals, unordered/non-finite thresholds, overlapping grade bands, and missing versions.

For faster live response, increase `CPR_DISPLAY_METRIC_EMA_ALPHA` toward 1.0 in `cpr_metrics.h`. For smoother scoring, decrease `CPR_LIVE_METRIC_EMA_ALPHA` or increase `CPR_LIVE_METRIC_WINDOW_SIZE`. Higher alpha is faster but noisier; lower alpha is smoother but delayed. A larger window adds stability and delay; a smaller window responds faster with less stability.
