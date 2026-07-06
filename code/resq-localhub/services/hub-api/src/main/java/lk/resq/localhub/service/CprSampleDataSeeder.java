package lk.resq.localhub.service;

import java.time.Instant;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionSummary;

@Service
public class CprSampleDataSeeder {

    private final LocalSessionRepository sessionRepository;
    private final boolean enabled;

    @Autowired
    public CprSampleDataSeeder(
            LocalSessionRepository sessionRepository,
            @Value("${resq.sample-data.enabled:false}") boolean enabled
    ) {
        this.sessionRepository = sessionRepository;
        this.enabled = enabled;
    }

    @PostConstruct
    public void seed() {
        if (!enabled) {
            return;
        }

        // Check if database is empty of completed sessions
        lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest query = 
            new lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest(null, null, null, null, null);
        if (!sessionRepository.findCprSessions(query).isEmpty()) {
            return;
        }

        // 1. Good session
        saveSession("dev-trainee-1", "good-run", Instant.now().minusSeconds(86400), 95, 53.0, 95.0, 110.0, 95.0, 2.0, 92.0, 2.0, "Standard CPR", "Excellent work.");

        // 2. Shallow compression session
        saveSession("dev-trainee-1", "shallow-run", Instant.now().minusSeconds(86400 * 2), 60, 42.0, 25.0, 105.0, 90.0, 2.0, 80.0, 2.0, "Standard CPR", "Compressions are too shallow.");

        // 3. Too fast compression session
        saveSession("dev-trainee-1", "fast-run", Instant.now().minusSeconds(86400 * 3), 62, 52.0, 90.0, 135.0, 15.0, 2.0, 82.0, 2.0, "Standard CPR", "Compressing too fast.");

        // 4. High recoil error session
        saveSession("dev-trainee-1", "recoil-run", Instant.now().minusSeconds(86400 * 4), 58, 51.0, 90.0, 108.0, 90.0, 30.0, 80.0, 2.0, "Standard CPR", "Incomplete recoil.");

        // 5. Fatigue session
        saveSession("dev-trainee-1", "fatigue-run", Instant.now().minusSeconds(86400 * 5), 65, 49.0, 80.0, 105.0, 80.0, 5.0, 78.0, 18.0, "Standard CPR", "Stamina drop at the end.");

        // 6. Poor consistency session
        saveSession("dev-trainee-1", "inconsistent-run", Instant.now().minusSeconds(86400 * 6), 55, 48.0, 50.0, 112.0, 50.0, 8.0, 45.0, 4.0, "Standard CPR", "Rhythm and depth are very inconsistent.");

        // 7. Improving trend over 3 weeks
        saveSession("dev-trainee-improving", "improving-w3", Instant.now().minusSeconds(86400 * 21), 55, 45.0, 40.0, 92.0, 40.0, 18.0, 50.0, 12.0, "Standard CPR", "Need to speed up and push deeper.");
        saveSession("dev-trainee-improving", "improving-w2", Instant.now().minusSeconds(86400 * 14), 68, 48.0, 65.0, 98.0, 68.0, 12.0, 68.0, 8.0, "Standard CPR", "Better rate control.");
        saveSession("dev-trainee-improving", "improving-w1", Instant.now().minusSeconds(86400 * 7), 80, 51.0, 82.0, 106.0, 85.0, 6.0, 78.0, 4.0, "Standard CPR", "Excellent consistency.");
        saveSession("dev-trainee-improving", "improving-today", Instant.now().minusSeconds(3600), 92, 53.0, 92.0, 112.0, 94.0, 2.0, 88.0, 2.0, "Standard CPR", "Great job, targets met!");

        // 8. Declining trend over 3 weeks
        saveSession("dev-trainee-declining", "declining-w3", Instant.now().minusSeconds(86400 * 21), 92, 53.0, 92.0, 112.0, 94.0, 2.0, 88.0, 2.0, "Standard CPR", "Perfect clinical execution.");
        saveSession("dev-trainee-declining", "declining-w2", Instant.now().minusSeconds(86400 * 14), 80, 51.0, 82.0, 106.0, 85.0, 6.0, 78.0, 4.0, "Standard CPR", "Slight fatigue drop.");
        saveSession("dev-trainee-declining", "declining-w1", Instant.now().minusSeconds(86400 * 7), 68, 48.0, 65.0, 98.0, 68.0, 12.0, 68.0, 8.0, "Standard CPR", "Chest release is incomplete.");
        saveSession("dev-trainee-declining", "declining-today", Instant.now().minusSeconds(3600), 55, 45.0, 40.0, 92.0, 40.0, 18.0, 50.0, 12.0, "Standard CPR", "Overall score has declined significantly.");
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
        SessionSummary summary = new SessionSummary(
                sessionId,
                "M01",
                traineeId,
                time,
                time.plusSeconds(60),
                60L,
                100,
                100,
                (int) (100 * (depthAcc / 100.0)),
                depth,
                1.0,
                rate,
                100.0 - recoilError,
                (int) (100 * ((100.0 - recoilError) / 100.0)),
                (int) (100 * (recoilError / 100.0)),
                0,
                score,
                "FLAGS",
                depth - 5.0,
                depth + 5.0,
                depthAcc,
                rateAcc,
                recoilError,
                0.0,
                consistency,
                fatigueDrop
        );

        SessionEndResponse response = new SessionEndResponse(
                sessionId,
                "M01",
                traineeId,
                time,
                true,
                time.plusSeconds(60),
                scenario,
                notes,
                summary,
                "course-101",
                "instructor-1"
        );

        sessionRepository.save(response);
    }
}
