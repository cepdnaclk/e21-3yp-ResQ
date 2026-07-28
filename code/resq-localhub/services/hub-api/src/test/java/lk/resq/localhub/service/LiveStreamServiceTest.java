package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class LiveStreamServiceTest {
    @Test
    void suppressesDuplicateUnchangedInstructorUpdates() {
        LiveStreamService service = new LiveStreamService();

        service.publishInstructorLive(List.of());
        service.publishInstructorLive(List.of());

        assertThat(service.suppressedDuplicateUpdateCount()).isEqualTo(1);
    }

    @Test
    void reconnectGetsOneInitialSnapshotAndFailedEmitterIsRemoved() {
        CapturingLiveStreamService service = new CapturingLiveStreamService();

        service.subscribeInstructor(List.of());
        assertThat(service.events).containsExactly("manikins-live");
        assertThat(service.instructorEmitterCount()).isEqualTo(1);

        service.publishInstructorLive(List.of());
        service.lastFailure.run();
        assertThat(service.instructorEmitterCount()).isZero();

        service.events.clear();
        service.subscribeInstructor(List.of());
        assertThat(service.events).containsExactly("manikins-live");
        assertThat(service.instructorEmitterCount()).isEqualTo(1);
    }

    private static final class CapturingLiveStreamService extends LiveStreamService {
        private final List<String> events = new ArrayList<>();
        private Runnable lastFailure = () -> {
        };

        @Override
        protected void sendEvent(SseEmitter emitter, String eventName, Object payload, Runnable onFailure) {
            events.add(eventName);
            lastFailure = onFailure;
        }
    }
}
