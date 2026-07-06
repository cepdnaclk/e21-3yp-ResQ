package lk.resq.localhub.controller;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.cpr.CprSessionSummaryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;
import lk.resq.localhub.service.CprSessionService;
import lk.resq.localhub.service.LocalSessionRepository;

class CprSessionControllerTest {

    @Test
    void saveListAndGetCprSessions() {
        Fixture fixture = newFixture();
        Instant startedAt = Instant.parse("2026-06-08T08:00:00Z");
        Instant endedAt = Instant.parse("2026-06-08T08:01:00Z");

        CprSessionSummaryRequest request = new CprSessionSummaryRequest(
                "session-1",
                "user-1",
                null,
                "manikin-1",
                startedAt,
                endedAt,
                60,
                52.0,
                48.0,
                56.0,
                80.0,
                110.0,
                90.0,
                5.0,
                1,
                2.5,
                87.0,
                6.0,
                94
        );

        var saveResponse = fixture.controller.saveSession(request);
        assertThat(saveResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        CprSessionSummaryResponse saved = requireBody(saveResponse.getBody());
        assertThat(saved.id()).isEqualTo("session-1");
        assertThat(saved.createdAt()).isNotNull();

        var listResponse = fixture.controller.listSessions("user-1", null,
                saved.createdAt().minusSeconds(1).toString(), saved.createdAt().plusSeconds(1).toString(), "manikin-1");
        assertThat(listResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<CprSessionSummaryResponse> sessions = requireBody(listResponse.getBody());
        assertThat(sessions).hasSize(1);

        var getResponse = fixture.controller.getSession("session-1");
        assertThat(getResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        CprSessionSummaryResponse fetched = requireBody(getResponse.getBody());
        assertThat(fetched.manikinId()).isEqualTo("manikin-1");
        assertThat(fetched.overallScore()).isEqualTo(94);
    }

    @Test
    void saveSessionRejectsInvalidValues() {
        Fixture fixture = newFixture();
        var response = fixture.controller.saveSession(new CprSessionSummaryRequest(
                "session-bad",
                null,
                null,
                "manikin-1",
                Instant.parse("2026-06-08T08:00:00Z"),
                Instant.parse("2026-06-08T07:59:59Z"),
                0,
                52.0,
                48.0,
                56.0,
                80.0,
                110.0,
                90.0,
                5.0,
                1,
                2.5,
                87.0,
                6.0,
                94
        ));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse error = requireBody(response.getBody());
        assertThat(error.error()).contains("userId or traineeId is required");
    }

    @SuppressWarnings("unchecked")
    private static <T> T requireBody(Object body) {
        return (T) body;
    }

    private static Fixture newFixture() {
        LocalSessionRepository repository = new LocalSessionRepository(
                Path.of("target", "cpr-session-controller-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        CprSessionService service = new CprSessionService(repository);
        return new Fixture(new CprSessionController(service));
    }

    private record Fixture(CprSessionController controller) {
    }
}