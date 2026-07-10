package lk.resq.localhub.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import lk.resq.localhub.model.cpr.CprInstructorCoachQueryRequest;
import lk.resq.localhub.model.cpr.CprInstructorCoachResponse;
import lk.resq.localhub.model.cpr.CprInstructorCoachResponse.PriorityTrainee;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.CprTrendAnalysis.TrendDirection;

@Service
public class CprInstructorCoachService {

    private final LocalSessionRepository sessionRepository;
    private final CprPerformanceAnalyzer performanceAnalyzer;
    private final CprTrendAnalyzer trendAnalyzer;
    private final LocalAuthRepository authRepository;
    private final RosterCacheRepository rosterRepository;

    @Autowired
    public CprInstructorCoachService(
            LocalSessionRepository sessionRepository,
            CprPerformanceAnalyzer performanceAnalyzer,
            CprTrendAnalyzer trendAnalyzer,
            LocalAuthRepository authRepository,
            @Autowired(required = false) RosterCacheRepository rosterRepository
    ) {
        this.sessionRepository = sessionRepository;
        this.performanceAnalyzer = performanceAnalyzer;
        this.trendAnalyzer = trendAnalyzer;
        this.authRepository = authRepository;
        this.rosterRepository = rosterRepository;
    }

    public CprInstructorCoachResponse generateResponse(CprInstructorCoachQueryRequest request) {
        if (request == null || request.question() == null || request.question().isBlank()) {
            return new CprInstructorCoachResponse(
                    "Please provide a valid question.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        String question = request.question().toLowerCase().trim();

        if (question.contains("attention")) {
            return handleTraineesNeedAttention(request);
        } else if (question.contains("common") || question.contains("mistake") || question.contains("error") || question.contains("fail")) {
            return handleCommonMistakes(request);
        } else if (question.contains("summarize") || question.contains("summary")) {
            return handleSummarizeTrainee(request);
        } else if (question.contains("compare") || question.contains("trend") || question.contains("progress")) {
            return handleCompareTrainee(request);
        } else if (question.contains("feedback") || question.contains("suggest")) {
            return handleFeedbackTrainee(request);
        }

        // Default fallback if traineeId is provided
        if (request.traineeId() != null && !request.traineeId().isBlank()) {
            return handleSummarizeTrainee(request);
        }

        return new CprInstructorCoachResponse(
                "I can help you review class performance, trends, and individual trainees. Supported questions include:\n"
                + "1. 'Which trainees need attention today?'\n"
                + "2. 'What are the most common mistakes?'\n"
                + "3. 'Summarize this trainee's last session.' (Please select a trainee or session)\n"
                + "4. 'Compare this trainee's recent sessions.' (Please select a trainee)\n"
                + "5. 'What feedback should I give this trainee?' (Please select a trainee)",
                List.of(), List.of(), List.of(), List.of()
        );
    }

    private List<CprSessionSummaryResponse> fetchRecentSessions(CprInstructorCoachQueryRequest request) {
        if (request.fromDate() != null || request.toDate() != null) {
            String fromStr = request.fromDate() != null ? request.fromDate().toString() : null;
            String toStr = request.toDate() != null ? request.toDate().toString() : null;
            CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(
                    null, null, fromStr, toStr, null
            );
            return sessionRepository.findCprSessions(query);
        }

        Instant now = Instant.now();
        
        // 1. Try last 24 hours
        CprSessionSummaryQueryRequest query24h = new CprSessionSummaryQueryRequest(
                null, null, now.minus(24, ChronoUnit.HOURS).toString(), now.toString(), null
        );
        List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(query24h);
        if (!sessions.isEmpty()) {
            return sessions;
        }

        // 2. Try last 7 days
        CprSessionSummaryQueryRequest query7d = new CprSessionSummaryQueryRequest(
                null, null, now.minus(7, ChronoUnit.DAYS).toString(), now.toString(), null
        );
        sessions = sessionRepository.findCprSessions(query7d);
        if (!sessions.isEmpty()) {
            return sessions;
        }

        // 3. Fallback to all sessions
        CprSessionSummaryQueryRequest queryAll = new CprSessionSummaryQueryRequest(null, null, null, null, null);
        return sessionRepository.findCprSessions(queryAll);
    }

    private String getTraineeDisplayName(String traineeId) {
        if (traineeId == null || traineeId.isBlank()) {
            return "Anonymous";
        }
        String idOrUser = traineeId.trim();
        Optional<LocalAuthRepository.UserRecord> localUser = authRepository.findUserById(idOrUser);
        if (localUser.isPresent()) {
            return localUser.get().displayName();
        }
        localUser = authRepository.findUserByUsername(idOrUser);
        if (localUser.isPresent()) {
            return localUser.get().displayName();
        }
        if (rosterRepository != null) {
            Optional<RosterCacheRepository.SyncedUserRecord> syncedUser = rosterRepository.findSyncedUserById(idOrUser);
            if (syncedUser.isPresent()) {
                return syncedUser.get().displayName();
            }
            syncedUser = rosterRepository.findSyncedUserByEmail(idOrUser);
            if (syncedUser.isPresent()) {
                return syncedUser.get().displayName();
            }
        }
        return idOrUser;
    }

    private CprInstructorCoachResponse handleTraineesNeedAttention(CprInstructorCoachQueryRequest request) {
        List<CprSessionSummaryResponse> sessions = fetchRecentSessions(request);
        if (sessions.isEmpty()) {
            return new CprInstructorCoachResponse(
                    "No completed CPR sessions found in the database. Instruct trainees to complete a session first.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        // Group by traineeId and find the most recent session
        Map<String, CprSessionSummaryResponse> latestSessions = new HashMap<>();
        for (CprSessionSummaryResponse s : sessions) {
            String trainee = s.traineeId() != null ? s.traineeId() : s.userId();
            if (trainee != null && !latestSessions.containsKey(trainee)) {
                latestSessions.put(trainee, s);
            }
        }

        List<PriorityTrainee> priorityTrainees = new ArrayList<>();
        List<String> commonIssues = new ArrayList<>();
        List<String> suggestedActions = new ArrayList<>();
        List<String> relatedSessionIds = new ArrayList<>();

        for (Map.Entry<String, CprSessionSummaryResponse> entry : latestSessions.entrySet()) {
            String traineeId = entry.getKey();
            CprSessionSummaryResponse lastSession = entry.getValue();
            CprPerformanceAnalysis analysis = performanceAnalyzer.analyze(lastSession);

            if (analysis.overallStatus() != CprPerformanceAnalysis.OverallStatus.GOOD) {
                String name = getTraineeDisplayName(traineeId);
                String reason = String.join(", ", analysis.mainIssues());
                if (reason.isEmpty()) {
                    reason = "Session overall score was below 70%.";
                }
                
                priorityTrainees.add(new PriorityTrainee(
                        traineeId,
                        name,
                        lastSession.overallScore(),
                        reason,
                        lastSession.id()
                ));
                
                relatedSessionIds.add(lastSession.id());
                
                for (String issue : analysis.mainIssues()) {
                    if (!commonIssues.contains(issue)) {
                        commonIssues.add(issue);
                    }
                }
                
                for (String rec : analysis.recommendations()) {
                    String action = "For " + name + ": " + rec;
                    if (!suggestedActions.contains(action)) {
                        suggestedActions.add(action);
                    }
                }
            }
        }

        String answer;
        if (priorityTrainees.isEmpty()) {
            answer = "All trainees who completed recent sessions performed well. No trainees currently need attention.";
        } else {
            StringBuilder sb = new StringBuilder("The following trainees need attention based on their latest session metrics:\n");
            for (PriorityTrainee pt : priorityTrainees) {
                sb.append(String.format("- **%s** (%s): Score %d%%. Issues: %s\n",
                        pt.name(), pt.traineeId(), pt.lastSessionScore(), pt.reasonForAttention()));
            }
            answer = sb.toString();
        }

        return new CprInstructorCoachResponse(
                answer,
                priorityTrainees,
                commonIssues,
                suggestedActions,
                relatedSessionIds
        );
    }

    private CprInstructorCoachResponse handleCommonMistakes(CprInstructorCoachQueryRequest request) {
        String fromStr = request.fromDate() != null ? request.fromDate().toString() : null;
        String toStr = request.toDate() != null ? request.toDate().toString() : null;
        CprSessionSummaryQueryRequest queryAll = new CprSessionSummaryQueryRequest(null, null, fromStr, toStr, null);
        List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(queryAll);
        if (sessions.isEmpty()) {
            return new CprInstructorCoachResponse(
                    "No completed sessions found to analyze mistakes.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        Map<String, Integer> mistakeCounts = new HashMap<>();
        Map<String, List<String>> mistakeSessionIds = new HashMap<>();

        for (CprSessionSummaryResponse s : sessions) {
            CprPerformanceAnalysis analysis = performanceAnalyzer.analyze(s);
            for (String flag : analysis.warningFlags()) {
                String desc = mapWarningFlagToDescription(flag);
                if (desc != null) {
                    mistakeCounts.put(desc, mistakeCounts.getOrDefault(desc, 0) + 1);
                    mistakeSessionIds.computeIfAbsent(desc, k -> new ArrayList<>()).add(s.id());
                }
            }
        }

        if (mistakeCounts.isEmpty()) {
            return new CprInstructorCoachResponse(
                    "No common mistakes detected. Trainees are performing well within clinical guidelines.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        List<Map.Entry<String, Integer>> sortedMistakes = mistakeCounts.entrySet().stream()
                .sorted(Map.Entry.comparingByValue(Comparator.reverseOrder()))
                .toList();

        List<String> commonIssues = new ArrayList<>();
        List<String> suggestedActions = new ArrayList<>();
        List<String> relatedSessionIds = new ArrayList<>();
        StringBuilder answerBuilder = new StringBuilder("Here are the most common mistakes identified across all completed sessions:\n");

        int index = 1;
        for (Map.Entry<String, Integer> entry : sortedMistakes) {
            String mistake = entry.getKey();
            int count = entry.getValue();
            commonIssues.add(mistake);
            
            List<String> ids = mistakeSessionIds.getOrDefault(mistake, List.of());
            relatedSessionIds.addAll(ids);

            answerBuilder.append(String.format("%d. **%s** — affected %d session(s).\n", index++, mistake, count));
            
            String action = getSuggestedActionForMistake(mistake);
            if (!suggestedActions.contains(action)) {
                suggestedActions.add(action);
            }
        }

        List<String> trimmedSessionIds = relatedSessionIds.stream().distinct().limit(10).toList();

        return new CprInstructorCoachResponse(
                answerBuilder.toString(),
                List.of(),
                commonIssues,
                suggestedActions,
                trimmedSessionIds
        );
    }

    private String mapWarningFlagToDescription(String flag) {
        return switch (flag) {
            case "DEPTH_SHALLOW" -> "Shallow compressions (average depth below target)";
            case "DEPTH_TOO_DEEP" -> "Too-deep compressions (average depth above target)";
            case "RATE_SLOW" -> "Slow compression rate (average rate below target)";
            case "RATE_FAST" -> "Fast compression rate (average rate above target)";
            case "HIGH_RECOIL_ERROR" -> "Incomplete chest recoil (not fully releasing chest)";
            case "POOR_CONSISTENCY" -> "Poor compression consistency";
            case "FATIGUE_DETECTED" -> "Fatigue signs detected in later stages";
            case "EXCESSIVE_PAUSES" -> "Excessive pauses or interruptions";
            default -> null;
        };
    }

    private String getSuggestedActionForMistake(String mistake) {
        if (mistake.contains("Shallow")) {
            return "Have trainees practice pushing deeper using real-time depth feedback.";
        } else if (mistake.contains("Too-deep")) {
            return "Advise trainees to compress slightly lighter to avoid going too deep.";
        } else if (mistake.contains("Slow")) {
            return "Use a metronome set to 110 cpm to help trainees speed up their compression rate.";
        } else if (mistake.contains("Fast")) {
            return "Use a metronome set to 110 cpm to help trainees slow down and pace themselves.";
        } else if (mistake.contains("recoil")) {
            return "Conduct a demonstration focusing on completely releasing the hand pressure off the manikin between compressions.";
        } else if (mistake.contains("consistency")) {
            return "Ensure trainees practice keeping a steady count and constant depth.";
        } else if (mistake.contains("Fatigue")) {
            return "Incorporate physical stamina reminders, such as using body weight instead of arm muscles.";
        } else if (mistake.contains("pauses")) {
            return "Remind trainees to limit pauses between cycles (e.g., during breaths or device checks) to under 10 seconds.";
        }
        return "Reinforce standard clinical CPR guidelines in the next class session.";
    }

    private CprInstructorCoachResponse handleSummarizeTrainee(CprInstructorCoachQueryRequest request) {
        String traineeId = request.traineeId();
        String sessionId = request.sessionId();

        CprSessionSummaryResponse targetSession = null;

        if (sessionId != null && !sessionId.isBlank()) {
            Optional<CprSessionSummaryResponse> sessionOpt = sessionRepository.findCprSessionById(sessionId.trim());
            if (sessionOpt.isPresent()) {
                targetSession = sessionOpt.get();
                traineeId = targetSession.traineeId();
            }
        }

        if (targetSession == null) {
            if (traineeId == null || traineeId.isBlank()) {
                return new CprInstructorCoachResponse(
                        "Please specify a trainee or session to get a summary.",
                        List.of(), List.of(), List.of(), List.of()
                );
            }
            CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(traineeId.trim(), null, null, null, null);
            List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(query);
            if (!sessions.isEmpty()) {
                targetSession = sessions.get(0);
            }
        }

        if (targetSession == null) {
            return new CprInstructorCoachResponse(
                    "No completed CPR sessions found for the selection.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        CprPerformanceAnalysis analysis = performanceAnalyzer.analyze(targetSession);

        String name = getTraineeDisplayName(traineeId);
        String answer = String.format("Summary of trainee **%s** (%s)'s last session:\n"
                + "- **Session ID**: %s\n"
                + "- **Completed At**: %s\n"
                + "- **Overall Score**: %d%%\n"
                + "- **Average Depth**: %.1f mm\n"
                + "- **Average Rate**: %.1f cpm\n"
                + "- **Recoil Error**: %.1f%%\n"
                + "- **Consistency**: %.1f%%\n"
                + "- **Feedback Summary**: %s",
                name, traineeId != null ? traineeId : "Anonymous", targetSession.id(), targetSession.endedAt().toString(),
                targetSession.overallScore(), targetSession.avgDepthMm(), targetSession.avgRateCpm(),
                targetSession.recoilErrorPercent(), targetSession.consistencyScore(), analysis.shortSummary());

        List<PriorityTrainee> priorityTrainees = new ArrayList<>();
        if (analysis.overallStatus() != CprPerformanceAnalysis.OverallStatus.GOOD) {
            String reason = String.join(", ", analysis.mainIssues());
            priorityTrainees.add(new PriorityTrainee(
                    traineeId, name, targetSession.overallScore(), reason, targetSession.id()
            ));
        }

        return new CprInstructorCoachResponse(
                answer,
                priorityTrainees,
                analysis.mainIssues(),
                analysis.recommendations(),
                List.of(targetSession.id())
        );
    }

    private CprInstructorCoachResponse handleCompareTrainee(CprInstructorCoachQueryRequest request) {
        String traineeId = request.traineeId();
        if (traineeId == null || traineeId.isBlank()) {
            return new CprInstructorCoachResponse(
                    "Please specify the trainee ID (traineeId) in the request to compare their recent sessions.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(traineeId.trim(), null, null, null, null);
        List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(query);

        if (sessions.isEmpty()) {
            return new CprInstructorCoachResponse(
                    "No completed CPR sessions found for trainee: " + traineeId,
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        if (sessions.size() < 2) {
            return new CprInstructorCoachResponse(
                    "Trainee " + getTraineeDisplayName(traineeId) + " has only completed 1 session. At least 2 sessions are required for comparison.",
                    List.of(), List.of(), List.of(), List.of(sessions.get(0).id())
            );
        }

        List<CprSessionSummaryResponse> chronological = sessions.stream()
                .sorted(Comparator.comparing(CprSessionSummaryResponse::startedAt))
                .toList();

        CprTrendAnalysis trend = trendAnalyzer.analyzeTrend(sessions);

        CprSessionSummaryResponse first = chronological.get(0);
        CprSessionSummaryResponse last = chronological.get(chronological.size() - 1);

        String name = getTraineeDisplayName(traineeId);
        int scoreDiff = last.overallScore() - first.overallScore();
        String directionStr = scoreDiff > 0 ? "improved" : (scoreDiff < 0 ? "declined" : "remained stable");

        StringBuilder answerBuilder = new StringBuilder();
        answerBuilder.append(String.format("Comparing **%s** (%s)'s training sessions (Total: %d sessions):\n", name, traineeId, sessions.size()));
        answerBuilder.append(String.format("- **Baseline Run (Session %s)**: Score %d%%, Avg Depth %.1f mm, Avg Rate %.1f cpm, Recoil Error %.1f%%\n",
                first.id(), first.overallScore(), first.avgDepthMm(), first.avgRateCpm(), first.recoilErrorPercent()));
        answerBuilder.append(String.format("- **Latest Run (Session %s)**: Score %d%%, Avg Depth %.1f mm, Avg Rate %.1f cpm, Recoil Error %.1f%%\n",
                last.id(), last.overallScore(), last.avgDepthMm(), last.avgRateCpm(), last.recoilErrorPercent()));
        answerBuilder.append(String.format("- **Trend**: Overall performance has %s by %d points. %s\n",
                directionStr, Math.abs(scoreDiff), trend.recommendationSummary()));

        List<String> suggestedActions = new ArrayList<>();
        if (trend.trendDirection() == TrendDirection.DECLINING) {
            suggestedActions.add("Schedule a one-on-one session to address declining trend in: " + String.join(", ", trend.weakestAreas()));
        } else if (trend.trendDirection() == TrendDirection.STABLE) {
            suggestedActions.add("Challenge the trainee to practice longer sessions or focus on refining: " + String.join(", ", trend.weakestAreas()));
        } else {
            suggestedActions.add("Encourage trainee to maintain their technique and congratulate them on their improvement!");
        }

        return new CprInstructorCoachResponse(
                answerBuilder.toString(),
                List.of(),
                trend.weakestAreas(),
                suggestedActions,
                List.of(first.id(), last.id())
        );
    }

    private CprInstructorCoachResponse handleFeedbackTrainee(CprInstructorCoachQueryRequest request) {
        String traineeId = request.traineeId();
        if (traineeId == null || traineeId.isBlank()) {
            return new CprInstructorCoachResponse(
                    "Please specify the trainee ID (traineeId) in the request to generate feedback suggestions.",
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(traineeId.trim(), null, null, null, null);
        List<CprSessionSummaryResponse> sessions = sessionRepository.findCprSessions(query);

        if (sessions.isEmpty()) {
            return new CprInstructorCoachResponse(
                    "No completed CPR sessions found for trainee: " + traineeId,
                    List.of(), List.of(), List.of(), List.of()
            );
        }

        CprSessionSummaryResponse lastSession = sessions.get(0);
        CprPerformanceAnalysis analysis = performanceAnalyzer.analyze(lastSession);
        String name = getTraineeDisplayName(traineeId);

        StringBuilder sb = new StringBuilder();
        sb.append(String.format("Suggested feedback for trainee **%s** (%s) based on their last session:\n\n", name, traineeId));

        if (analysis.overallStatus() == CprPerformanceAnalysis.OverallStatus.GOOD) {
            sb.append(String.format("\"Great job, %s! Your overall score was %d%%. ", name, lastSession.overallScore()));
            if (!analysis.strengths().isEmpty()) {
                sb.append(String.format("You did an excellent job with: %s. ", String.join(" and ", analysis.strengths()).toLowerCase()));
            }
            sb.append("Keep practicing to lock in this muscle memory!\"");
        } else {
            sb.append(String.format("\"Nice effort on this session, %s. You scored %d%%. ", name, lastSession.overallScore()));
            if (!analysis.strengths().isEmpty()) {
                sb.append(String.format("Your strengths were: %s. ", String.join(" and ", analysis.strengths()).toLowerCase()));
            }
            if (!analysis.mainIssues().isEmpty()) {
                sb.append("To improve further, try to focus on:\n");
                for (String issue : analysis.mainIssues()) {
                    sb.append(String.format("  - %s\n", issue));
                }
            }
            if (!analysis.recommendations().isEmpty()) {
                sb.append("\nSpecifically:\n");
                for (String rec : analysis.recommendations()) {
                    sb.append(String.format("  - %s\n", rec));
                }
            }
            sb.append("\"");
        }

        List<PriorityTrainee> priorityTrainees = new ArrayList<>();
        if (analysis.overallStatus() != CprPerformanceAnalysis.OverallStatus.GOOD) {
            priorityTrainees.add(new PriorityTrainee(
                    traineeId, name, lastSession.overallScore(), String.join(", ", analysis.mainIssues()), lastSession.id()
            ));
        }

        return new CprInstructorCoachResponse(
                sb.toString(),
                priorityTrainees,
                analysis.mainIssues(),
                analysis.recommendations(),
                List.of(lastSession.id())
        );
    }
}
