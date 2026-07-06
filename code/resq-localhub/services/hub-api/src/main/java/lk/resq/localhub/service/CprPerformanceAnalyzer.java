package lk.resq.localhub.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import lk.resq.localhub.config.CprPerformanceAnalyzerProperties;
import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis.OverallStatus;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

@Service
public class CprPerformanceAnalyzer {

    private final LocalSessionRepository localSessionRepository;
    private final CprPerformanceAnalyzerProperties properties;

    @Autowired
    public CprPerformanceAnalyzer(LocalSessionRepository localSessionRepository, CprPerformanceAnalyzerProperties properties) {
        this.localSessionRepository = localSessionRepository;
        this.properties = properties;
    }

    public CprPerformanceAnalyzer(CprPerformanceAnalyzerProperties properties) {
        this.localSessionRepository = null;
        this.properties = properties;
    }

    public CprPerformanceAnalysis analyze(CprSessionSummaryResponse session) {
        if (session == null) {
            throw new IllegalArgumentException("session is required");
        }

        List<String> mainIssues = new ArrayList<>();
        List<String> strengths = new ArrayList<>();
        List<String> recommendations = new ArrayList<>();
        List<String> warningFlags = new ArrayList<>();

        boolean depthInRange = isInRange(session.avgDepthMm(), properties.getCompressionDepthMinMm(), properties.getCompressionDepthMaxMm());
        boolean rateInRange = isInRange(session.avgRateCpm(), properties.getCompressionRateMinCpm(), properties.getCompressionRateMaxCpm());

        if (session.avgDepthMm() < properties.getCompressionDepthMinMm()) {
            addIssue(mainIssues, warningFlags, "Shallow compressions: average depth was below the 50-60 mm target.", "DEPTH_SHALLOW");
            recommendations.add("Aim for a deeper chest compression until the average depth reaches the target range.");
        } else if (session.avgDepthMm() > properties.getCompressionDepthMaxMm()) {
            addIssue(mainIssues, warningFlags, "Too-deep compressions: average depth was above the 50-60 mm target.", "DEPTH_TOO_DEEP");
            recommendations.add("Reduce compression depth slightly so the average stays within the target range.");
        } else {
            strengths.add("Compression depth stayed within the target range.");
        }

        if (session.avgRateCpm() < properties.getCompressionRateMinCpm()) {
            addIssue(mainIssues, warningFlags, "Slow compression rate: average cadence was below 100 cpm.", "RATE_SLOW");
            recommendations.add("Use a steadier rhythm so the average rate rises into the target range.");
        } else if (session.avgRateCpm() > properties.getCompressionRateMaxCpm()) {
            addIssue(mainIssues, warningFlags, "Fast compression rate: average cadence was above 120 cpm.", "RATE_FAST");
            recommendations.add("Slow the rhythm slightly so the average rate stays within the target range.");
        } else {
            strengths.add("Compression rate stayed within the target range.");
        }

        if (session.recoilErrorPercent() > properties.getRecoilErrorThresholdPercent()) {
            addIssue(mainIssues, warningFlags, "Recoil errors were higher than the configured threshold.", "HIGH_RECOIL_ERROR");
            recommendations.add("Focus on full chest release between compressions to reduce recoil errors.");
        } else {
            strengths.add("Recoil errors remained within the configured threshold.");
        }

        if (session.consistencyScore() < properties.getConsistencyScoreThreshold()) {
            addIssue(mainIssues, warningFlags, "Consistency was below the configured target.", "POOR_CONSISTENCY");
            recommendations.add("Keep compression rhythm and depth steadier across the session.");
        } else {
            strengths.add("Consistency stayed above the configured target.");
        }

        if (session.fatigueDropPercent() > properties.getFatigueDropThresholdPercent()) {
            addIssue(mainIssues, warningFlags, "Fatigue signs increased during the session.", "FATIGUE_DETECTED");
            recommendations.add("Use shorter practice sets with pauses for reset when fatigue starts to appear.");
        } else {
            strengths.add("No strong fatigue pattern was detected during the session.");
        }

        boolean excessivePauseCount = session.pauseCount() > properties.getExcessivePauseCountThreshold();
        boolean excessiveLongestPause = session.longestPauseSeconds() > properties.getExcessiveLongestPauseSecondsThreshold();
        if (excessivePauseCount || excessiveLongestPause) {
            addIssue(mainIssues, warningFlags, "Pauses were longer or more frequent than the configured limit.", "EXCESSIVE_PAUSES");
            recommendations.add("Reduce interruptions and keep transitions between compression sets shorter.");
        } else {
            strengths.add("Pauses stayed within the configured limit.");
        }

        OverallStatus overallStatus = classify(mainIssues.size());
        String shortSummary = buildShortSummary(overallStatus, mainIssues, strengths);

        return new CprPerformanceAnalysis(
                overallStatus,
                List.copyOf(mainIssues),
                List.copyOf(strengths),
                List.copyOf(recommendations),
                List.copyOf(warningFlags),
                shortSummary
        );
    }

    public List<CprBadPerformanceSession> findBadPerformanceSessions(String userId, Instant fromDate, Instant toDate) {
        if (localSessionRepository == null) {
            throw new IllegalStateException("Bad performance search requires a session repository");
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

        return findBadPerformanceSessions(localSessionRepository.findCprSessions(query));
        }

        public List<CprBadPerformanceSession> findBadPerformanceSessions(List<CprSessionSummaryResponse> sessions) {
        if (sessions == null || sessions.isEmpty()) {
            return List.of();
        }

        return sessions.stream()
                .map(this::assessBadPerformance)
                .filter(assessment -> !assessment.failedMetrics().isEmpty())
                .map(assessment -> new CprBadPerformanceSession(
                        assessment.session().id(),
                        assessment.session().createdAt(),
                        assessment.session().overallScore(),
                        List.copyOf(assessment.failedMetrics()),
                        assessment.shortReason(),
                        assessment.recommendation()
                ))
                .toList();
    }

    private static OverallStatus classify(int issueCount) {
        if (issueCount == 0) {
            return OverallStatus.GOOD;
        }
        if (issueCount <= 2) {
            return OverallStatus.NEEDS_IMPROVEMENT;
        }
        return OverallStatus.POOR;
    }

    private static boolean isInRange(double value, double minInclusive, double maxInclusive) {
        return value >= minInclusive && value <= maxInclusive;
    }

    private BadPerformanceAssessment assessBadPerformance(CprSessionSummaryResponse session) {
        List<String> failedMetrics = new ArrayList<>();
        List<String> recommendations = new ArrayList<>();

        if (session.overallScore() < properties.getBadPerformanceOverallScoreThreshold()) {
            failedMetrics.add("overallScore");
            recommendations.add("Review the full session and focus on steady control across the whole CPR cycle.");
        }

        if (session.avgDepthMm() < properties.getCompressionDepthMinMm()) {
            failedMetrics.add("avgDepthMm");
            recommendations.add("Practice slightly deeper compressions so the average depth reaches the target range.");
        } else if (session.avgDepthMm() > properties.getCompressionDepthMaxMm()) {
            failedMetrics.add("avgDepthMm");
            recommendations.add("Reduce compression depth slightly so the average stays within the target range.");
        }

        if (session.depthAccuracyPercent() < properties.getBadPerformanceDepthAccuracyThreshold()) {
            failedMetrics.add("depthAccuracyPercent");
            recommendations.add("Keep compression depth closer to the target range to improve depth accuracy.");
        }

        if (session.avgRateCpm() < properties.getCompressionRateMinCpm()) {
            failedMetrics.add("avgRateCpm");
            recommendations.add("Use a steadier rhythm to bring the average compression rate up into range.");
        } else if (session.avgRateCpm() > properties.getCompressionRateMaxCpm()) {
            failedMetrics.add("avgRateCpm");
            recommendations.add("Slow the rhythm slightly so the average compression rate stays within range.");
        }

        if (session.rateAccuracyPercent() < properties.getBadPerformanceRateAccuracyThreshold()) {
            failedMetrics.add("rateAccuracyPercent");
            recommendations.add("Keep the compression cadence more consistent to improve rate accuracy.");
        }

        if (session.recoilErrorPercent() > properties.getRecoilErrorThresholdPercent()) {
            failedMetrics.add("recoilErrorPercent");
            recommendations.add("Focus on full chest release between compressions to reduce recoil errors.");
        }

        if (session.consistencyScore() < properties.getConsistencyScoreThreshold()) {
            failedMetrics.add("consistencyScore");
            recommendations.add("Keep rhythm and depth steadier across the session to improve consistency.");
        }

        if (session.fatigueDropPercent() > properties.getFatigueDropThresholdPercent()) {
            failedMetrics.add("fatigueDropPercent");
            recommendations.add("Use shorter practice sets or reset sooner when fatigue starts to appear.");
        }

        boolean excessivePauseCount = session.pauseCount() > properties.getExcessivePauseCountThreshold();
        boolean excessiveLongestPause = session.longestPauseSeconds() > properties.getExcessiveLongestPauseSecondsThreshold();
        if (excessivePauseCount || excessiveLongestPause) {
            failedMetrics.add("pauses");
            recommendations.add("Reduce interruptions and keep transitions between compression sets shorter.");
        }

        String shortReason = failedMetrics.isEmpty()
                ? "Session stayed within the configured CPR performance thresholds."
                : toShortReason(failedMetrics, session);
        String recommendation = recommendations.isEmpty()
                ? "Keep practicing to reinforce consistent CPR technique."
                : String.join(" ", recommendations);

        return new BadPerformanceAssessment(session, failedMetrics, shortReason, recommendation);
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private String toShortReason(List<String> failedMetrics, CprSessionSummaryResponse session) {
        if (failedMetrics.contains("avgDepthMm") && failedMetrics.contains("depthAccuracyPercent")) {
            return "Shallow depth and low depth accuracy were detected.";
        }
        if (failedMetrics.contains("avgDepthMm")) {
            if (session.avgDepthMm() < properties.getCompressionDepthMinMm()) {
                return "Shallow compression depth was detected.";
            } else {
                return "Too-deep compression depth was detected.";
            }
        }
        if (failedMetrics.contains("avgRateCpm") && failedMetrics.contains("rateAccuracyPercent")) {
            return "Compression rate was too fast or too slow, and rate accuracy was low.";
        }
        if (failedMetrics.contains("avgRateCpm")) {
            if (session.avgRateCpm() < properties.getCompressionRateMinCpm()) {
                return "Slow compression rate was detected.";
            } else {
                return "Fast compression rate was detected.";
            }
        }
        if (failedMetrics.contains("recoilErrorPercent")) {
            return "Recoil control was below the configured target.";
        }
        if (failedMetrics.contains("fatigueDropPercent")) {
            return "Fatigue signs increased during the session.";
        }
        if (failedMetrics.contains("pauses")) {
            return "The session had excessive pauses.";
        }
        if (failedMetrics.contains("consistencyScore")) {
            return "Compression consistency was below the configured target.";
        }
        if (failedMetrics.contains("overallScore")) {
            return "The overall score was below the configured threshold.";
        }
        return "One or more CPR performance metrics were below the configured target.";
    }

    private record BadPerformanceAssessment(
            CprSessionSummaryResponse session,
            List<String> failedMetrics,
            String shortReason,
            String recommendation
    ) {
    }

    private static void addIssue(List<String> issues, List<String> flags, String message, String flag) {
        issues.add(message);
        flags.add(flag);
    }

    private static String buildShortSummary(OverallStatus status, List<String> mainIssues, List<String> strengths) {
        if (status == OverallStatus.GOOD) {
            return "Good CPR practice session. Core compression quality stayed within target ranges, with steady control and no major concerns.";
        }

        String issueText = mainIssues.isEmpty() ? "a few areas need refinement" : mainIssues.get(0).toLowerCase();
        String strengthText = strengths.isEmpty() ? "some useful practice habits" : strengths.get(0).toLowerCase();

        if (status == OverallStatus.NEEDS_IMPROVEMENT) {
            return "This session is on track, but " + issueText + ". Keep reinforcing " + strengthText + ".";
        }

        return "This session needs more practice because " + issueText + ". Build on " + strengthText + " and focus on the target ranges one step at a time.";
    }
}