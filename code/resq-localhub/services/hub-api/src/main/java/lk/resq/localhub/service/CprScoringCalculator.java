package lk.resq.localhub.service;

import java.util.ArrayList;
import java.util.List;

final class CprScoringCalculator {
    static final CprScoringConfig CONFIG = CprScoringConfig.moderateV1();

    private CprScoringCalculator() {}

    static Result score(Input input) {
        if (input == null || !finite(input.averageDepthMm(), input.averageRateCpm(),
                input.recoilPercent(), input.handPlacementPercent(), input.compressionFractionPercent())) {
            return Result.unavailable(CONFIG.version(), input == null ? 0 : input.validCompressionCount());
        }

        double depth = bandScore(input.averageDepthMm(), CONFIG.depth());
        double rate = bandScore(input.averageRateCpm(), CONFIG.rate());
        double recoil = qualityPercentScore(input.recoilPercent(), CONFIG.recoil());
        double placement = qualityPercentScore(input.handPlacementPercent(), CONFIG.handPlacement());
        double fraction = compressionFractionScore(input.compressionFractionPercent(), CONFIG.compressionFraction());
        CprScoringConfig.Weights weights = CONFIG.weights();
        int overall = clampScore((int) Math.round(
                weights.depth() * depth + weights.rate() * rate + weights.recoil() * recoil +
                weights.handPlacement() * placement + weights.compressionFraction() * fraction));

        List<String> reasons = new ArrayList<>();
        Integer cap = null;
        if (depth < CONFIG.caps().depthCriticalBelow()) {
            cap = lower(cap, CONFIG.caps().depthMaximum());
            reasons.add("depth score below " + format(CONFIG.caps().depthCriticalBelow()));
        }
        if (rate < CONFIG.caps().rateCriticalBelow()) {
            cap = lower(cap, CONFIG.caps().rateMaximum());
            reasons.add("rate score below " + format(CONFIG.caps().rateCriticalBelow()));
        }
        if (input.compressionFractionPercent() < CONFIG.caps().compressionFractionCriticalBelow()) {
            cap = lower(cap, CONFIG.caps().compressionFractionMaximum());
            reasons.add("compression fraction below " + format(CONFIG.caps().compressionFractionCriticalBelow()) + "%");
        }
        if (cap != null) overall = Math.min(overall, cap);
        final int gradedOverall = overall;
        String grade = CONFIG.grades().stream()
                .filter(candidate -> gradedOverall >= candidate.minimum() && gradedOverall <= candidate.maximum())
                .findFirst().orElseThrow().label();
        boolean provisional = input.validCompressionCount() < CONFIG.minimumValidCompressions();
        return new Result(CONFIG.version(), overall, grade, round(depth), round(rate), round(recoil),
                round(placement), round(fraction), cap,
                reasons.isEmpty() ? null : String.join("; ", reasons), provisional,
                input.validCompressionCount(), recommendation(depth, rate, recoil, placement, fraction));
    }

    static double bandScore(double value, CprScoringConfig.Band band) {
        if (!Double.isFinite(value)) return Double.NaN;
        if (value >= band.idealLow() && value <= band.idealHigh()) return 100.0;
        if (value <= band.failLow() || value >= band.failHigh()) return 0.0;
        if (value < band.idealLow())
            return clamp(100.0 * (value - band.failLow()) / (band.idealLow() - band.failLow()));
        return clamp(100.0 * (band.failHigh() - value) / (band.failHigh() - band.idealHigh()));
    }

    static double qualityPercentScore(double percentage, CprScoringConfig.QualityPercent thresholds) {
        if (!Double.isFinite(percentage)) return Double.NaN;
        if (percentage <= thresholds.fail()) return 0.0;
        if (percentage >= thresholds.ideal()) return 100.0;
        if (percentage < thresholds.acceptable())
            return clamp(60.0 * (percentage - thresholds.fail()) /
                    (thresholds.acceptable() - thresholds.fail()));
        return clamp(60.0 + 40.0 * (percentage - thresholds.acceptable()) /
                (thresholds.ideal() - thresholds.acceptable()));
    }

    static double compressionFractionScore(double percentage, CprScoringConfig.CompressionFraction thresholds) {
        if (!Double.isFinite(percentage)) return Double.NaN;
        if (percentage <= thresholds.fail()) return 0.0;
        if (percentage >= thresholds.ideal()) return 100.0;
        if (percentage < thresholds.acceptable())
            return clamp(50.0 * (percentage - thresholds.fail()) /
                    (thresholds.acceptable() - thresholds.fail()));
        return clamp(50.0 + 50.0 * (percentage - thresholds.acceptable()) /
                (thresholds.ideal() - thresholds.acceptable()));
    }

    private static String recommendation(double depth, double rate, double recoil,
                                         double placement, double fraction) {
        double minimum = Math.min(depth, Math.min(rate, Math.min(recoil, Math.min(placement, fraction))));
        if (minimum == depth) return "Improve compression depth toward the 50–60 mm target.";
        if (minimum == rate) return "Adjust rhythm toward 100–120 compressions per minute.";
        if (minimum == recoil) return "Allow complete chest recoil after each compression.";
        if (minimum == placement) return "Center hand pressure using the calibrated balance feedback.";
        return "Reduce pauses to improve the chest-compression fraction.";
    }
    private static Integer lower(Integer current, int candidate) { return current == null ? candidate : Math.min(current, candidate); }
    private static boolean finite(double... values) { for (double value : values) if (!Double.isFinite(value)) return false; return true; }
    private static double clamp(double value) { return Math.max(0.0, Math.min(100.0, value)); }
    private static int clampScore(int value) { return Math.max(0, Math.min(100, value)); }
    private static double round(double value) { return Math.round(value * 10.0) / 10.0; }
    private static String format(double value) { return String.format(java.util.Locale.ROOT, "%.0f", value); }

    record Input(double averageDepthMm, double averageRateCpm, double recoilPercent,
                 double handPlacementPercent, double compressionFractionPercent,
                 int validCompressionCount) {}
    record Result(String version, Integer overallScore, String grade, Double depthScore,
                  Double rateScore, Double recoilScore, Double handPlacementScore,
                  Double compressionFractionScore, Integer scoreCap, String scoreCapReason,
                  boolean provisional, int validCompressionCount, String recommendation) {
        static Result unavailable(String version, int validCount) {
            return new Result(version, null, "Unavailable", null, null, null, null, null,
                    null, "required scoring evidence is unavailable", true, validCount,
                    "Collect valid depth, rate, recoil, hand-placement, and pause evidence.");
        }
    }
}
