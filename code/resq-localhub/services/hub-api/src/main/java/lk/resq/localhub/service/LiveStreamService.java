package lk.resq.localhub.service;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionLiveView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
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

@Service
public class LiveStreamService {

    private static final Logger logger = LoggerFactory.getLogger(LiveStreamService.class);
    private static final long SSE_TIMEOUT_MS = 0L;

    private final CopyOnWriteArrayList<SseEmitter> instructorEmitters = new CopyOnWriteArrayList<>();
    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> sessionEmittersBySessionId = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();

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
        for (SseEmitter emitter : instructorEmitters) {
            sendEvent(emitter, "manikins-live", payload, () -> instructorEmitters.remove(emitter));
        }
    }

    public void publishSessionLive(String sessionId, SessionLiveView payload) {
        CopyOnWriteArrayList<SseEmitter> emitters = sessionEmittersBySessionId.get(sessionId);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }

        for (SseEmitter emitter : emitters) {
            sendEvent(emitter, "session-live", payload, () -> removeSessionEmitter(sessionId, emitter));
        }
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

    private void sendEvent(SseEmitter emitter, String eventName, Object payload, Runnable onFailure) {
        try {
            emitter.send(SseEmitter.event().name(eventName).data(payload));
        } catch (IOException | IllegalStateException error) {
            onFailure.run();
            emitter.complete();
            logger.debug("Removed disconnected SSE emitter while sending {} event", eventName, error);
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
        }
    }
}
