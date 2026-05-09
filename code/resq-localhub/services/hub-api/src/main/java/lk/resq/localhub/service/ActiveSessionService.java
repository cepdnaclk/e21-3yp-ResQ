package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.ActiveSessionInfo;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionLiveView;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.SessionStopCommandPayload;
import lk.resq.localhub.model.SessionSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Service
public class ActiveSessionService {

    private static final Logger logger = LoggerFactory.getLogger(ActiveSessionService.class);

    private final ConcurrentMap<String, ActiveSessionState> sessionsById = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> activeSessionIdByDeviceId = new ConcurrentHashMap<>();
    private final ManikinRegistryService manikinRegistryService;
    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final LocalSessionRepository localSessionRepository;
    private final LiveStreamService liveStreamService;
    private final TraineeRecordsRepository traineeRecordsRepository;

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository
    ) {
        this.manikinRegistryService = manikinRegistryService;
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.localSessionRepository = localSessionRepository;
        this.liveStreamService = liveStreamService;
        this.traineeRecordsRepository = traineeRecordsRepository;
    }

    public synchronized SessionStartResponse startSession(SessionStartRequest request) {
        String deviceId = normalize(request.deviceId());
        if (deviceId == null) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String existingSessionId = activeSessionIdByDeviceId.get(deviceId);
        if (existingSessionId != null) {
            ActiveSessionState existing = sessionsById.get(existingSessionId);
            if (existing != null && existing.active) {
                throw new IllegalStateException("Device " + deviceId + " already has an active session " + existingSessionId);
            }
        }

        String traineeId = resolveTraineeId(request);

        String sessionId = UUID.randomUUID().toString();
        Instant startedAt = Instant.now();
        ActiveSessionState state = new ActiveSessionState(
            sessionId,
            deviceId,
            traineeId,
                startedAt,
                true,
                normalize(request.scenario()),
                normalize(request.notes()),
                null
        );

        sessionsById.put(sessionId, state);
        activeSessionIdByDeviceId.put(deviceId, sessionId);

        try {
            mqttCommandPublisherService.publishSessionStart(new SessionStartCommandPayload(
                    sessionId,
                    deviceId,
                    state.traineeId,
                    startedAt,
                    state.scenario
            ));
            publishInstructorLiveSnapshot();
            logger.info("Started session {} for device {}", sessionId, deviceId);
        } catch (RuntimeException error) {
            sessionsById.remove(sessionId, state);
            activeSessionIdByDeviceId.remove(deviceId, sessionId);
            logger.warn("Rolled back session {} for device {} because the start command could not be published", sessionId, deviceId, error);
            throw new MqttCommandPublishException("Failed to publish session start command for device " + deviceId, error);
        }

        return toStartResponse(state);
    }
    /**
     * Resolve trainee ID from SessionStartRequest options.
     * Priority: traineeRecordId > quickTrainee > guestLabel > traineeId (backward compat)
     */
    private String resolveTraineeId(SessionStartRequest request) {
        try {
            // Option 1: Explicit trainee record ID
            if (request.traineeRecordId() != null && !request.traineeRecordId().isBlank()) {
                return normalize(request.traineeRecordId());
            }

            // Option 2: Quick add trainee (create inline)
            if (request.quickTrainee() != null) {
                var qt = request.quickTrainee();
                if (qt.traineeCode() != null && !qt.traineeCode().isBlank() &&
                    qt.displayName() != null && !qt.displayName().isBlank()) {
                    var created = traineeRecordsRepository.createTrainee(
                            qt.traineeCode(),
                            qt.displayName(),
                            qt.groupName(),
                            null
                    );
                    logger.info("Created inline trainee record {} for session", created.id());
                    return created.id();
                }
            }

            // Option 3: Guest session (use label or default)
            if (request.guestLabel() != null && !request.guestLabel().isBlank()) {
                return normalize(request.guestLabel());
            }

            // Option 4: Legacy traineeId (backward compatibility)
            if (request.traineeId() != null && !request.traineeId().isBlank()) {
                return normalize(request.traineeId());
            }

            // Fallback: unnamed guest
            return "guest-" + UUID.randomUUID().toString().substring(0, 8);
        } catch (Exception error) {
            logger.warn("Error resolving trainee ID, using fallback", error);
            return "trainee-" + System.currentTimeMillis();
        }
    }

    public synchronized SessionEndResponse endSession(SessionEndRequest request) {
        String sessionId = normalize(request.sessionId());
        if (sessionId == null) {
            throw new IllegalArgumentException("sessionId is required");
        }

        ActiveSessionState state = sessionsById.get(sessionId);
        if (state == null || !state.active) {
            throw new NoSuchElementException("Session " + sessionId + " was not found or is already ended");
        }

        state.active = false;
        state.endedAt = Instant.now();
        activeSessionIdByDeviceId.remove(state.deviceId, sessionId);

        try {
            mqttCommandPublisherService.publishSessionStop(new SessionStopCommandPayload(
                    state.sessionId,
                    state.deviceId,
                    state.endedAt
            ));
        } catch (RuntimeException error) {
            state.active = true;
            state.endedAt = null;
            activeSessionIdByDeviceId.put(state.deviceId, sessionId);
            logger.warn("Rolled back session end for {} on device {} because the stop command could not be published", sessionId, state.deviceId, error);
            throw new MqttCommandPublishException("Failed to publish session stop command for device " + state.deviceId, error);
        }

        SessionSummary summary = state.accumulator.toSummary(
                state.sessionId,
                state.deviceId,
                state.traineeId,
                state.startedAt,
                state.endedAt
        );
        SessionEndResponse response = toCompletedResponse(state, summary);

        localSessionRepository.save(response);
        liveStreamService.publishSessionLive(state.sessionId, null);
        publishInstructorLiveSnapshot();
        logger.info("Ended session {} for device {}", sessionId, state.deviceId);
        return response;
    }

    public void recordTelemetry(String deviceId, JsonNode payload) {
        String normalizedDeviceId = normalize(deviceId);
        if (normalizedDeviceId == null) {
            logger.debug("Ignoring telemetry for summary because deviceId is missing or blank");
            return;
        }

        String sessionId = activeSessionIdByDeviceId.get(normalizedDeviceId);
        if (sessionId == null) {
            logger.info("Ignoring telemetry for summary on device {} because no active session exists", normalizedDeviceId);
            return;
        }

        ActiveSessionState state = sessionsById.get(sessionId);
        if (state == null || !state.active) {
            logger.info(
                    "Ignoring telemetry for summary on device {} because session {} is not active",
                    normalizedDeviceId,
                    sessionId
            );
            return;
        }

        Double depthMm = firstDouble(payload, null, "depthMm", "depth_mm", "current_delta");
        Integer compressionCount = firstInt(payload, null, "total_compressions", "compressionCount", "compression_count");
        Double rateCpm = firstDouble(payload, null, "rateCpm", "rate_cpm");
        if (rateCpm == null && compressionCount != null) {
            long elapsedSeconds = Math.max(1L, Duration.between(state.startedAt, Instant.now()).getSeconds());
            rateCpm = (compressionCount * 60.0) / elapsedSeconds;
        }

        String feedback = firstText(payload, null, "feedback");
        Boolean recoilOk = firstBoolean(payload, null, "recoilOk", "recoil_ok", "recoil");
        if (recoilOk == null && feedback != null) {
            recoilOk = "NONE".equalsIgnoreCase(feedback) || feedback.toUpperCase().contains("OK");
        }

        Double pauseS = firstDouble(payload, null, "pauseS", "pause_s");
        String flags = firstFlags(payload, null, "flags");
        if (flags == null) {
            flags = feedback;
        }

        state.accumulator.record(depthMm, rateCpm, recoilOk, pauseS, flags);
        getSessionLiveView(state.sessionId).ifPresent(view -> liveStreamService.publishSessionLive(state.sessionId, view));
        logger.info(
            "Counted telemetry for active session {} on device {} (sampleCount={}, depthMm={}, rateCpm={}, recoilOk={}, pauseS={})",
            state.sessionId,
            state.deviceId,
            state.accumulator.sampleCount(),
            depthMm,
            rateCpm,
            recoilOk,
            pauseS
        );
    }

    public Optional<SessionEndResponse> findCompletedSession(String sessionId) {
        return localSessionRepository.findById(sessionId);
    }

    public List<SessionEndResponse> listCompletedSessions() {
        return localSessionRepository.findAll();
    }

    public Optional<ActiveSessionInfo> findActiveSessionForDevice(String deviceId) {
        String normalizedDeviceId = normalize(deviceId);
        if (normalizedDeviceId == null) {
            return Optional.empty();
        }

        String sessionId = activeSessionIdByDeviceId.get(normalizedDeviceId);
        if (sessionId == null) {
            return Optional.empty();
        }

        ActiveSessionState state = sessionsById.get(sessionId);
        if (state == null || !state.active) {
            return Optional.empty();
        }

        return Optional.of(toInfo(state));
    }

    public ManikinLiveSummary decorateLiveSummary(ManikinLiveSummary summary) {
        return findActiveSessionForDevice(summary.deviceId())
                .map(session -> new ManikinLiveSummary(
                        summary.deviceId(),
                        summary.sessionId(),
                        summary.manikinId(),
                        summary.online(),
                        summary.lastSeen(),
                        summary.state(),
                        summary.ip(),
                        summary.fw(),
                        summary.rssi(),
                        summary.battery(),
                        summary.sessionActive(),
                        summary.latestDepthMm(),
                        summary.latestRateCpm(),
                        summary.latestRecoilOk(),
                        summary.latestPauseS(),
                        summary.latestFlags(),
                        summary.lastEventType(),
                        summary.latestForce1(),
                        summary.latestForce2(),
                        summary.pressureBalancePct(),
                        summary.pressureSkewed(),
                        session.sessionId(),
                        session.traineeId(),
                        session.startedAt(),
                        session.scenario(),
                        summary.latestMetric(),
                        summary.seq(),
                        summary.connectionState(),
                        summary.stale(),
                        summary.offline()
                ))
                .orElse(summary);
    }

    public Optional<SessionLiveView> getSessionLiveView(String sessionId) {
        String normalizedSessionId = normalize(sessionId);
        if (normalizedSessionId == null) {
            return Optional.empty();
        }

        ActiveSessionState state = sessionsById.get(normalizedSessionId);
        if (state == null || !state.active) {
            return Optional.empty();
        }

        ManikinLiveSummary summary = manikinRegistryService.getLiveSummary(state.deviceId)
                .orElse(null);

        Double liveDepthMm = state.accumulator.lastDepthMm();
        Double liveRateCpm = state.accumulator.lastRateCpm();
        Boolean liveRecoilOk = state.accumulator.lastRecoilOk();
        Double livePauseS = state.accumulator.lastPauseS();
        String liveFlags = state.accumulator.latestFlags();
        Long liveForce1 = summary != null ? summary.latestForce1() : null;
        Long liveForce2 = summary != null ? summary.latestForce2() : null;
        Double livePressureBalancePct = summary != null ? summary.pressureBalancePct() : null;
        Boolean livePressureSkewed = summary != null ? summary.pressureSkewed() : null;

        return Optional.of(new SessionLiveView(
                state.sessionId,
                state.deviceId,
                summary != null ? summary.manikinId() : null,
                state.traineeId,
                state.active,
                state.startedAt,
                state.scenario,
                state.notes,
                summary != null ? summary.lastSeen() : null,
                summary != null ? summary.state() : "unknown",
                summary != null && summary.online(),
                summary != null ? summary.ip() : null,
                summary != null ? summary.fw() : null,
                summary != null ? summary.rssi() : null,
                summary != null ? summary.battery() : null,
                summary != null ? summary.sessionActive() : null,
                liveDepthMm != null ? liveDepthMm : (summary != null ? summary.latestDepthMm() : null),
                liveRateCpm != null ? liveRateCpm : (summary != null ? summary.latestRateCpm() : null),
                liveRecoilOk != null ? liveRecoilOk : (summary != null ? summary.latestRecoilOk() : null),
                livePauseS != null ? livePauseS : (summary != null ? summary.latestPauseS() : null),
                liveFlags != null ? liveFlags : (summary != null ? summary.latestFlags() : null),
                summary != null ? summary.lastEventType() : null,
                liveForce1,
                liveForce2,
                livePressureBalancePct,
                livePressureSkewed,
                summary != null ? summary.latestMetric() : null,
                summary != null ? summary.seq() : null,
                summary != null ? summary.connectionState() : "CONNECTING",
                summary != null && summary.stale(),
                summary == null || summary.offline()
        ));
    }

    public void publishLiveUpdatesForStaleDevices(Collection<String> deviceIds) {
        publishInstructorLiveSnapshot();

        for (String deviceId : deviceIds) {
            findActiveSessionForDevice(deviceId)
                    .flatMap(info -> getSessionLiveView(info.sessionId()))
                    .ifPresent(view -> liveStreamService.publishSessionLive(view.sessionId(), view));
        }
    }

    private void publishInstructorLiveSnapshot() {
        liveStreamService.publishInstructorLive(
                manikinRegistryService.getLiveSummaries().stream()
                        .map(this::decorateLiveSummary)
                        .toList()
        );
    }

    private SessionStartResponse toStartResponse(ActiveSessionState state) {
        return new SessionStartResponse(
                state.sessionId,
                state.deviceId,
                state.traineeId,
                state.startedAt,
                state.active,
                state.scenario,
                state.notes
        );
    }

    private SessionEndResponse toCompletedResponse(ActiveSessionState state, SessionSummary summary) {
        return new SessionEndResponse(
                state.sessionId,
                state.deviceId,
                state.traineeId,
                state.startedAt,
                true,
                state.endedAt,
                state.scenario,
                state.notes,
                summary
        );
    }

    private ActiveSessionInfo toInfo(ActiveSessionState state) {
        return new ActiveSessionInfo(
                state.sessionId,
                state.deviceId,
                state.traineeId,
                state.startedAt,
                state.active,
                state.scenario,
                state.notes
        );
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static Double firstDouble(JsonNode payload, Double fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && !node.isNull() && node.isNumber()) {
                return node.asDouble();
            }
        }

        return fallback;
    }

    private static Integer firstInt(JsonNode payload, Integer fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && !node.isNull() && node.isNumber()) {
                return node.asInt();
            }
        }

        return fallback;
    }

    private static String firstText(JsonNode payload, String fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull() || !node.isTextual()) {
                continue;
            }

            String value = node.asText().trim();
            if (!value.isEmpty()) {
                return value;
            }
        }

        return fallback;
    }

    private static Boolean firstBoolean(JsonNode payload, Boolean fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }

            if (node.isBoolean()) {
                return node.asBoolean();
            }

            if (node.isTextual()) {
                String value = node.asText().trim();
                if ("true".equalsIgnoreCase(value)) {
                    return true;
                }
                if ("false".equalsIgnoreCase(value)) {
                    return false;
                }
            }
        }

        return fallback;
    }

    private static String firstFlags(JsonNode payload, String fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node == null || node.isNull()) {
                continue;
            }

            if (node.isTextual()) {
                String value = node.asText().trim();
                return value.isEmpty() ? fallback : value;
            }

            return node.toString();
        }

        return fallback;
    }

    private static final class ActiveSessionState {
        private final String sessionId;
        private final String deviceId;
        private final String traineeId;
        private final Instant startedAt;
        private final String scenario;
        private final String notes;
        private final SessionTelemetryAccumulator accumulator;
        private boolean active;
        private Instant endedAt;

        private ActiveSessionState(
                String sessionId,
                String deviceId,
                String traineeId,
                Instant startedAt,
                boolean active,
                String scenario,
                String notes,
                Instant endedAt
        ) {
            this.sessionId = sessionId;
            this.deviceId = deviceId;
            this.traineeId = traineeId;
            this.startedAt = startedAt;
            this.active = active;
            this.scenario = scenario;
            this.notes = notes;
            this.endedAt = endedAt;
            this.accumulator = new SessionTelemetryAccumulator();
        }
    }

    private static final class SessionTelemetryAccumulator {
        private int sampleCount;
        private double depthSumMm;
        private double rateSumCpm;
        private int recoilTrueCount;
        private int recoilFalseCount;
        private int pausesCount;
        private Double lastDepthMm;
        private Double lastRateCpm;
        private Boolean lastRecoilOk;
        private Double lastPauseS;
        private String latestFlags;

        private void record(Double depthMm, Double rateCpm, Boolean recoilOk, Double pauseS, String flags) {
            sampleCount++;

            if (depthMm != null) {
                depthSumMm += depthMm;
                lastDepthMm = depthMm;
            }

            if (rateCpm != null) {
                rateSumCpm += rateCpm;
                lastRateCpm = rateCpm;
            }

            if (recoilOk != null) {
                lastRecoilOk = recoilOk;
                if (recoilOk) {
                    recoilTrueCount++;
                } else {
                    recoilFalseCount++;
                }
            }

            if (pauseS != null && pauseS > 0.5) {
                pausesCount++;
                lastPauseS = pauseS;
            }

            if (flags != null) {
                latestFlags = flags;
            }
        }

        private Double lastDepthMm() {
            return lastDepthMm;
        }

        private Double lastRateCpm() {
            return lastRateCpm;
        }

        private Boolean lastRecoilOk() {
            return lastRecoilOk;
        }

        private Double lastPauseS() {
            return lastPauseS;
        }

        private String latestFlags() {
            return latestFlags;
        }

        private int sampleCount() {
            return sampleCount;
        }

        private SessionSummary toSummary(String sessionId, String deviceId, String traineeId, Instant startedAt, Instant endedAt) {
            long durationSeconds = Math.max(0L, Duration.between(startedAt, endedAt).getSeconds());
            int totalSamples = sampleCount;
            int totalRecoilSamples = recoilTrueCount + recoilFalseCount;
            double avgDepthMm = totalSamples == 0 ? 0.0 : depthSumMm / totalSamples;
            double avgRateCpm = totalSamples == 0 ? 0.0 : rateSumCpm / totalSamples;
            double recoilPct = totalRecoilSamples == 0 ? 0.0 : (recoilTrueCount * 100.0) / totalRecoilSamples;

            logger.info(
                    "Computed summary from telemetry (sessionId={}, sampleCount={}, recoilTrueCount={}, recoilFalseCount={}, pausesCount={})",
                    sessionId,
                    totalSamples,
                    recoilTrueCount,
                    recoilFalseCount,
                    pausesCount
            );

            SessionSummary baseSummary = new SessionSummary(
                    sessionId,
                    deviceId,
                    traineeId,
                    startedAt,
                    endedAt,
                    durationSeconds,
                    avgDepthMm,
                    avgRateCpm,
                    recoilPct,
                    pausesCount,
                    0,
                    latestFlags
            );

            return new SessionSummary(
                    baseSummary.sessionId(),
                    baseSummary.deviceId(),
                    baseSummary.traineeId(),
                    baseSummary.startedAt(),
                    baseSummary.endedAt(),
                    baseSummary.durationSeconds(),
                    baseSummary.avgDepthMm(),
                    baseSummary.avgRateCpm(),
                    baseSummary.recoilPct(),
                    baseSummary.pausesCount(),
                    calculateScore(baseSummary),
                    baseSummary.latestFlags()
            );
        }

        private int calculateScore(SessionSummary summary) {
            double depthTargetScore = Math.max(0.0, 40.0 - Math.abs(summary.avgDepthMm() - 50.0) * 0.8);
            double rateTargetScore = Math.max(0.0, 30.0 - Math.abs(summary.avgRateCpm() - 110.0) * 0.3);
            double recoilScore = Math.max(0.0, summary.recoilPct() * 0.2);
            double pausePenalty = summary.pausesCount() * 4.0;
            double rawScore = depthTargetScore + rateTargetScore + recoilScore - pausePenalty;
            return (int) Math.round(Math.max(0.0, Math.min(100.0, rawScore)));
        }
    }
}
