package lk.resq.localhub.service;

import java.util.List;

/** The single authoritative CPR scoring configuration. */
public record CprScoringConfig(
        String version,
        Weights weights,
        Band depth,
        Band rate,
        QualityPercent recoil,
        QualityPercent handPlacement,
        CompressionFraction compressionFraction,
        int minimumValidCompressions,
        Caps caps,
        List<GradeBand> grades
) {
    private static final double EPSILON = 1.0e-9;

    public static CprScoringConfig moderateV1() {
        return new CprScoringConfig(
                "moderate-v1",
                new Weights(0.30, 0.25, 0.20, 0.15, 0.10),
                new Band(50.0, 60.0, 35.0, 75.0),
                new Band(100.0, 120.0, 70.0, 150.0),
                new QualityPercent(40.0, 60.0, 90.0),
                new QualityPercent(40.0, 60.0, 90.0),
                new CompressionFraction(40.0, 60.0, 80.0),
                10,
                new Caps(40.0, 69, 40.0, 69, 40.0, 59),
                List.of(
                        new GradeBand(90, 100, "Excellent"),
                        new GradeBand(75, 89, "Good"),
                        new GradeBand(60, 74, "Developing"),
                        new GradeBand(0, 59, "Needs improvement")
                )
        ).validated();
    }

    public CprScoringConfig validated() {
        require(version != null && !version.isBlank(), "scoring version is required");
        require(weights != null && finite(weights.total()) &&
                Math.abs(weights.total() - 1.0) <= EPSILON,
                "component weights must sum to exactly 1.0");
        validateBand(depth, "depth");
        validateBand(rate, "rate");
        validateQuality(recoil, "recoil");
        validateQuality(handPlacement, "hand placement");
        require(compressionFraction != null &&
                ordered(compressionFraction.fail(), compressionFraction.acceptable(), compressionFraction.ideal()),
                "compression fraction thresholds must be finite and ordered");
        require(minimumValidCompressions >= 1, "minimum valid compressions must be positive");
        require(caps != null && finite(caps.depthCriticalBelow(), caps.rateCriticalBelow(),
                        caps.compressionFractionCriticalBelow()) &&
                validScore(caps.depthMaximum()) && validScore(caps.rateMaximum()) &&
                validScore(caps.compressionFractionMaximum()), "critical caps are invalid");
        require(grades != null && !grades.isEmpty(), "grade bands are required");
        boolean[] covered = new boolean[101];
        for (GradeBand grade : grades) {
            require(grade != null && grade.label() != null && !grade.label().isBlank() &&
                    validScore(grade.minimum()) && validScore(grade.maximum()) &&
                    grade.minimum() <= grade.maximum(), "grade band is invalid");
            for (int score = grade.minimum(); score <= grade.maximum(); score++) {
                require(!covered[score], "grade bands overlap");
                covered[score] = true;
            }
        }
        for (boolean present : covered) require(present, "grade bands must cover 0 through 100");
        return this;
    }

    private static void validateBand(Band band, String name) {
        require(band != null && finite(band.failLow(), band.idealLow(), band.idealHigh(), band.failHigh()) &&
                band.failLow() < band.idealLow() && band.idealLow() <= band.idealHigh() &&
                band.idealHigh() < band.failHigh(), name + " thresholds are invalid");
    }

    private static void validateQuality(QualityPercent quality, String name) {
        require(quality != null && ordered(quality.fail(), quality.acceptable(), quality.ideal()) &&
                quality.fail() >= 0.0 && quality.ideal() <= 100.0,
                name + " percentage thresholds are invalid");
    }

    private static boolean ordered(double low, double middle, double high) {
        return finite(low, middle, high) && low < middle && middle < high;
    }
    private static boolean finite(double... values) {
        for (double value : values) if (!Double.isFinite(value)) return false;
        return true;
    }
    private static boolean validScore(int score) { return score >= 0 && score <= 100; }
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }

    public record Weights(double depth, double rate, double recoil, double handPlacement,
                          double compressionFraction) {
        double total() { return depth + rate + recoil + handPlacement + compressionFraction; }
    }
    public record Band(double idealLow, double idealHigh, double failLow, double failHigh) {}
    public record QualityPercent(double fail, double acceptable, double ideal) {}
    public record CompressionFraction(double fail, double acceptable, double ideal) {}
    public record Caps(double depthCriticalBelow, int depthMaximum,
                       double rateCriticalBelow, int rateMaximum,
                       double compressionFractionCriticalBelow, int compressionFractionMaximum) {}
    public record GradeBand(int minimum, int maximum, String label) {}
}
