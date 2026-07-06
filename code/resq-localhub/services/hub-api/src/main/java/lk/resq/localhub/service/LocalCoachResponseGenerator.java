package lk.resq.localhub.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Service;

import lk.resq.localhub.model.cpr.CprBadPerformanceSession;
import lk.resq.localhub.model.cpr.CprPerformanceAnalysis;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.model.cpr.CprTrendAnalysis;
import lk.resq.localhub.model.cpr.LocalCoachRequest;
import lk.resq.localhub.model.cpr.LocalCoachResponse;

@Service
public class LocalCoachResponseGenerator {

    public LocalCoachResponse generateResponse(LocalCoachRequest request) {
        if (request == null || request.question() == null) {
            return new LocalCoachResponse(
                    "Please provide a valid question for the CPR training feedback.",
                    List.of(),
                    List.of(),
                    List.of()
            );
        }

        String query = request.question().toLowerCase().trim();
        if (isUnsupportedMedicalOrEmergencyQuery(query)) {
            return new LocalCoachResponse(
                    "ResQ Coach can only provide CPR training feedback based on your recorded practice sessions.",
                    List.of(),
                    List.of("Perform a standard adult CPR practice set to gather training data."),
                    List.of()
            );
        }

        LocalCoachResponse raw = generateResponseRaw(request);
        return filterResponse(request, raw);
    }

    private LocalCoachResponse generateResponseRaw(LocalCoachRequest request) {
        String query = request.question().toLowerCase().trim();

        if (query.contains("bad") && query.contains("performance")) {
            return handleListBadPerformances(request);
        } else if (query.contains("mistake") || query.contains("repeat")) {
            return handleRepeatedMistakes(request);
        } else if (query.contains("improving") || query.contains("improve") || query.contains("trend") || query.contains("progress")) {
            return handleAmIImproving(request);
        } else if (query.contains("practice") || query.contains("next") || query.contains("should i do") || query.contains("recommend")) {
            return handleWhatToPracticeNext(request);
        } else if (query.contains("compare") || (query.contains("last") && query.contains("best"))) {
            return handleSessionComparison(request);
        }

        // Default fallback response
        return new LocalCoachResponse(
                "I can help you review your CPR training history and technique. Supported questions include:\n"
                + "1. 'List my bad performances in the last 3 weeks'\n"
                + "2. 'What mistakes do I repeat most?'\n"
                + "3. 'Am I improving?'\n"
                + "4. 'What should I practice next?'\n"
                + "5. 'Compare my last session with my best session'",
                List.of(),
                List.of(),
                List.of()
        );
    }

    private LocalCoachResponse filterResponse(LocalCoachRequest request, LocalCoachResponse rawResponse) {
        String answer = rawResponse.answer();
        if (answer != null && !answer.contains("training session data") && !answer.contains("training history") && !answer.contains("practices") && !answer.contains("review your CPR") && !answer.contains("recorded practice sessions")) {
            answer = "Based on your training session data: " + answer;
        }

        return new LocalCoachResponse(
                answer,
                rawResponse.mainIssues(),
                rawResponse.recommendations(),
                rawResponse.relatedSessions()
        );
    }

    private boolean isUnsupportedMedicalOrEmergencyQuery(String query) {
        // Emergency keywords
        if (query.contains("emergency") || query.contains("stroke") || query.contains("heart attack") || query.contains("cardiac arrest") || query.contains("choking") || query.contains("911") || query.contains("ambulance")) {
            return true;
        }
        // Diagnosis/clinical keywords
        if (query.contains("diagnose") || query.contains("disease") || query.contains("chest pain") || query.contains("medicine") || query.contains("doctor")) {
            return true;
        }
        // Unrelated certification medical assessments
        if (query.contains("certification") || query.contains("official") || query.contains("cpr certificate") || query.contains("acls") || query.contains("bls")) {
            return true;
        }
        // Animals / pets (e.g. cat/dog)
        if (query.contains("cat") || query.contains("dog") || query.contains("animal") || query.contains("pet")) {
            return true;
        }
        return false;
    }

    private LocalCoachResponse handleListBadPerformances(LocalCoachRequest request) {
        List<CprBadPerformanceSession> bad = request.badSessions();
        if (bad == null || bad.isEmpty()) {
            return new LocalCoachResponse(
                    "You have no bad performance sessions recorded in the last 3 weeks. Great job keeping your CPR technique consistent!",
                    List.of(),
                    List.of("Continue practicing to reinforce correct chest recoil and compression rate."),
                    List.of()
            );
        }

        Set<String> failedMetrics = new LinkedHashSet<>();
        List<String> recommendations = new ArrayList<>();
        List<String> related = new ArrayList<>();

        for (CprBadPerformanceSession session : bad) {
            failedMetrics.addAll(session.failedMetrics());
            if (session.recommendation() != null && !session.recommendation().isBlank()) {
                recommendations.add(session.recommendation());
            }
            related.add(session.sessionId() + " (" + session.sessionDateTime() + ")");
        }

        String answer = "In the last 3 weeks, you had " + bad.size() + " session(s) marked with sub-optimal performance. Focus on keeping your rhythm and chest release consistent.";

        return new LocalCoachResponse(
                answer,
                List.copyOf(failedMetrics),
                List.copyOf(recommendations),
                related
        );
    }

    private LocalCoachResponse handleRepeatedMistakes(LocalCoachRequest request) {
        CprTrendAnalysis trend = request.trendAnalysis();
        if (trend == null || trend.trendDirection() == CprTrendAnalysis.TrendDirection.NOT_ENOUGH_DATA || trend.repeatedMistakes().isEmpty()) {
            return new LocalCoachResponse(
                    "No repeated mistakes identified yet. Continue practicing to gather more training session history.",
                    List.of(),
                    List.of("Perform a standard adult CPR practice set to gather baseline consistency metrics."),
                    List.of()
            );
        }

        List<String> mistakes = trend.repeatedMistakes();
        List<String> recs = new ArrayList<>();
        for (String mistake : mistakes) {
            recs.add(mapMistakeToRecommendation(mistake));
        }

        String answer = "Based on your training history, you frequently experience: " + String.join(", ", mistakes) + ".";

        return new LocalCoachResponse(
                answer,
                mistakes,
                List.copyOf(recs),
                List.of()
        );
    }

    private LocalCoachResponse handleAmIImproving(LocalCoachRequest request) {
        CprTrendAnalysis trend = request.trendAnalysis();
        if (trend == null || trend.trendDirection() == CprTrendAnalysis.TrendDirection.NOT_ENOUGH_DATA) {
            return new LocalCoachResponse(
                    "There is not enough training data yet to analyze your improvement trend. Please complete at least 2 sessions.",
                    List.of(),
                    List.of("Complete another CPR training session so we can compare recent results against your baseline."),
                    List.of()
            );
        }

        String answer;
        if (trend.trendDirection() == CprTrendAnalysis.TrendDirection.IMPROVING) {
            answer = "Yes! Your overall CPR score shows a positive trend, improving from your earlier sessions. Areas of improvement: " + String.join(", ", trend.improvedAreas()) + ".";
        } else if (trend.trendDirection() == CprTrendAnalysis.TrendDirection.DECLINING) {
            answer = "No, your overall CPR score shows a declining trend. Take time to focus on your technique, particularly: " + String.join(", ", trend.weakestAreas()) + ".";
        } else {
            answer = "Your CPR performance is stable. To push your score higher, work on: " + String.join(", ", trend.weakestAreas()) + ".";
        }

        List<String> recs = new ArrayList<>();
        for (String weak : trend.weakestAreas()) {
            recs.add("Work on improving: " + weak);
        }

        return new LocalCoachResponse(
                answer,
                trend.weakestAreas(),
                List.copyOf(recs),
                List.of()
        );
    }

    private LocalCoachResponse handleWhatToPracticeNext(LocalCoachRequest request) {
        CprPerformanceAnalysis analysis = request.lastSessionAnalysis();
        if (analysis == null) {
            CprTrendAnalysis trend = request.trendAnalysis();
            if (trend != null && !trend.weakestAreas().isEmpty()) {
                String weak = trend.weakestAreas().get(0);
                return new LocalCoachResponse(
                        "You should practice " + weak.toLowerCase() + " next to address consistent weaknesses in your trend history.",
                        trend.weakestAreas(),
                        List.of("Focus specifically on " + weak.toLowerCase() + " targets during your next 2 practice runs."),
                        List.of()
                );
            }
            return new LocalCoachResponse(
                    "Keep practicing general CPR to build muscle memory. Start a new session on your manikin device.",
                    List.of(),
                    List.of("Perform a standard adult CPR practice set."),
                    List.of()
            );
        }

        if (analysis.overallStatus() == CprPerformanceAnalysis.OverallStatus.GOOD) {
            return new LocalCoachResponse(
                    "Your last session was excellent! Next, you should practice maintaining this consistency under different scenarios, or try a longer duration set.",
                    List.of(),
                    List.of("Try a longer 2-minute CPR set to practice stamina.", "Maintain complete chest recoil during transitions."),
                    List.of()
            );
        }

        String answer = "Based on your last session, you need to focus on: " + String.join(", ", analysis.mainIssues()) + ".";

        return new LocalCoachResponse(
                answer,
                analysis.mainIssues(),
                analysis.recommendations(),
                List.of(analysis.shortSummary())
        );
    }

    private LocalCoachResponse handleSessionComparison(LocalCoachRequest request) {
        CprSessionSummaryResponse last = request.lastSession();
        CprSessionSummaryResponse best = request.bestSession();

        if (last == null || best == null) {
            return new LocalCoachResponse(
                    "Unable to perform comparison. Make sure you have completed sessions recorded in your history.",
                    List.of(),
                    List.of("Complete at least 2 sessions to compare your performance relative to your best run."),
                    List.of()
            );
        }

        double scoreDiff = last.overallScore() - best.overallScore();
        String comparison;
        if (scoreDiff >= 0) {
            comparison = "Your last session is your best session yet, with a score of " + last.overallScore() + "%!";
        } else {
            comparison = "Your last session scored " + last.overallScore() + "%, which is " + Math.abs((int) scoreDiff) + "% points lower than your best session of " + best.overallScore() + "%.";
        }

        String answer = comparison + " Last session avg depth: " + last.avgDepthMm() + " mm (Best: " + best.avgDepthMm() + " mm). Last session avg rate: " + last.avgRateCpm() + " cpm (Best: " + best.avgRateCpm() + " cpm).";

        return new LocalCoachResponse(
                answer,
                List.of(),
                List.of("Analyze the metrics of your best session to understand what to replicate in future training."),
                List.of("Last Session: " + last.id(), "Best Session: " + best.id())
        );
    }

    private static String mapMistakeToRecommendation(String mistake) {
        return switch (mistake) {
            case "Consistently shallow compressions" -> "Practice compressing deeper until you hit the target 50-60mm range.";
            case "Consistently too-deep compressions" -> "Reduce compression depth slightly to avoid excessive depth.";
            case "Slow compression rate rhythm" -> "Speed up compressions slightly to bring your rate into target 100-120 cpm cadence.";
            case "Fast compression rate rhythm" -> "Slow down compressions slightly to keep within target 100-120 cpm cadence.";
            case "Incomplete chest recoil (not fully releasing chest)" -> "Ensure you completely release the chest at the top of each compression.";
            case "Inconsistent depth or rate" -> "Focus on a steadier count or metronome to maintain consistency.";
            case "Fatigue signs in later stages of training" -> "Take rest pauses and focus on body posturing to improve stamina.";
            case "Frequent or long pauses during compressions" -> "Keep pause transitions between compression cycles under 2.5 seconds.";
            default -> "Keep practicing to reinforce standard clinical target guidelines.";
        };
    }
}
