package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.ActiveSessionInfo;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.LiveMetricPayload;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionLifecycleState;
import lk.resq.localhub.model.SessionLiveView;
import lk.resq.localhub.model.SessionStartCommandPayload;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.model.SessionStopCommandPayload;
import lk.resq.localhub.model.SessionStopResponse;
import lk.resq.localhub.model.SessionSummary;
import lk.resq.localhub.model.firmware.DeviceRuntimeState;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareRequestIds;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
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
    private final ConcurrentMap<String, String> sessionIdByStartRequestId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> sessionIdByStopRequestId = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Long> lastAcceptedSeqBySessionId = new ConcurrentHashMap<>();
    private final ManikinRegistryService manikinRegistryService;
    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final LocalSessionRepository localSessionRepository;
    private final LiveStreamService liveStreamService;
    private final TraineeRecordsRepository traineeRecordsRepository;
    private final FirmwareCalibrationService firmwareCalibrationService;
    private final SyncQueueService syncQueueService;
    private final RosterCacheRepository rosterRepository;
    private final RateEstimatorRegistry rateEstimatorRegistry;
    private final DeviceReadinessService deviceReadinessService;
    private final Clock clock;
    private final long startAckTimeoutMs;
    private final long stopAckTimeoutMs;
    private final CommandRequestIdGenerator requestIdGenerator;

    @org.springframework.beans.factory.annotation.Autowired
    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService,
            RosterCacheRepository rosterRepository,
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService,
            @Value("${resq.session.start-ack-timeout-ms:7000}") long startAckTimeoutMs,
            @Value("${resq.session.stop-ack-timeout-ms:7000}") long stopAckTimeoutMs,
            CommandRequestIdGenerator requestIdGenerator
    ) {
        this(manikinRegistryService, mqttCommandPublisherService, localSessionRepository, liveStreamService,
                traineeRecordsRepository, firmwareCalibrationService, syncQueueService, rosterRepository,
                rateEstimatorRegistry, deviceReadinessService, startAckTimeoutMs, stopAckTimeoutMs, Clock.systemUTC(),
                requestIdGenerator);
    }

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService,
            RosterCacheRepository rosterRepository,
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService,
            long startAckTimeoutMs,
            long stopAckTimeoutMs,
            Clock clock
    ) {
        this(manikinRegistryService, mqttCommandPublisherService, localSessionRepository, liveStreamService,
                traineeRecordsRepository, firmwareCalibrationService, syncQueueService, rosterRepository,
                rateEstimatorRegistry, deviceReadinessService, startAckTimeoutMs, stopAckTimeoutMs, clock,
                new CommandRequestIdGenerator());
    }

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService,
            RosterCacheRepository rosterRepository,
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService,
            long startAckTimeoutMs,
            long stopAckTimeoutMs,
            Clock clock,
            CommandRequestIdGenerator requestIdGenerator
    ) {
        this.manikinRegistryService = manikinRegistryService;
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.localSessionRepository = localSessionRepository;
        this.liveStreamService = liveStreamService;
        this.traineeRecordsRepository = traineeRecordsRepository;
        this.firmwareCalibrationService = firmwareCalibrationService;
        this.syncQueueService = syncQueueService;
        this.rosterRepository = rosterRepository;
        this.rateEstimatorRegistry = rateEstimatorRegistry;
        this.deviceReadinessService = deviceReadinessService;
        this.startAckTimeoutMs = startAckTimeoutMs > 0 ? startAckTimeoutMs : 7000L;
        this.stopAckTimeoutMs = stopAckTimeoutMs > 0 ? stopAckTimeoutMs : 7000L;
        this.clock = clock != null ? clock : Clock.systemUTC();
        this.requestIdGenerator = requestIdGenerator == null ? new CommandRequestIdGenerator() : requestIdGenerator;
    }

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService,
            RosterCacheRepository rosterRepository,
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService,
            long startAckTimeoutMs,
            Clock clock
    ) {
        this(manikinRegistryService, mqttCommandPublisherService, localSessionRepository, liveStreamService,
                traineeRecordsRepository, firmwareCalibrationService, syncQueueService, rosterRepository,
                rateEstimatorRegistry, deviceReadinessService, startAckTimeoutMs, 7000L, clock);
    }

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService,
            RosterCacheRepository rosterRepository,
            RateEstimatorRegistry rateEstimatorRegistry,
            DeviceReadinessService deviceReadinessService
    ) {
        this(manikinRegistryService, mqttCommandPublisherService, localSessionRepository, liveStreamService,
                traineeRecordsRepository, firmwareCalibrationService, syncQueueService, rosterRepository,
                rateEstimatorRegistry, deviceReadinessService, 7000L, 7000L, Clock.systemUTC());
    }

    // Overload for backward compatibility / tests
    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService
    ) {
        this(manikinRegistryService, mqttCommandPublisherService, localSessionRepository, liveStreamService, traineeRecordsRepository, firmwareCalibrationService, syncQueueService, null, new RateEstimatorRegistry(), new DeviceReadinessService());
    }

    public ActiveSessionService(
            ManikinRegistryService manikinRegistryService,
            MqttCommandPublisherService mqttCommandPublisherService,
            LocalSessionRepository localSessionRepository,
            LiveStreamService liveStreamService,
            TraineeRecordsRepository traineeRecordsRepository,
            FirmwareCalibrationService firmwareCalibrationService,
            SyncQueueService syncQueueService,
            RosterCacheRepository rosterRepository
    ) {
        this(manikinRegistryService, mqttCommandPublisherService, localSessionRepository, liveStreamService, traineeRecordsRepository, firmwareCalibrationService, syncQueueService, rosterRepository, new RateEstimatorRegistry(), new DeviceReadinessService());
    }

    public RateEstimatorRegistry getRateEstimatorRegistry() {
        return this.rateEstimatorRegistry;
    }

    public synchronized SessionStartResponse startSession(SessionStartRequest request) {
        String deviceId = normalize(request.deviceId());
        if (deviceId == null) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String profileId = validateStartAvailability(deviceId, request.profileId());

        rateEstimatorRegistry.clearForDevice(deviceId);
        String traineeId = resolveTraineeId(request);

        return createPendingStart(
                deviceId,
                traineeId,
                profileId,
                normalize(request.scenario()),
                normalize(request.notes()),
                request.courseId(),
                null
        );
    }

    public synchronized SessionStartResponse startSession(SessionStartRequest request, AuthUser actor) {
        String deviceId = normalize(request.deviceId());
        if (deviceId == null) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String profileId = validateStartAvailability(deviceId, request.profileId());

        if (actor == null) {
            throw new UnauthorizedException("Authentication is required.");
        }

        rateEstimatorRegistry.clearForDevice(deviceId);

        if (actor.role() == UserRole.TRAINEE) {
            throw new ForbiddenException("Trainees are not allowed to start instructor-led sessions.");
        }

        String courseId = normalize(request.courseId());
        String traineeId = normalize(request.traineeId());

        if (courseId == null || traineeId == null) {
            throw new IllegalArgumentException("courseId and traineeId are required");
        }

        if (rosterRepository != null) {
            // Validate courseId refers to an active synced course
            var course = rosterRepository.findCourseById(courseId)
                    .orElseThrow(() -> new NoSuchElementException("Course not found or inactive: " + courseId));

            // Validate traineeId refers to an active synced user with role TRAINEE
            var trainee = rosterRepository.findSyncedUserById(traineeId)
                    .filter(u -> u.active() && "TRAINEE".equalsIgnoreCase(u.role()))
                    .orElseThrow(() -> new NoSuchElementException("Trainee not found or inactive: " + traineeId));

            // Validate traineeId is enrolled in courseId through local_course_enrollments.active = 1
            if (!rosterRepository.isTraineeEnrolled(courseId, traineeId)) {
                throw new ForbiddenException("Trainee " + traineeId + " is not enrolled in course " + courseId);
            }

            // For INSTRUCTOR, current AuthUser.id must be assigned to courseId through local_course_instructors.active = 1
            if (actor.role() == UserRole.INSTRUCTOR) {
                if (!rosterRepository.isInstructorAssigned(courseId, actor.id())) {
                    throw new ForbiddenException("Instructor " + actor.id() + " is not assigned to course " + courseId);
                }
            }
        }

        return createPendingStart(
                deviceId,
                traineeId,
                profileId,
                normalize(request.scenario()),
                normalize(request.notes()),
                courseId,
                actor.id()
        );
    }

    private String validateStartAvailability(String deviceId, String requestedProfileId) {
        String profileId = normalize(requestedProfileId);
        if (profileId == null) {
            throw new IllegalArgumentException("profileId is required");
        }

        String existingSessionId = activeSessionIdByDeviceId.get(deviceId);
        if (existingSessionId != null) {
            ActiveSessionState existing = sessionsById.get(existingSessionId);
            if (existing != null && existing.reservesDevice()) {
                throw new IllegalStateException("Device " + deviceId + " already has a reserved session " + existingSessionId);
            }
            activeSessionIdByDeviceId.remove(deviceId, existingSessionId);
        }
        if (!deviceReadinessService.isReadyForSession(deviceId)) {
            throw new CalibrationNotReadyException(deviceId, "Run calibration before starting a CPR session.");
        }

        DeviceRuntimeState runtimeState = deviceReadinessService.findRuntimeState(deviceId).orElse(null);
        String calibratedProfileId = normalize(runtimeState == null ? null : runtimeState.calibrationProfileId());
        if (calibratedProfileId == null) {
            throw new CalibrationProfileValidationException(
                    "CALIBRATION_PROFILE_UNKNOWN",
                    deviceId,
                    profileId,
                    null,
                    "Cannot verify the calibrated profile for device " + deviceId + ". Run calibration before starting a session."
            );
        }
        if (!calibratedProfileId.equals(profileId)) {
            throw new CalibrationProfileValidationException(
                    "CALIBRATION_PROFILE_MISMATCH",
                    deviceId,
                    profileId,
                    calibratedProfileId,
                    "Requested profile " + profileId + " does not match calibrated profile " + calibratedProfileId + " for device " + deviceId + "."
            );
        }

        firmwareCalibrationService.sessionStartBlockReason(deviceId)
                .ifPresent(reason -> {
                    throw new IllegalStateException(reason);
                });
        return profileId;
    }

    private SessionStartResponse createPendingStart(
            String deviceId,
            String traineeId,
            String profileId,
            String scenario,
            String notes,
            String courseId,
            String instructorId
    ) {
        String sessionId = UUID.randomUUID().toString();
        String requestId = requestIdGenerator.next(FirmwareCommandTypeId.SESSION_START);
        Instant now = now();
        ActiveSessionState state = new ActiveSessionState(
                sessionId,
                deviceId,
                traineeId,
                now,
                false,
                profileId,
                scenario,
                notes,
                null,
                courseId,
                instructorId,
                requestId,
                SessionLifecycleState.START_PENDING,
                now.plusMillis(startAckTimeoutMs)
        );

        sessionsById.put(sessionId, state);
        activeSessionIdByDeviceId.put(deviceId, sessionId);
        sessionIdByStartRequestId.put(requestId, sessionId);
        publishLifecycleUpdate(state);

        try {
            mqttCommandPublisherService.publishSessionStart(new SessionStartCommandPayload(
                    sessionId,
                    deviceId,
                    state.traineeId,
                    now,
                    state.profileId,
                    state.scenario,
                    requestId
            ));
            logger.info("Created START_PENDING session {} for device {} request {}", sessionId, deviceId, requestId);
        } catch (RuntimeException error) {
            rejectStart(state, "MQTT_PUBLISH_FAILED", null, null);
            logger.warn("Rejected pending session {} for device {} because the start command could not be published", sessionId, deviceId, error);
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

    public synchronized SessionStopResponse endSession(SessionEndRequest request) {
        String sessionId = normalize(request.sessionId());
        if (sessionId == null) {
            throw new IllegalArgumentException("sessionId is required");
        }

        ActiveSessionState state = sessionsById.get(sessionId);
        if (state == null || !(state.lifecycleState == SessionLifecycleState.ACTIVE || state.lifecycleState == SessionLifecycleState.STOP_REJECTED) || !state.active) {
            throw new NoSuchElementException("Session " + sessionId + " was not found or is already ended");
        }

        Instant now = now();
        String requestId = requestIdGenerator.next(FirmwareCommandTypeId.SESSION_STOP);
        state.lifecycleState = SessionLifecycleState.STOP_PENDING;
        state.active = true;
        state.stopRequestId = requestId;
        state.stopRequestedAt = now;
        state.stopDeadline = now.plusMillis(stopAckTimeoutMs);
        state.updatedAt = now;
        state.rejectionReason = null;
        state.firmwareReasonId = null;
        state.firmwareActionId = null;
        activeSessionIdByDeviceId.put(state.deviceId, sessionId);
        sessionIdByStopRequestId.put(requestId, sessionId);
        publishLifecycleUpdate(state);

        try {
            mqttCommandPublisherService.publishSessionStop(new SessionStopCommandPayload(
                    state.sessionId,
                    state.deviceId,
                    now,
                    requestId
            ));
        } catch (RuntimeException error) {
            rejectStop(state, "MQTT_STOP_PUBLISH_FAILED", null, null);
            logger.warn("Rejected pending stop for session {} on device {} because the stop command could not be published", sessionId, state.deviceId, error);
            return toStopResponse(state);
        }
        logger.info("Created STOP_PENDING session {} for device {} request {}", sessionId, state.deviceId, requestId);
        return toStopResponse(state);
    }

    public synchronized boolean handleSessionStartFirmwareReply(
            String deviceId,
            Integer eventId,
            String replyId,
            String status,
            String sessionId,
            String reason,
            String reasonId,
            Integer actionId
    ) {
        String normalizedReplyId = normalize(replyId);
        if (normalizedReplyId == null) {
            return false;
        }

        String correlatedSessionId = sessionIdByStartRequestId.get(normalizedReplyId);
        if (correlatedSessionId == null) {
            return false;
        }

        ActiveSessionState state = sessionsById.get(correlatedSessionId);
        if (state == null) {
            return false;
        }

        String normalizedDeviceId = normalize(deviceId);
        if (normalizedDeviceId == null || !state.deviceId.equals(normalizedDeviceId)) {
            logger.warn("Ignored session-start reply {} for mismatched device {} expected {}", normalizedReplyId, deviceId, state.deviceId);
            return false;
        }

        String normalizedSessionId = normalize(sessionId);
        if (normalizedSessionId != null && !state.sessionId.equals(normalizedSessionId)) {
            logger.warn("Ignored session-start reply {} for mismatched session {} expected {}", normalizedReplyId, sessionId, state.sessionId);
            return false;
        }

        String normalizedStatus = normalizeUpper(status);
        if ("ACK".equals(normalizedStatus) && Integer.valueOf(2000).equals(eventId)) {
            if (state.lifecycleState == SessionLifecycleState.ACTIVE) {
                return true;
            }
            if (state.lifecycleState != SessionLifecycleState.START_PENDING) {
                logger.info("Ignored late session-start ACK {} for session {} in state {}", normalizedReplyId, state.sessionId, state.lifecycleState);
                return false;
            }
            state.lifecycleState = SessionLifecycleState.ACTIVE;
            state.active = true;
            state.updatedAt = now();
            state.rejectionReason = null;
            state.firmwareReasonId = reasonId;
            state.firmwareActionId = actionId;
            publishLifecycleUpdate(state);
            logger.info("Activated session {} for device {} from firmware ACK {}", state.sessionId, state.deviceId, normalizedReplyId);
            return true;
        }

        if ("NACK".equals(normalizedStatus) && isSessionStartReply(eventId, normalizedReplyId)) {
            if (state.lifecycleState == SessionLifecycleState.START_REJECTED) {
                return true;
            }
            if (state.lifecycleState != SessionLifecycleState.START_PENDING) {
                logger.info("Ignored late session-start NACK {} for session {} in state {}", normalizedReplyId, state.sessionId, state.lifecycleState);
                return false;
            }
            rejectStart(state, firstNonBlank(reason, "FIRMWARE_NACK"), reasonId, actionId);
            logger.info("Rejected session {} for device {} from firmware NACK {}", state.sessionId, state.deviceId, normalizedReplyId);
            return true;
        }

        return false;
    }

    public synchronized boolean handleSessionStopFirmwareReply(
            String deviceId,
            Integer eventId,
            String replyId,
            String status,
            String sessionId,
            String reason,
            String reasonId,
            Integer actionId
    ) {
        String normalizedReplyId = normalize(replyId);
        if (normalizedReplyId == null) {
            return false;
        }

        String correlatedSessionId = sessionIdByStopRequestId.get(normalizedReplyId);
        if (correlatedSessionId == null) {
            return false;
        }

        ActiveSessionState state = sessionsById.get(correlatedSessionId);
        if (state == null) {
            return false;
        }

        String normalizedDeviceId = normalize(deviceId);
        if (normalizedDeviceId == null || !state.deviceId.equals(normalizedDeviceId)) {
            logger.warn("Ignored session-stop reply {} for mismatched device {} expected {}", normalizedReplyId, deviceId, state.deviceId);
            return false;
        }

        String normalizedSessionId = normalize(sessionId);
        if (normalizedSessionId != null && !state.sessionId.equals(normalizedSessionId)) {
            logger.warn("Ignored session-stop reply {} for mismatched session {} expected {}", normalizedReplyId, sessionId, state.sessionId);
            return false;
        }

        String normalizedStatus = normalizeUpper(status);
        if ("ACK".equals(normalizedStatus) && Integer.valueOf(2001).equals(eventId)) {
            if (state.lifecycleState == SessionLifecycleState.COMPLETED) {
                return true;
            }
            if (state.lifecycleState != SessionLifecycleState.STOP_PENDING) {
                logger.info("Ignored late session-stop ACK {} for session {} in state {}", normalizedReplyId, state.sessionId, state.lifecycleState);
                return false;
            }
            finalizeCompletedStop(state, reasonId, actionId);
            logger.info("Completed session {} for device {} from firmware stop ACK {}", state.sessionId, state.deviceId, normalizedReplyId);
            return true;
        }

        if ("NACK".equals(normalizedStatus) && isSessionStopReply(eventId, normalizedReplyId)) {
            if (state.lifecycleState == SessionLifecycleState.STOP_REJECTED) {
                return true;
            }
            if (state.lifecycleState != SessionLifecycleState.STOP_PENDING) {
                logger.info("Ignored late session-stop NACK {} for session {} in state {}", normalizedReplyId, state.sessionId, state.lifecycleState);
                return false;
            }
            rejectStop(state, firstNonBlank(reason, "FIRMWARE_STOP_NACK"), reasonId, actionId);
            logger.info("Rejected stop for session {} on device {} from firmware NACK {}", state.sessionId, state.deviceId, normalizedReplyId);
            return true;
        }

        return false;
    }

    public synchronized boolean handleSessionInterruptedFirmwareEvent(
            String deviceId,
            Integer eventId,
            String sessionId,
            String reason,
            String reasonId,
            Integer actionId
    ) {
        if (!Integer.valueOf(2002).equals(eventId)) {
            return false;
        }

        String normalizedSessionId = normalize(sessionId);
        ActiveSessionState state = normalizedSessionId == null ? null : sessionsById.get(normalizedSessionId);
        if (state == null) {
            String normalizedDeviceId = normalize(deviceId);
            String activeSessionId = normalizedDeviceId == null ? null : activeSessionIdByDeviceId.get(normalizedDeviceId);
            state = activeSessionId == null ? null : sessionsById.get(activeSessionId);
        }
        if (state == null) {
            return false;
        }

        String normalizedDeviceId = normalize(deviceId);
        if (normalizedDeviceId == null || !state.deviceId.equals(normalizedDeviceId)) {
            logger.warn("Ignored session-interrupted event for mismatched device {} expected {}", deviceId, state.deviceId);
            return false;
        }
        if (normalizedSessionId != null && !state.sessionId.equals(normalizedSessionId)) {
            logger.warn("Ignored session-interrupted event for mismatched session {} expected {}", sessionId, state.sessionId);
            return false;
        }
        if (!(state.lifecycleState == SessionLifecycleState.ACTIVE || state.lifecycleState == SessionLifecycleState.STOP_PENDING)) {
            logger.info("Ignored session-interrupted event for session {} in state {}", state.sessionId, state.lifecycleState);
            return false;
        }

        state.lifecycleState = SessionLifecycleState.INTERRUPTED;
        state.active = false;
        state.endedAt = now();
        state.updatedAt = state.endedAt;
        state.rejectionReason = firstNonBlank(reason, "SESSION_INTERRUPTED");
        state.firmwareReasonId = reasonId;
        state.firmwareActionId = actionId;
        activeSessionIdByDeviceId.remove(state.deviceId, state.sessionId);
        if (state.stopRequestId != null) {
            sessionIdByStopRequestId.remove(state.stopRequestId, state.sessionId);
        }
        rateEstimatorRegistry.clearForSession(state.deviceId, state.sessionId);
        lastAcceptedSeqBySessionId.remove(state.sessionId);
        publishLifecycleUpdate(state);
        logger.warn("Marked session {} for device {} as INTERRUPTED", state.sessionId, state.deviceId);
        return true;
    }

    @Scheduled(fixedDelayString = "${resq.session.start-timeout-sweep-ms:1000}")
    public synchronized int expirePendingSessionStarts() {
        Instant now = now();
        int expired = 0;
        for (ActiveSessionState state : sessionsById.values()) {
            if (state.lifecycleState == SessionLifecycleState.START_PENDING
                    && state.startDeadline != null
                    && !state.startDeadline.isAfter(now)) {
                state.lifecycleState = SessionLifecycleState.START_TIMEOUT;
                state.active = false;
                state.updatedAt = now;
                state.rejectionReason = "START_ACK_TIMEOUT";
                activeSessionIdByDeviceId.remove(state.deviceId, state.sessionId);
                publishLifecycleUpdate(state);
                expired++;
                logger.warn("Session {} for device {} timed out waiting for firmware ACK", state.sessionId, state.deviceId);
            }
        }
        return expired;
    }

    @Scheduled(fixedDelayString = "${resq.session.stop-timeout-sweep-ms:1000}")
    public synchronized int expirePendingSessionStops() {
        Instant now = now();
        int expired = 0;
        for (ActiveSessionState state : sessionsById.values()) {
            if (state.lifecycleState == SessionLifecycleState.STOP_PENDING
                    && state.stopDeadline != null
                    && !state.stopDeadline.isAfter(now)) {
                state.lifecycleState = SessionLifecycleState.STOP_TIMEOUT;
                state.active = false;
                state.endedAt = now;
                state.updatedAt = now;
                state.rejectionReason = "STOP_ACK_TIMEOUT";
                activeSessionIdByDeviceId.remove(state.deviceId, state.sessionId);
                if (state.stopRequestId != null) {
                    sessionIdByStopRequestId.remove(state.stopRequestId, state.sessionId);
                }
                rateEstimatorRegistry.clearForSession(state.deviceId, state.sessionId);
                lastAcceptedSeqBySessionId.remove(state.sessionId);
                publishLifecycleUpdate(state);
                expired++;
                logger.warn("Session {} for device {} timed out waiting for firmware stop ACK", state.sessionId, state.deviceId);
            }
        }
        return expired;
    }

    public Optional<SessionStartResponse> findSessionStart(String sessionId) {
        String normalizedSessionId = normalize(sessionId);
        if (normalizedSessionId == null) {
            return Optional.empty();
        }
        ActiveSessionState state = sessionsById.get(normalizedSessionId);
        return state == null ? Optional.empty() : Optional.of(toStartResponse(state));
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
            payloadSessionId = activeSessionIdByDeviceId.get(normalizedDeviceId);
        }
        if (payloadSessionId == null) {
            return TelemetryValidationResult.rejected("payload sessionId is missing");
        }

        String eventType = firstText(payload, null, "eventType", "event_type");
        if (eventType != null && !"session_telemetry".equalsIgnoreCase(eventType)) {
            return TelemetryValidationResult.rejected("payload eventType is not session_telemetry");
        }

        String firmwareState = firstText(payload, null, "state");
        if (firmwareState != null && !"SESSION_ACTIVE".equalsIgnoreCase(firmwareState)) {
            return TelemetryValidationResult.rejected("payload state is not SESSION_ACTIVE");
        }

        ActiveSessionState state = sessionsById.get(payloadSessionId);
        if (state == null || !acceptsSessionTelemetry(state)) {
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
                TelemetryPayloadNormalizer.normalize(payload, normalizedDeviceId, payloadSessionId, rateEstimatorRegistry);
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
                TelemetryPayloadNormalizer.normalize(payload, deviceId, validation.sessionId(), rateEstimatorRegistry);
        if (!normalization.ok()) {
            logger.info("Rejected telemetry for device {}: {}", deviceId, normalization.reason());
            return;
        }

        ActiveSessionState state = sessionsById.get(validation.sessionId());
        if (state == null || !acceptsSessionTelemetry(state)) {
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
                metric.validCompressionCount(),
                metric.recoilOkCount(),
                metric.incompleteRecoilCount(),
                flagsToString(metric.flags())
        );
        if (metric.seq() != null) {
            lastAcceptedSeqBySessionId.put(state.sessionId, metric.seq());
        }
        state.latestMetric = metric;
        state.latestMetricReceivedAt = Instant.now();
        getSessionLiveView(state.sessionId).ifPresent(view -> liveStreamService.publishSessionLive(state.sessionId, view));
        logger.debug(
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

    public Optional<SessionLiveView> findActiveSessionForTrainee(AuthUser actor) {
        if (actor == null) {
            return Optional.empty();
        }
        String actorId = actor.id();
        String actorUsername = actor.username();
        String actorEmail = null;
        if (rosterRepository != null) {
            actorEmail = rosterRepository.findSyncedUserById(actorId)
                    .map(RosterCacheRepository.SyncedUserRecord::email)
                    .orElse(null);
        }

        for (ActiveSessionState state : sessionsById.values()) {
            if (state.active && state.traineeId != null) {
                boolean match = state.traineeId.equalsIgnoreCase(actorId) ||
                                state.traineeId.equalsIgnoreCase(actorUsername) ||
                                (actorEmail != null && state.traineeId.equalsIgnoreCase(actorEmail));
                if (match) {
                    return getSessionLiveView(state.sessionId);
                }
            }
        }
        return Optional.empty();
    }

    public Optional<SessionEndResponse> findCompletedSession(String sessionId) {
        return localSessionRepository.findById(sessionId);
    }

    public List<SessionEndResponse> listCompletedSessions() {
        return localSessionRepository.findAll();
    }

    public List<SessionEndResponse> listCompletedSessionsForTrainee(AuthUser actor) {
        if (actor == null) {
            return List.of();
        }
        String actorId = actor.id();
        String actorUsername = actor.username();
        String actorEmail = null;
        if (rosterRepository != null) {
            actorEmail = rosterRepository.findSyncedUserById(actorId)
                    .map(RosterCacheRepository.SyncedUserRecord::email)
                    .orElse(null);
        }
        return localSessionRepository.findByTraineeIdOrUsernameOrEmail(actorId, actorUsername, actorEmail);
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
        if (state == null || !state.active || !reservesAsActiveSession(state.lifecycleState)) {
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
                        summary.firmwareState(),
                        summary.calibrated(),
                        summary.readyForSession(),
                        summary.calibrationState(),
                        summary.progressId(),
                        summary.reasonId(),
                        summary.actionId(),
                        summary.calibrationProgressId(),
                        summary.calibrationReasonId(),
                        summary.calibrationActionId(),
                        summary.calibrationResult(),
                        summary.profileId(),
                        summary.pressureMode(),
                        summary.pressureDegraded(),
                        summary.usingLastStablePressure(),
                        summary.pressureValid(),
                        summary.hallValid(),
                        summary.depthSource(),
                        summary.warnings(),
                        session.sessionId(),
                        session.traineeId(),
                        session.startedAt(),
                        session.scenario(),
                        session.lifecycleState() != null ? session.lifecycleState().name() : null,
                        summary.latestDepthProgress(),
                        summary.latestCompressionCount(),
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
        if (state == null) {
            return Optional.empty();
        }

        return Optional.of(toSessionLiveView(state));
    }

    private SessionLiveView toSessionLiveView(ActiveSessionState state) {
        ManikinLiveSummary summary = manikinRegistryService.getLiveSummary(state.deviceId).orElse(null);

        LiveMetricPayload latestMetric = state.latestMetric;
        Double liveDepthMm = latestMetric != null ? latestMetric.depthMm() : state.accumulator.lastDepthMm();
        Double liveRateCpm = latestMetric != null ? latestMetric.rateCpm() : state.accumulator.lastRateCpm();
        Boolean liveRecoilOk = latestMetric != null ? latestMetric.recoilOk() : state.accumulator.lastRecoilOk();
        Double livePauseS = latestMetric != null ? latestMetric.pauseS() : state.accumulator.lastPauseS();
        String liveFlags = latestMetric != null ? flagsToString(latestMetric.flags()) : state.accumulator.latestFlags();
        Long liveForce1 = summary != null ? summary.latestForce1() : null;
        Long liveForce2 = summary != null ? summary.latestForce2() : null;
        Double livePressureBalancePct = latestMetric != null
                ? latestMetric.pressureBalancePct()
                : (summary != null ? summary.pressureBalancePct() : null);
        Boolean livePressureSkewed = summary != null ? summary.pressureSkewed() : null;

        return new SessionLiveView(
                state.sessionId,
                state.deviceId,
                summary != null ? summary.manikinId() : null,
                state.traineeId,
                state.active,
                state.startedAt,
                state.profileId,
                state.scenario,
                state.notes,
                state.latestMetricReceivedAt != null
                        ? state.latestMetricReceivedAt
                        : (summary != null ? summary.lastSeen() : null),
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
                latestMetric,
                latestMetric != null ? latestMetric.seq() : null,
                summary != null ? summary.connectionState() : "CONNECTING",
                summary != null && summary.stale(),
                summary == null || summary.offline(),
                state.lifecycleState.name(),
                state.stopRequestId != null ? state.stopRequestId : state.requestId
        );
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

    private void publishLifecycleUpdate(ActiveSessionState state) {
        publishInstructorLiveSnapshot();
        liveStreamService.publishSessionLive(state.sessionId, toSessionLiveView(state));
    }

    private SessionStartResponse toStartResponse(ActiveSessionState state) {
        return new SessionStartResponse(
                state.sessionId,
                state.deviceId,
                state.traineeId,
                state.startedAt,
                state.active,
                state.profileId,
                state.scenario,
                state.notes,
                state.courseId,
                state.instructorId,
                state.requestId,
                state.lifecycleState
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
                summary,
                state.courseId,
                state.instructorId
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
                state.notes,
                state.lifecycleState
        );
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private SessionStopResponse toStopResponse(ActiveSessionState state) {
        return new SessionStopResponse(
                state.sessionId,
                state.deviceId,
                state.stopRequestId,
                state.lifecycleState,
                state.active,
                state.lifecycleState == SessionLifecycleState.COMPLETED,
                state.startedAt,
                state.stopRequestedAt,
                state.rejectionReason,
                state.firmwareReasonId,
                state.firmwareActionId
        );
    }

    private Instant now() {
        return Instant.now(clock);
    }

    private boolean isSessionStartReply(Integer eventId, String requestId) {
        if (Integer.valueOf(2000).equals(eventId)) {
            return true;
        }
        return FirmwareRequestIds.parseCommandTypeId(requestId)
                .stream()
                .anyMatch(value -> value == FirmwareCommandTypeId.SESSION_START.value());
    }

    private boolean isSessionStopReply(Integer eventId, String requestId) {
        if (Integer.valueOf(2001).equals(eventId) || Integer.valueOf(1000).equals(eventId)) {
            return true;
        }
        return FirmwareRequestIds.parseCommandTypeId(requestId)
                .stream()
                .anyMatch(value -> value == FirmwareCommandTypeId.SESSION_STOP.value());
    }

    private void finalizeCompletedStop(ActiveSessionState state, String reasonId, Integer actionId) {
        if (state.completedPersisted) {
            state.lifecycleState = SessionLifecycleState.COMPLETED;
            state.active = false;
            return;
        }

        Instant endedAt = now();
        state.lifecycleState = SessionLifecycleState.COMPLETED;
        state.active = false;
        state.endedAt = endedAt;
        state.updatedAt = endedAt;
        state.firmwareReasonId = reasonId;
        state.firmwareActionId = actionId;
        activeSessionIdByDeviceId.remove(state.deviceId, state.sessionId);
        if (state.stopRequestId != null) {
            sessionIdByStopRequestId.remove(state.stopRequestId, state.sessionId);
        }
        rateEstimatorRegistry.clearForSession(state.deviceId, state.sessionId);

        SessionSummary summary = state.accumulator.toSummary(
                state.sessionId,
                state.deviceId,
                state.traineeId,
                state.startedAt,
                state.endedAt
        );
        SessionEndResponse response = toCompletedResponse(state, summary);

        localSessionRepository.save(response);
        state.completedPersisted = true;
        try {
            syncQueueService.enqueueSessionSummary(response);
            state.syncQueued = true;
            logger.info("Queued session {} for later cloud sync", state.sessionId);
        } catch (RuntimeException error) {
            logger.warn("Saved completed session {} locally but failed to queue it for cloud sync", state.sessionId, error);
        }
        lastAcceptedSeqBySessionId.remove(state.sessionId);
        liveStreamService.publishSessionLive(state.sessionId, null);
        publishInstructorLiveSnapshot();
    }

    private void rejectStart(ActiveSessionState state, String reason, String reasonId, Integer actionId) {
        state.lifecycleState = SessionLifecycleState.START_REJECTED;
        state.active = false;
        state.updatedAt = now();
        state.rejectionReason = reason;
        state.firmwareReasonId = reasonId;
        state.firmwareActionId = actionId;
        activeSessionIdByDeviceId.remove(state.deviceId, state.sessionId);
        publishLifecycleUpdate(state);
    }

    private void rejectStop(ActiveSessionState state, String reason, String reasonId, Integer actionId) {
        state.lifecycleState = SessionLifecycleState.STOP_REJECTED;
        state.active = true;
        state.updatedAt = now();
        state.rejectionReason = reason;
        state.firmwareReasonId = reasonId;
        state.firmwareActionId = actionId;
        activeSessionIdByDeviceId.put(state.deviceId, state.sessionId);
        if (state.stopRequestId != null) {
            sessionIdByStopRequestId.remove(state.stopRequestId, state.sessionId);
        }
        publishLifecycleUpdate(state);
    }

    private static boolean acceptsSessionTelemetry(ActiveSessionState state) {
        return state.active && (state.lifecycleState == SessionLifecycleState.ACTIVE || state.lifecycleState == SessionLifecycleState.STOP_PENDING);
    }

    private static boolean reservesAsActiveSession(SessionLifecycleState state) {
        return state == SessionLifecycleState.ACTIVE
                || state == SessionLifecycleState.STOP_PENDING
                || state == SessionLifecycleState.STOP_REJECTED;
    }

    private static String normalizeUpper(String value) {
        String normalized = normalize(value);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }

    private static String firstNonBlank(String first, String fallback) {
        String normalized = normalize(first);
        return normalized != null ? normalized : fallback;
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
        private final String profileId;
        private final String scenario;
        private final String notes;
        private final SessionTelemetryAccumulator accumulator;
        private boolean active;
        private Instant endedAt;
        private final String courseId;
        private final String instructorId;
        private final String requestId;
        private volatile SessionLifecycleState lifecycleState;
        private final Instant startDeadline;
        private volatile String stopRequestId;
        private volatile Instant stopRequestedAt;
        private volatile Instant stopDeadline;
        private volatile Instant updatedAt;
        private volatile String rejectionReason;
        private volatile String firmwareReasonId;
        private volatile Integer firmwareActionId;
        private volatile boolean completedPersisted;
        private volatile boolean syncQueued;
        private volatile LiveMetricPayload latestMetric;
        private volatile Instant latestMetricReceivedAt;

        private ActiveSessionState(
                String sessionId,
                String deviceId,
                String traineeId,
                Instant startedAt,
                boolean active,
                String profileId,
                String scenario,
                String notes,
                Instant endedAt,
                String courseId,
                String instructorId,
                String requestId,
                SessionLifecycleState lifecycleState,
                Instant startDeadline
        ) {
            this.sessionId = sessionId;
            this.deviceId = deviceId;
            this.traineeId = traineeId;
            this.startedAt = startedAt;
            this.active = active;
            this.profileId = profileId;
            this.scenario = scenario;
            this.notes = notes;
            this.endedAt = endedAt;
            this.accumulator = new SessionTelemetryAccumulator();
            this.courseId = courseId;
            this.instructorId = instructorId;
            this.requestId = requestId;
            this.lifecycleState = lifecycleState != null ? lifecycleState : (active ? SessionLifecycleState.ACTIVE : SessionLifecycleState.START_PENDING);
            this.startDeadline = startDeadline;
            this.updatedAt = startedAt;
        }

        private boolean reservesDevice() {
            return lifecycleState == SessionLifecycleState.START_PENDING
                    || lifecycleState == SessionLifecycleState.ACTIVE
                    || lifecycleState == SessionLifecycleState.STOP_PENDING
                    || lifecycleState == SessionLifecycleState.STOP_REJECTED;
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

        private void record(
                Double depthMm,
                Double depthProgress,
                Double rateCpm,
                Boolean recoilOk,
                Double pauseS,
                Integer compressionCount,
                Integer validCompressionCount,
                Integer recoilOkCount,
                Integer incompleteRecoilCount,
                String flags
        ) {
            sampleCount++;

            if (compressionCount != null && compressionCount > 0) {
                totalCompressions = Math.max(totalCompressions, compressionCount);
            }
            if (validCompressionCount != null) {
                validCompressions = Math.max(validCompressions, validCompressionCount);
            } else if (compressionCount != null && Boolean.TRUE.equals(recoilOk)) {
                validCompressions = Math.max(validCompressions, compressionCount);
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
                if (recoilOkCount == null && incompleteRecoilCount == null && recoilOk) {
                    recoilTrueCount++;
                } else if (recoilOkCount == null && incompleteRecoilCount == null) {
                    recoilFalseCount++;
                }
            }
            if (recoilOkCount != null) {
                recoilTrueCount = Math.max(recoilTrueCount, recoilOkCount);
            }
            if (incompleteRecoilCount != null) {
                recoilFalseCount = Math.max(recoilFalseCount, incompleteRecoilCount);
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
