package lk.resq.localhub.model;

import java.time.Instant;

public record SessionSummary(
        String sessionId,
        String deviceId,
        String traineeId,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        int sampleCount,
        int totalCompressions,
        int validCompressions,
                double avgDepthMm,
        Double avgDepthProgress,
                double avgRateCpm,
                double recoilPct,
        int recoilOkCount,
        int incompleteRecoilCount,
        int pausesCount,
        int score,
                String latestFlags,
                double minDepthMm,
                double maxDepthMm,
                double depthAccuracyPercent,
                double rateAccuracyPercent,
                double recoilErrorPercent,
                double longestPauseSeconds,
                double consistencyScore,
                double fatigueDropPercent
) {
        public SessionSummary {
                requirePositive(durationSeconds, "durationSeconds");
                requireNonNegative(sampleCount, "sampleCount");
                requireNonNegative(totalCompressions, "totalCompressions");
                requireNonNegative(validCompressions, "validCompressions");
                requireNonNegative(avgDepthMm, "avgDepthMm");
                if (avgDepthProgress != null && avgDepthProgress < 0.0) {
                        throw new IllegalArgumentException("avgDepthProgress must not be negative");
                }
                requireNonNegative(avgRateCpm, "avgRateCpm");
                requirePercentage(recoilPct, "recoilPct");
                requireNonNegative(recoilOkCount, "recoilOkCount");
                requireNonNegative(incompleteRecoilCount, "incompleteRecoilCount");
                requireNonNegative(pausesCount, "pausesCount");
                requirePercentage(score, "score");
                requireNonNegative(minDepthMm, "minDepthMm");
                requireNonNegative(maxDepthMm, "maxDepthMm");
                requirePercentage(depthAccuracyPercent, "depthAccuracyPercent");
                requirePercentage(rateAccuracyPercent, "rateAccuracyPercent");
                requirePercentage(recoilErrorPercent, "recoilErrorPercent");
                requireNonNegative(longestPauseSeconds, "longestPauseSeconds");
                requirePercentage(consistencyScore, "consistencyScore");
                requirePercentage(fatigueDropPercent, "fatigueDropPercent");
        }

        public SessionSummary(
                        String sessionId,
                        String deviceId,
                        String traineeId,
                        Instant startedAt,
                        Instant endedAt,
                        long durationSeconds,
                        int sampleCount,
                        int totalCompressions,
                        int validCompressions,
                        Double avgDepthMm,
                        Double avgDepthProgress,
                        Double avgRateCpm,
                        Double recoilPct,
                        int recoilOkCount,
                        int incompleteRecoilCount,
                        int pausesCount,
                        int score,
                        String latestFlags
        ) {
                this(
                                sessionId,
                                deviceId,
                                traineeId,
                                startedAt,
                                endedAt,
                                durationSeconds,
                                sampleCount,
                                totalCompressions,
                                validCompressions,
                                avgDepthMm == null ? 0.0 : avgDepthMm,
                                avgDepthProgress,
                                avgRateCpm == null ? 0.0 : avgRateCpm,
                                recoilPct == null ? 0.0 : recoilPct,
                                recoilOkCount,
                                incompleteRecoilCount,
                                pausesCount,
                                score,
                                latestFlags,
                                0.0,
                                0.0,
                                0.0,
                                0.0,
                                0.0,
                                0.0,
                                0.0,
                                0.0
                );
        }

        public int overallScore() {
                return score;
        }

        public int pauseCount() {
                return pausesCount;
        }

        private static void requirePositive(long value, String name) {
                if (value <= 0) {
                        throw new IllegalArgumentException(name + " must be positive");
                }
        }

        private static void requireNonNegative(int value, String name) {
                if (value < 0) {
                        throw new IllegalArgumentException(name + " must not be negative");
                }
        }

        private static void requireNonNegative(double value, String name) {
                if (value < 0.0) {
                        throw new IllegalArgumentException(name + " must not be negative");
                }
        }

        private static void requirePercentage(double value, String name) {
                if (value < 0.0 || value > 100.0) {
                        throw new IllegalArgumentException(name + " must be between 0 and 100");
                }
        }
}