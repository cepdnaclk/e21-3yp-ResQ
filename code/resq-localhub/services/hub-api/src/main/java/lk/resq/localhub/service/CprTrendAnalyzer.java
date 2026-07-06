package lk.resq.localhub.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.CprTrendAnalysis.TrendDirection;

@Service
public class CprTrendAnalyzer {

    private final LocalSessionRepository localSessionRepository;
    private final CprPerformanceAnalyzer cprPerformanceAnalyzer;
    private final CprPerformanceAnalyzerProperties properties;

    @Autowired
    public CprTrendAnalyzer(
            LocalSessionRepository localSessionRepository,
            CprPerformanceAnalyzer cprPerformanceAnalyzer,
            CprPerformanceAnalyzerProperties properties
    ) {
        this.localSessionRepository = localSessionRepository;
        this.cprPerformanceAnalyzer = cprPerformanceAnalyzer;
        this.properties = properties;
    }

    // Overload for tests/local construction
    public CprTrendAnalyzer(
            CprPerformanceAnalyzer cprPerformanceAnalyzer,
            CprPerformanceAnalyzerProperties properties
    ) {
        this.localSessionRepository = null;
        this.cprPerformanceAnalyzer = cprPerformanceAnalyzer;
        this.properties = properties;
    }

    public CprTrendAnalysis analyzeUserTrend(String userId, Instant fromDate, Instant toDate) {
        if (localSessionRepository == null) {
            throw new IllegalStateException("Trend analysis requires a session repository");
        }
        if (fromDate != null && toDate != null && fromDate.isAfter(toDate)) {
            throw new IllegalArgumentException("fromDate must be before or equal to toDate");
        }

        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(
                normalize(userId),
                null,
                fromDate == null ? null : fromDate.toString(),
                toDate == null ? null : toDate.toString(),
                null
        );

        List<CprSessionSummaryResponse> sessions = localSessionRepository.findCprSessions(query);
        return analyzeTrend(sessions);
    }

    public CprTrendAnalysis analyzeTrend(List<CprSessionSummaryResponse> sessions) {
        if (sessions == null || sessions.size() < 2) {
            double avgScore = 0.0;
            if (sessions != null && !sessions.isEmpty()) {
                avgScore = sessions.stream().mapToInt(CprSessionSummaryResponse::overallScore).average().orElse(0.0);
            }
            return new CprTrendAnalysis(
                    sessions == null ? 0 : sessions.size(),
                    avgScore,
                    null,
                    null,
                    TrendDirection.NOT_ENOUGH_DATA,
                    List.of(),
                    List.of(),
                    List.of(),
                    "Keep practicing! Perform more CPR training sessions to enable detailed trend analysis and personalized coaching feedback."
            );
        }

        // Sort chronologically ascending
        List<CprSessionSummaryResponse> sorted = sessions.stream()
                .sorted(Comparator.comparing(CprSessionSummaryResponse::startedAt))
                .toList();

        int total = sorted.size();
        double avgScore = sorted.stream().mapToInt(CprSessionSummaryResponse::overallScore).average().orElse(0.0);

        CprSessionSummaryResponse best = sorted.stream()
                .max(Comparator.comparingInt(CprSessionSummaryResponse::overallScore))
                .orElse(null);

        CprSessionSummaryResponse worst = sorted.stream()
                .min(Comparator.comparingInt(CprSessionSummaryResponse::overallScore))
                .orElse(null);

        // Split into two halves
        int halfSize = total / 2;
        List<CprSessionSummaryResponse> earlier = sorted.subList(0, halfSize);
        List<CprSessionSummaryResponse> recent = sorted.subList(halfSize, total);

        // Averages
        double avgEarlierScore = earlier.stream().mapToInt(CprSessionSummaryResponse::overallScore).average().orElse(0.0);
        double avgRecentScore = recent.stream().mapToInt(CprSessionSummaryResponse::overallScore).average().orElse(0.0);

        double avgEarlierDepthAcc = earlier.stream().mapToDouble(CprSessionSummaryResponse::depthAccuracyPercent).average().orElse(0.0);
        double avgRecentDepthAcc = recent.stream().mapToDouble(CprSessionSummaryResponse::depthAccuracyPercent).average().orElse(0.0);

        double avgEarlierRateAcc = earlier.stream().mapToDouble(CprSessionSummaryResponse::rateAccuracyPercent).average().orElse(0.0);
        double avgRecentRateAcc = recent.stream().mapToDouble(CprSessionSummaryResponse::rateAccuracyPercent).average().orElse(0.0);

        double avgEarlierRecoilError = earlier.stream().mapToDouble(CprSessionSummaryResponse::recoilErrorPercent).average().orElse(0.0);
        double avgRecentRecoilError = recent.stream().mapToDouble(CprSessionSummaryResponse::recoilErrorPercent).average().orElse(0.0);

        double avgEarlierConsistency = earlier.stream().mapToDouble(CprSessionSummaryResponse::consistencyScore).average().orElse(0.0);
        double avgRecentConsistency = recent.stream().mapToDouble(CprSessionSummaryResponse::consistencyScore).average().orElse(0.0);

        double avgEarlierFatigue = earlier.stream().mapToDouble(CprSessionSummaryResponse::fatigueDropPercent).average().orElse(0.0);
        double avgRecentFatigue = recent.stream().mapToDouble(CprSessionSummaryResponse::fatigueDropPercent).average().orElse(0.0);

        // Determine Overall Trend Direction
        TrendDirection direction;
        double scoreDiff = avgRecentScore - avgEarlierScore;
        if (scoreDiff > 2.0) {
            direction = TrendDirection.IMPROVING;
        } else if (scoreDiff < -2.0) {
            direction = TrendDirection.DECLINING;
        } else {
            direction = TrendDirection.STABLE;
        }

        // Improved Areas
        List<String> improved = new ArrayList<>();
        if (avgRecentDepthAcc - avgEarlierDepthAcc > 2.0) {
            improved.add("Compression depth accuracy");
        }
        if (avgRecentRateAcc - avgEarlierRateAcc > 2.0) {
            improved.add("Compression rate accuracy");
        }
        double recoilEarlier = 100.0 - avgEarlierRecoilError;
        double recoilRecent = 100.0 - avgRecentRecoilError;
        if (recoilRecent - recoilEarlier > 2.0) {
            improved.add("Chest recoil release");
        }
        if (avgRecentConsistency - avgEarlierConsistency > 2.0) {
            improved.add("Compression consistency");
        }
        if (avgEarlierFatigue - avgRecentFatigue > 2.0) { // fatigue decreased
            improved.add("Stamina (reduced fatigue signs)");
        }

        // Weakest Areas
        List<String> weakest = new ArrayList<>();
        if (avgRecentDepthAcc < properties.getBadPerformanceDepthAccuracyThreshold() || avgRecentDepthAcc - avgEarlierDepthAcc < -2.0) {
            weakest.add("Compression depth accuracy");
        }
        if (avgRecentRateAcc < properties.getBadPerformanceRateAccuracyThreshold() || avgRecentRateAcc - avgEarlierRateAcc < -2.0) {
            weakest.add("Compression rate accuracy");
        }
        if (avgRecentRecoilError > properties.getRecoilErrorThresholdPercent() || recoilRecent - recoilEarlier < -2.0) {
            weakest.add("Chest recoil release");
        }
        if (avgRecentConsistency < properties.getConsistencyScoreThreshold() || avgRecentConsistency - avgEarlierConsistency < -2.0) {
            weakest.add("Compression consistency");
        }
        if (avgRecentFatigue > properties.getFatigueDropThresholdPercent() || avgRecentFatigue - avgEarlierFatigue > 2.0) {
            weakest.add("Fatigue management");
        }

        // Repeated Mistakes/Issues using warningFlags from CprPerformanceAnalyzer
        Map<String, Integer> flagCounts = new HashMap<>();
        for (CprSessionSummaryResponse session : sorted) {
            if (cprPerformanceAnalyzer != null) {
                var analysis = cprPerformanceAnalyzer.analyze(session);
                for (String flag : analysis.warningFlags()) {
                    flagCounts.put(flag, flagCounts.getOrDefault(flag, 0) + 1);
                }
            }
        }

        List<String> repeated = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : flagCounts.entrySet()) {
            if (entry.getValue() >= 2) {
                String friendly = mapWarningFlagToDescription(entry.getKey());
                if (friendly != null) {
                    repeated.add(friendly);
                }
            }
        }

        // Recommendation Summary
        String recSummary;
        String weakAreasStr = weakest.isEmpty() ? "none" : String.join(", ", weakest);
        String repeatedStr = repeated.isEmpty() ? "none" : String.join(", ", repeated);

        if (direction == TrendDirection.IMPROVING) {
            recSummary = "Your overall CPR performance is improving! Keep up the good work. Focus on continuing to build muscle memory, particularly for: " + weakAreasStr + ".";
        } else if (direction == TrendDirection.DECLINING) {
            recSummary = "Your overall CPR score shows a declining trend. Consider taking slower, focused practice sessions and paying close attention to: " + weakAreasStr + " (Repeated issues: " + repeatedStr + ").";
        } else {
            recSummary = "Your CPR performance remains stable. To push your score higher, work on: " + weakAreasStr + " and reduce repeated mistakes: " + repeatedStr + ".";
        }

        return new CprTrendAnalysis(
                total,
                avgScore,
                best,
                worst,
                direction,
                List.copyOf(repeated),
                List.copyOf(improved),
                List.copyOf(weakest),
                recSummary
        );
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String mapWarningFlagToDescription(String flag) {
        return switch (flag) {
            case "DEPTH_SHALLOW" -> "Consistently shallow compressions";
            case "DEPTH_TOO_DEEP" -> "Consistently too-deep compressions";
            case "RATE_SLOW" -> "Slow compression rate rhythm";
            case "RATE_FAST" -> "Fast compression rate rhythm";
            case "HIGH_RECOIL_ERROR" -> "Incomplete chest recoil (not fully releasing chest)";
            case "POOR_CONSISTENCY" -> "Inconsistent depth or rate";
            case "FATIGUE_DETECTED" -> "Fatigue signs in later stages of training";
            case "EXCESSIVE_PAUSES" -> "Frequent or long pauses during compressions";
            default -> null;
        };
    }
}
