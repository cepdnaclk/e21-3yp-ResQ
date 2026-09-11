package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import lk.resq.localhub.model.ManikinLiveSummary;

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
    void reconnectGetsOneInitialSnapshotAndFailedEmitterIsRemoved() throws Exception {
        CapturingLiveStreamService service = new CapturingLiveStreamService();

        service.subscribeInstructor(List.of());
        assertThat(service.events).containsExactly("manikins-live");
        assertThat(service.instructorEmitterCount()).isEqualTo(1);

        service.publishInstructorLive(List.of());
        assertThat(service.awaitFanoutIdle(1_000)).isTrue();
        service.lastFailure.run();
        assertThat(service.instructorEmitterCount()).isZero();

        service.events.clear();
        service.subscribeInstructor(List.of());
        assertThat(service.events).containsExactly("manikins-live");
        assertThat(service.instructorEmitterCount()).isEqualTo(1);
    }

    @Test
    void slowFanoutQueueIsBoundedAndCoalescesOldestWork() throws Exception {
        SlowLiveStreamService service = new SlowLiveStreamService();
        service.subscribeInstructor(List.of());

        for (int index = 0; index < 250; index++) {
            service.publishInstructorLive(List.of(org.mockito.Mockito.mock(ManikinLiveSummary.class)));
        }

        assertThat(service.queuedFanoutTaskCount()).isLessThanOrEqualTo(LiveStreamService.FANOUT_QUEUE_CAPACITY);
        assertThat(service.droppedFanoutTaskCount()).isGreaterThan(0);
        service.stopHeartbeat();
    }

    @Test
    void terminalSessionEventBypassesDisposableFanoutQueue() {
        CapturingLiveStreamService service = new CapturingLiveStreamService();
        service.subscribeSession("session-1", null);
        service.events.clear();
        service.payloads.clear();

        service.publishSessionLive("session-1", null);

        assertThat(service.events).containsExactly("session-live");
        assertThat(service.payloads).containsExactly((Object) null);

        service.publishSessionLive("session-1", null);
        assertThat(service.events).containsExactly("session-live");
        service.stopHeartbeat();
    }

    private static final class CapturingLiveStreamService extends LiveStreamService {
        private final List<String> events = new ArrayList<>();
        private final List<Object> payloads = new ArrayList<>();
        private Runnable lastFailure = () -> {
        };

        @Override
        protected void sendEvent(SseEmitter emitter, String eventName, Object payload, Runnable onFailure) {
            events.add(eventName);
            payloads.add(payload);
            lastFailure = onFailure;
        }
    }

    private static final class SlowLiveStreamService extends LiveStreamService {
        private final AtomicInteger sends = new AtomicInteger();

        @Override
        protected void sendEvent(SseEmitter emitter, String eventName, Object payload, Runnable onFailure) {
            sends.incrementAndGet();
            try {
                Thread.sleep(20);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
