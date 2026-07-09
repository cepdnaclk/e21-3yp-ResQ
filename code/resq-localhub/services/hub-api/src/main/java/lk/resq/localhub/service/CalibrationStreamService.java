package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationMqttEvent;
import lk.resq.localhub.model.firmware.CalibrationState;
import lk.resq.localhub.model.firmware.CalibrationStreamEvent;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Service
public class CalibrationStreamService {

    private static final Logger logger = LoggerFactory.getLogger(CalibrationStreamService.class);
    private static final long SSE_TIMEOUT_MS = 0L;

    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> emittersByDeviceId = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();

    private final DeviceReadinessService deviceReadinessService;

    public CalibrationStreamService(DeviceReadinessService deviceReadinessService) {
        this.deviceReadinessService = deviceReadinessService;
    }

    @PostConstruct
    public void startHeartbeat() {
        heartbeatExecutor.scheduleWithFixedDelay(this::sendHeartbeats, 15, 15, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void stopHeartbeat() {
        heartbeatExecutor.shutdownNow();
    }

    public SseEmitter subscribe(String deviceId) {
        if (deviceId == null || deviceId.trim().isEmpty()) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String normalized = deviceId.trim();
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        CopyOnWriteArrayList<SseEmitter> emitters = emittersByDeviceId.computeIfAbsent(normalized, key -> new CopyOnWriteArrayList<>());
        emitters.add(emitter);

        attachCleanup(emitter, () -> removeEmitter(normalized, emitter));

        // Immediately send latest snapshot
        DeviceReadinessState readiness = deviceReadinessService.getReadiness(normalized);
        CalibrationStreamEvent snapshot = CalibrationStreamEvent.snapshot(normalized, readiness);
        sendEvent(emitter, "calibration_snapshot", snapshot, () -> removeEmitter(normalized, emitter));

        return emitter;
    }

    public void publishCalibrationUpdate(String deviceId, CalibrationMqttEvent event, DeviceReadinessState readiness) {
        if (deviceId == null) {
            return;
        }

        String normalized = deviceId.trim();
        CopyOnWriteArrayList<SseEmitter> emitters = emittersByDeviceId.get(normalized);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }

        CalibrationStreamEvent updateEvent = CalibrationStreamEvent.update(normalized, event, readiness);
        String eventName = "calibration_update";
        if (event.eventId() != null && event.eventId() == 4002) {
            eventName = "calibration_final";
        }

        for (SseEmitter emitter : emitters) {
            sendEvent(emitter, eventName, updateEvent, () -> removeEmitter(normalized, emitter));
        }
    }

    public void publishReadinessSnapshot(String deviceId, DeviceReadinessState readiness) {
        if (deviceId == null) {
            return;
        }

        String normalized = deviceId.trim();
        CopyOnWriteArrayList<SseEmitter> emitters = emittersByDeviceId.get(normalized);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }

        CalibrationStreamEvent snapshot = CalibrationStreamEvent.snapshot(normalized, readiness);

        for (SseEmitter emitter : emitters) {
            sendEvent(emitter, "calibration_snapshot", snapshot, () -> removeEmitter(normalized, emitter));
        }
    }

    private void sendHeartbeats() {
        for (Map.Entry<String, CopyOnWriteArrayList<SseEmitter>> entry : emittersByDeviceId.entrySet()) {
            String deviceId = entry.getKey();
            CalibrationStreamEvent keepalive = CalibrationStreamEvent.keepalive(deviceId);
            for (SseEmitter emitter : entry.getValue()) {
                sendEvent(emitter, "calibration_keepalive", keepalive, () -> removeEmitter(deviceId, emitter));
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
            logger.debug("Removed disconnected SSE emitter for calibration stream of device while sending {} event", eventName, error);
        }
    }

    private void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (RuntimeException error) {
            logger.debug("Ignoring SSE emitter completion failure after send error", error);
        }
    }

    private void removeEmitter(String deviceId, SseEmitter emitter) {
        CopyOnWriteArrayList<SseEmitter> emitters = emittersByDeviceId.get(deviceId);
        if (emitters == null) {
            return;
        }

        emitters.remove(emitter);
        if (emitters.isEmpty()) {
            emittersByDeviceId.remove(deviceId, emitters);
        }
        logger.info("Removed disconnected SSE client for deviceId={}", deviceId);
    }
}
