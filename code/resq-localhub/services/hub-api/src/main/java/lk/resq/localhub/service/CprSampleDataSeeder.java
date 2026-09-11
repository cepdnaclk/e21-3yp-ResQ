package lk.resq.localhub.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

// This seed data is only for testing without real hardware and must not be used in production.
@Service
@Profile({"dev", "test"})
public class CprSampleDataSeeder {

    private final CprAiSessionRepository cprAiSessionRepository;
    private final boolean enabled;

    @Autowired
    public CprSampleDataSeeder(
            CprAiSessionRepository cprAiSessionRepository,
            @Value("${resq.sample-data.enabled:false}") boolean enabled
    ) {
        this.cprAiSessionRepository = cprAiSessionRepository;
        this.enabled = enabled;
    }

    @PostConstruct
    public List<String> seed() {
        // This seed data is only for testing without real hardware and must not be used in production.
        List<String> seededIds = new ArrayList<>();
        if (!enabled) {
            return seededIds;
        }

        // Check if database already has synthetic seeded sessions
        CprSessionSummaryQueryRequest query = new CprSessionSummaryQueryRequest(null, null, null, null, null);
        List<CprSessionSummaryResponse> existing = cprAiSessionRepository.findCprSessions(query);
        if (existing.stream().anyMatch(s -> "DEV_SEED".equals(s.dataSource()))) {
            existing.stream()
                    .filter(s -> "DEV_SEED".equals(s.dataSource()))
                    .forEach(s -> seededIds.add(s.id()));
            return seededIds;
        }

        // 1. Good session
        saveSession("dev-trainee-1", "good-run", Instant.now().minusSeconds(86400), 95, 53.0, 95.0, 110.0, 95.0, 2.0, 92.0, 2.0, "Standard CPR", "Excellent work.");
        seededIds.add("good-run");

        // 2. Shallow compression session
        saveSession("dev-trainee-1", "shallow-run", Instant.now().minusSeconds(86400 * 2), 60, 42.0, 25.0, 105.0, 90.0, 2.0, 80.0, 2.0, "Standard CPR", "Compressions are too shallow.");
        seededIds.add("shallow-run");

        // 3. Too fast compression session
        saveSession("dev-trainee-1", "fast-run", Instant.now().minusSeconds(86400 * 3), 62, 52.0, 90.0, 135.0, 15.0, 2.0, 82.0, 2.0, "Standard CPR", "Compressing too fast.");
        seededIds.add("fast-run");

        // 4. High recoil error session
        saveSession("dev-trainee-1", "recoil-run", Instant.now().minusSeconds(86400 * 4), 58, 51.0, 90.0, 108.0, 90.0, 30.0, 80.0, 2.0, "Standard CPR", "Incomplete recoil.");
        seededIds.add("recoil-run");

        // 5. Fatigue session
        saveSession("dev-trainee-1", "fatigue-run", Instant.now().minusSeconds(86400 * 5), 65, 49.0, 80.0, 105.0, 80.0, 5.0, 78.0, 18.0, "Standard CPR", "Stamina drop at the end.");
        seededIds.add("fatigue-run");

        // 6. Poor consistency session
        saveSession("dev-trainee-1", "inconsistent-run", Instant.now().minusSeconds(86400 * 6), 55, 48.0, 50.0, 112.0, 50.0, 8.0, 45.0, 4.0, "Standard CPR", "Rhythm and depth are very inconsistent.");
        seededIds.add("inconsistent-run");

        // 7. Improving trend over 3 weeks
        saveSession("dev-trainee-improving", "improving-w3", Instant.now().minusSeconds(86400 * 21), 55, 45.0, 40.0, 92.0, 40.0, 18.0, 50.0, 12.0, "Standard CPR", "Need to speed up and push deeper.");
        seededIds.add("improving-w3");
        saveSession("dev-trainee-improving", "improving-w2", Instant.now().minusSeconds(86400 * 14), 68, 48.0, 65.0, 98.0, 68.0, 12.0, 68.0, 8.0, "Standard CPR", "Better rate control.");
        seededIds.add("improving-w2");
        saveSession("dev-trainee-improving", "improving-w1", Instant.now().minusSeconds(86400 * 7), 80, 51.0, 82.0, 106.0, 85.0, 6.0, 78.0, 4.0, "Standard CPR", "Excellent consistency.");
        seededIds.add("improving-w1");
        saveSession("dev-trainee-improving", "improving-today", Instant.now().minusSeconds(3600), 92, 53.0, 92.0, 112.0, 94.0, 2.0, 88.0, 2.0, "Standard CPR", "Great job, targets met!");
        seededIds.add("improving-today");

        // 8. Declining trend over 3 weeks
        saveSession("dev-trainee-declining", "declining-w3", Instant.now().minusSeconds(86400 * 21), 92, 53.0, 92.0, 112.0, 94.0, 2.0, 88.0, 2.0, "Standard CPR", "Perfect clinical execution.");
        seededIds.add("declining-w3");
        saveSession("dev-trainee-declining", "declining-w2", Instant.now().minusSeconds(86400 * 14), 80, 51.0, 82.0, 106.0, 85.0, 6.0, 78.0, 4.0, "Standard CPR", "Slight fatigue drop.");
        seededIds.add("declining-w2");
        saveSession("dev-trainee-declining", "declining-w1", Instant.now().minusSeconds(86400 * 7), 68, 48.0, 65.0, 98.0, 68.0, 12.0, 68.0, 8.0, "Standard CPR", "Chest release is incomplete.");
        seededIds.add("declining-w1");
        saveSession("dev-trainee-declining", "declining-today", Instant.now().minusSeconds(3600), 55, 45.0, 40.0, 92.0, 40.0, 18.0, 50.0, 12.0, "Standard CPR", "Overall score has declined significantly.");
        seededIds.add("declining-today");

        System.out.println("CprSampleDataSeeder: Seeded session IDs: " + seededIds);
        return seededIds;
    }

    private void saveSession(
            String traineeId,
            String sessionId,
            Instant time,
            int score,
            double depth,
            double depthAcc,
            double rate,
            double rateAcc,
            double recoilError,
            double consistency,
            double fatigueDrop,
            String scenario,
            String notes
    ) {
        CprSessionSummaryResponse summary = new CprSessionSummaryResponse(
                sessionId,
                traineeId,
                traineeId,
                "M01",
                time,
                time.plusSeconds(60),
                60L,
                depth,
                Math.max(0.0, depth - 5.0),
                depth + 5.0,
                depthAcc,
                rate,
                rateAcc,
                recoilError,
                0,
                0.0,
                consistency,
                fatigueDrop,
                score,
                time,
                "DEV_SEED"
        );

        cprAiSessionRepository.saveCprSession(summary);
    }
}
