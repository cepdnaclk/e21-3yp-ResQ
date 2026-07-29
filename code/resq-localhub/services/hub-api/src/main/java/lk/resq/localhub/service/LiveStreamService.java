package lk.resq.localhub.service;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionLiveView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class LiveStreamService {

    private static final Logger logger = LoggerFactory.getLogger(LiveStreamService.class);
    private static final long SSE_TIMEOUT_MS = 0L;

    private final CopyOnWriteArrayList<SseEmitter> instructorEmitters = new CopyOnWriteArrayList<>();
    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> sessionEmittersBySessionId = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();
    private volatile List<ManikinLiveSummary> lastInstructorPayload;
    private final ConcurrentHashMap<String, SessionLiveView> lastSessionPayloadBySessionId = new ConcurrentHashMap<>();
    private final AtomicLong suppressedDuplicateUpdateCount = new AtomicLong();

    @PostConstruct
    public void startHeartbeat() {
        heartbeatExecutor.scheduleWithFixedDelay(this::sendHeartbeats, 15, 15, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void stopHeartbeat() {
        heartbeatExecutor.shutdownNow();
    }

    public SseEmitter subscribeInstructor(List<ManikinLiveSummary> initialPayload) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        instructorEmitters.add(emitter);
        attachCleanup(emitter, () -> instructorEmitters.remove(emitter));

        sendEvent(emitter, "manikins-live", initialPayload, () -> instructorEmitters.remove(emitter));
        return emitter;
    }

    public SseEmitter subscribeSession(String sessionId, SessionLiveView initialPayload) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        CopyOnWriteArrayList<SseEmitter> emitters = sessionEmittersBySessionId.computeIfAbsent(sessionId, key -> new CopyOnWriteArrayList<>());
        emitters.add(emitter);
        attachCleanup(emitter, () -> removeSessionEmitter(sessionId, emitter));

        sendEvent(emitter, "session-live", initialPayload, () -> removeSessionEmitter(sessionId, emitter));
        return emitter;
    }

    public void publishInstructorLive(List<ManikinLiveSummary> payload) {
        List<ManikinLiveSummary> boundedPayload = payload == null ? List.of() : List.copyOf(payload);
        if (boundedPayload.equals(lastInstructorPayload)) {
            suppressedDuplicateUpdateCount.incrementAndGet();
            return;
        }
        lastInstructorPayload = boundedPayload;
        for (SseEmitter emitter : instructorEmitters) {
            sendEvent(emitter, "manikins-live", boundedPayload, () -> instructorEmitters.remove(emitter));
        }
    }

    public void publishSessionLive(String sessionId, SessionLiveView payload) {
        if (payload == null) {
            lastSessionPayloadBySessionId.remove(sessionId);
            CopyOnWriteArrayList<SseEmitter> terminalEmitters =
                    sessionEmittersBySessionId.remove(sessionId);
            if (terminalEmitters == null || terminalEmitters.isEmpty()) {
                return;
            }
            List<SseEmitter> terminalSnapshot = List.copyOf(terminalEmitters);
            /*
             * Clear the shared list before sending so no older live publisher
             * can deliver a stale update after the terminal marker.
             */
            terminalEmitters.clear();
            /*
             * Completion is a control-plane event, not disposable live
             * telemetry. Send it immediately so the event that closes the UI
             * and reveals the score cannot be dropped.
             */
            for (SseEmitter emitter : terminalSnapshot) {
                sendEvent(emitter, "session-live", null,
                        () -> { });
            }
            return;
        }
        if (payload != null && payload.equals(lastSessionPayloadBySessionId.put(sessionId, payload))) {
            suppressedDuplicateUpdateCount.incrementAndGet();
            return;
        }
        CopyOnWriteArrayList<SseEmitter> emitters = sessionEmittersBySessionId.get(sessionId);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }

        for (SseEmitter emitter : emitters) {
            sendEvent(emitter, "session-live", payload, () -> removeSessionEmitter(sessionId, emitter));
        }
    }

    long suppressedDuplicateUpdateCount() {
        return suppressedDuplicateUpdateCount.get();
    }

    int instructorEmitterCount() {
        return instructorEmitters.size();
    }

    private void sendHeartbeats() {
        Map<String, String> heartbeatPayload = Map.of("ts", Instant.now().toString());

        for (SseEmitter emitter : instructorEmitters) {
            sendEvent(emitter, "heartbeat", heartbeatPayload, () -> instructorEmitters.remove(emitter));
        }

        for (Map.Entry<String, CopyOnWriteArrayList<SseEmitter>> entry : sessionEmittersBySessionId.entrySet()) {
            String sessionId = entry.getKey();
            for (SseEmitter emitter : entry.getValue()) {
                sendEvent(emitter, "heartbeat", heartbeatPayload, () -> removeSessionEmitter(sessionId, emitter));
            }
        }
    }

    private void attachCleanup(SseEmitter emitter, Runnable cleanup) {
        emitter.onCompletion(cleanup);
        emitter.onTimeout(() -> {
            cleanup.run();
            emitter.complete();
        });
        emitter.onError(error -> cleanup.run());
    }

    protected void sendEvent(SseEmitter emitter, String eventName, Object payload, Runnable onFailure) {
        try {
            Object safePayload = (payload != null) ? payload : Map.of();
            emitter.send(SseEmitter.event().name(eventName).data(safePayload, MediaType.APPLICATION_JSON));
        } catch (IOException | RuntimeException error) {
            onFailure.run();
            completeQuietly(emitter);
            logger.debug("Removed disconnected SSE emitter while sending {} event", eventName, error);
        }
    }

    private void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (RuntimeException error) {
            logger.debug("Ignoring SSE emitter completion failure after send error", error);
        }
    }

    private void removeSessionEmitter(String sessionId, SseEmitter emitter) {
        CopyOnWriteArrayList<SseEmitter> emitters = sessionEmittersBySessionId.get(sessionId);
        if (emitters == null) {
            return;
        }

        emitters.remove(emitter);
        if (emitters.isEmpty()) {
            sessionEmittersBySessionId.remove(sessionId, emitters);
            lastSessionPayloadBySessionId.remove(sessionId);
        }
    }
}
