package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.ActiveSessionInfo;
import lk.resq.localhub.model.LiveMetricPayload;
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
    private final ConcurrentMap<String, Long> lastAcceptedSeqBySessionId = new ConcurrentHashMap<>();
    private final ManikinRegistryService manikinRegistryService;
    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final LocalSessionRepository localSessionRepository;
    private final LiveStreamService liveStreamService;
    private final TraineeRecordsRepository traineeRecordsRepository;
    private final FirmwareCalibrationService firmwareCalibrationService;
    private final SyncQueueService syncQueueService;

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService
    ) {
        this.manikinRegistryService = manikinRegistryService;
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.localSessionRepository = localSessionRepository;
        this.liveStreamService = liveStreamService;
        this.traineeRecordsRepository = traineeRecordsRepository;
        this.firmwareCalibrationService = firmwareCalibrationService;
        this.syncQueueService = syncQueueService;
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
        firmwareCalibrationService.sessionStartBlockReason(deviceId)
                .ifPresent(reason -> {
                    throw new IllegalStateException(reason);
                });

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
        try {
            syncQueueService.enqueueSessionSummary(response);
            logger.info("Queued session {} for later cloud sync", state.sessionId);
        } catch (RuntimeException error) {
            logger.warn("Saved completed session {} locally but failed to queue it for cloud sync", state.sessionId, error);
        }
        lastAcceptedSeqBySessionId.remove(state.sessionId);
        liveStreamService.publishSessionLive(state.sessionId, null);
        publishInstructorLiveSnapshot();
        logger.info("Ended session {} for device {}", sessionId, state.deviceId);
        return response;
    }

    public TelemetryValidationResult validateTelemetryBinding(String topicDeviceId, JsonNode payload) {
        String normalizedDeviceId = normalize(topicDeviceId);
        if (normalizedDeviceId == null) {
            return TelemetryValidationResult.rejected("topic deviceId is missing");
        }

        if (payload == null || !payload.isObject()) {
            return TelemetryValidationResult.rejected("payload must be a JSON object");
        }

        String payloadDeviceId = firstText(payload, null, "deviceId", "device_id");
        if (payloadDeviceId != null && !normalizedDeviceId.equals(payloadDeviceId)) {
            return TelemetryValidationResult.rejected("payload deviceId does not match MQTT topic deviceId");
        }

        String payloadSessionId = firstText(payload, null, "sessionId", "session_id");
        if (payloadSessionId == null) {
            return TelemetryValidationResult.rejected("payload sessionId is missing");
        }

        ActiveSessionState state = sessionsById.get(payloadSessionId);
        if (state == null || !state.active) {
            return TelemetryValidationResult.rejected("session is not active");
        }

        if (!state.deviceId.equals(normalizedDeviceId)) {
            return TelemetryValidationResult.rejected("active session is assigned to a different device");
        }

        String activeSessionIdForDevice = activeSessionIdByDeviceId.get(normalizedDeviceId);
        if (!payloadSessionId.equals(activeSessionIdForDevice)) {
            return TelemetryValidationResult.rejected("device active session does not match payload sessionId");
        }

        TelemetryPayloadNormalizer.TelemetryNormalizationResult normalization =
                TelemetryPayloadNormalizer.normalize(payload, normalizedDeviceId);
        if (!normalization.ok()) {
            return TelemetryValidationResult.rejected(normalization.reason());
        }

        Long seq = normalization.value().seq();
        if (seq != null) {
            Long previousSeq = lastAcceptedSeqBySessionId.get(payloadSessionId);
            if (previousSeq != null && seq <= previousSeq) {
                return TelemetryValidationResult.rejected("seq is not newer than the last accepted telemetry");
            }
        }

        return TelemetryValidationResult.accepted(payloadSessionId, normalizedDeviceId);
    }

    public void recordTelemetry(String deviceId, JsonNode payload) {
        TelemetryValidationResult validation = validateTelemetryBinding(deviceId, payload);
        if (!validation.accepted()) {
            logger.info("Rejected telemetry for device {}: {}", deviceId, validation.reason());
            return;
        }

        TelemetryPayloadNormalizer.TelemetryNormalizationResult normalization =
                TelemetryPayloadNormalizer.normalize(payload, deviceId);
        if (!normalization.ok()) {
            logger.info("Rejected telemetry for device {}: {}", deviceId, normalization.reason());
            return;
        }

        ActiveSessionState state = sessionsById.get(validation.sessionId());
        if (state == null || !state.active) {
            logger.info("Rejected telemetry for device {}: session disappeared before recording", deviceId);
            return;
        }

        LiveMetricPayload metric = normalization.value();
        state.accumulator.record(
                metric.depthMm(),
                metric.depthProgress(),
                metric.rateCpm(),
                metric.recoilOk(),
            metric.pauseS(),
            metric.compressionCount(),
                flagsToString(metric.flags())
        );
        if (metric.seq() != null) {
            lastAcceptedSeqBySessionId.put(state.sessionId, metric.seq());
        }
        getSessionLiveView(state.sessionId).ifPresent(view -> liveStreamService.publishSessionLive(state.sessionId, view));
        logger.info(
            "Counted telemetry for active session {} on device {} (sampleCount={}, depthMm={}, depthProgress={}, rateCpm={}, recoilOk={}, pauseS={})",
            state.sessionId,
            state.deviceId,
            state.accumulator.sampleCount(),
            metric.depthMm(),
            metric.depthProgress(),
            metric.rateCpm(),
            metric.recoilOk(),
            metric.pauseS()
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

    private static Long firstLong(JsonNode payload, Long fallback, String... keys) {
        if (payload == null) {
            return fallback;
        }

        for (String key : keys) {
            JsonNode node = payload.get(key);
            if (node != null && !node.isNull() && node.isNumber()) {
                return node.asLong();
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

    private static String flagsToString(Object flags) {
        if (flags == null) {
            return null;
        }
        if (flags instanceof String text) {
            String trimmed = text.trim();
            return trimmed.isEmpty() ? null : trimmed;
        }
        return flags.toString();
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

    public record TelemetryValidationResult(
            boolean accepted,
            String reason,
            String sessionId,
            String deviceId
    ) {
        private static TelemetryValidationResult accepted(String sessionId, String deviceId) {
            return new TelemetryValidationResult(true, null, sessionId, deviceId);
        }

        private static TelemetryValidationResult rejected(String reason) {
            return new TelemetryValidationResult(false, reason, null, null);
        }
    }

    private static final class SessionTelemetryAccumulator {
        private int sampleCount;
        private int totalCompressions;
        private int validCompressions;
        private int depthSampleCount;
        private int depthProgressSampleCount;
        private int rateSampleCount;
        private double depthSumMm;
        private double depthProgressSum;
        private double rateSumCpm;
        private int recoilTrueCount;
        private int recoilFalseCount;
        private int pausesCount;
        private Double lastDepthMm;
        private Double lastDepthProgress;
        private Double lastRateCpm;
        private Boolean lastRecoilOk;
        private Double lastPauseS;
        private String latestFlags;

        private void record(Double depthMm, Double depthProgress, Double rateCpm, Boolean recoilOk, Double pauseS, Integer compressionCount, String flags) {
            sampleCount++;

            if (compressionCount != null && compressionCount > 0) {
                totalCompressions += compressionCount;
                if (Boolean.TRUE.equals(recoilOk)) {
                    validCompressions += compressionCount;
                }
            }

            if (depthMm != null) {
                depthSampleCount++;
                depthSumMm += depthMm;
                lastDepthMm = depthMm;
            }

            if (depthProgress != null) {
                depthProgressSampleCount++;
                depthProgressSum += depthProgress;
                lastDepthProgress = depthProgress;
            }

            if (rateCpm != null) {
                rateSampleCount++;
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

        private Double lastDepthProgress() {
            return lastDepthProgress;
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
            double avgDepthMm = depthSampleCount == 0 ? 0.0 : depthSumMm / depthSampleCount;
            Double avgDepthProgress = depthProgressSampleCount == 0 ? null : depthProgressSum / depthProgressSampleCount;
            double avgRateCpm = rateSampleCount == 0 ? 0.0 : rateSumCpm / rateSampleCount;
            double recoilPct = totalRecoilSamples == 0 ? 0.0 : (recoilTrueCount * 100.0) / totalRecoilSamples;

            logger.info(
                    "Computed summary from telemetry (sessionId={}, sampleCount={}, depthSampleCount={}, depthProgressSampleCount={}, recoilTrueCount={}, recoilFalseCount={}, pausesCount={})",
                    sessionId,
                    totalSamples,
                    depthSampleCount,
                    depthProgressSampleCount,
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
                        totalSamples,
                        totalCompressions,
                        validCompressions,
                    avgDepthMm,
                        avgDepthProgress,
                    avgRateCpm,
                    recoilPct,
                        recoilTrueCount,
                        recoilFalseCount,
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
                    baseSummary.sampleCount(),
                    baseSummary.totalCompressions(),
                    baseSummary.validCompressions(),
                    baseSummary.avgDepthMm(),
                    baseSummary.avgDepthProgress(),
                    baseSummary.avgRateCpm(),
                    baseSummary.recoilPct(),
                    baseSummary.recoilOkCount(),
                    baseSummary.incompleteRecoilCount(),
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
