package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationCommandResponse;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import lk.resq.localhub.model.firmware.CalibrationProfileResponse;
import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.CalibrationEvidence;
import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.SensorStreamCommandUpdate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.Duration;
import java.util.Optional;

@Service
public class CalibrationCommandService {

    private static final Logger logger = LoggerFactory.getLogger(CalibrationCommandService.class);

    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final DeviceReadinessService deviceReadinessService;
    private final ManikinRegistryService manikinRegistryService;
    private final CommandRequestIdGenerator requestIdGenerator;
    private final CalibrationStreamService calibrationStreamService;
    private final CalibrationPersistenceRepository calibrationPersistenceRepository;
    private final CalibrationProfileService calibrationProfileService;
    private final CalibrationProfileFingerprintService fingerprintService;
    private final SensorStreamService sensorStreamService;
    private final Duration sensorReplyTimeout;
    private final Duration sensorSampleTimeout;
    private final Duration sensorSampleMaxAge;

    @Autowired
    public CalibrationCommandService(
            MqttCommandPublisherService mqttCommandPublisherService,
            DeviceReadinessService deviceReadinessService,
            ManikinRegistryService manikinRegistryService,
            CommandRequestIdGenerator requestIdGenerator,
            CalibrationStreamService calibrationStreamService,
            CalibrationPersistenceRepository calibrationPersistenceRepository,
            CalibrationProfileService calibrationProfileService,
            CalibrationProfileFingerprintService fingerprintService,
            SensorStreamService sensorStreamService
    ) {
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.deviceReadinessService = deviceReadinessService;
        this.manikinRegistryService = manikinRegistryService;
        this.requestIdGenerator = requestIdGenerator;
        this.calibrationStreamService = calibrationStreamService;
        this.calibrationPersistenceRepository = calibrationPersistenceRepository;
        this.calibrationProfileService = calibrationProfileService;
        this.fingerprintService = fingerprintService;
        this.sensorStreamService = sensorStreamService == null ? new SensorStreamService() : sensorStreamService;
        this.sensorReplyTimeout = Duration.ofSeconds(5);
        this.sensorSampleTimeout = Duration.ofSeconds(2);
        this.sensorSampleMaxAge = Duration.ofSeconds(2);
    }

    public CalibrationCommandService(
            MqttCommandPublisherService mqttCommandPublisherService,
            DeviceReadinessService deviceReadinessService,
            ManikinRegistryService manikinRegistryService,
            CommandRequestIdGenerator requestIdGenerator,
            CalibrationStreamService calibrationStreamService,
            CalibrationPersistenceRepository calibrationPersistenceRepository,
            CalibrationProfileService calibrationProfileService,
            CalibrationProfileFingerprintService fingerprintService
    ) {
        this(
                mqttCommandPublisherService,
                deviceReadinessService,
                manikinRegistryService,
                requestIdGenerator,
                calibrationStreamService,
                calibrationPersistenceRepository,
                calibrationProfileService,
                fingerprintService,
                new SensorStreamService()
        );
    }

    public CalibrationCommandService(
            MqttCommandPublisherService mqttCommandPublisherService,
            DeviceReadinessService deviceReadinessService,
            ManikinRegistryService manikinRegistryService,
            CommandRequestIdGenerator requestIdGenerator,
            CalibrationStreamService calibrationStreamService,
            CalibrationProfileService calibrationProfileService,
            CalibrationProfileFingerprintService fingerprintService
    ) {
        this(
                mqttCommandPublisherService,
                deviceReadinessService,
                manikinRegistryService,
                requestIdGenerator,
                calibrationStreamService,
                null,
                calibrationProfileService,
                fingerprintService,
                new SensorStreamService()
        );
    }



    public CalibrationCommandResponse startCalibration(String deviceId, CalibrationStartRequest request) {
        return startCalibration(deviceId, request, "system");
    }

    public CalibrationCommandResponse startCalibration(String deviceId, CalibrationStartRequest request, String createdByUsername) {
        if (deviceId == null || deviceId.trim().isEmpty()) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String normalizedDeviceId = deviceId.trim();

        if (manikinRegistryService.getLiveSummary(normalizedDeviceId).isEmpty()) {
            throw new IllegalArgumentException("Device " + normalizedDeviceId + " is not registered");
        }

        ensureDeviceOnline(normalizedDeviceId);

        if (request == null) {
            throw new IllegalArgumentException("Request body must not be null");
        }

        if (request.hallDelta() == null) {
            throw new IllegalArgumentException("hall_delta is required");
        }
        if (request.hallDelta() <= 0) {
            throw new IllegalArgumentException("hall_delta must be positive");
        }

        if (request.refPressure() == null) {
            throw new IllegalArgumentException("ref_pressure is required");
        }
        if (request.refPressure() <= 0) {
            throw new IllegalArgumentException("ref_pressure must be positive");
        }

        if (request.bladder1Pressure() == null) {
            throw new IllegalArgumentException("bladder_1_pressure is required");
        }
        if (request.bladder1Pressure() <= 0) {
            throw new IllegalArgumentException("bladder_1_pressure must be positive");
        }

        if (request.bladder2Pressure() == null) {
            throw new IllegalArgumentException("bladder_2_pressure is required");
        }
        if (request.bladder2Pressure() <= 0) {
            throw new IllegalArgumentException("bladder_2_pressure must be positive");
        }

        if (request.sampleIntervalMs() != null && request.sampleIntervalMs() <= 0) {
            throw new IllegalArgumentException("sample_interval_ms must be positive");
        }

        if (request.calibrationWindowMs() != null && request.calibrationWindowMs() <= 0) {
            throw new IllegalArgumentException("calibration_window_ms must be positive");
        }

        String requestId = requestIdGenerator.next(FirmwareCommandTypeId.CALIBRATION_START);

        String resolvedProfileId = request.profileId();
        CalibrationProfileResponse profile;
        if (resolvedProfileId == null || resolvedProfileId.trim().isEmpty()) {
            if (calibrationProfileService != null) {
                profile = calibrationProfileService.getDefaultProfile()
                        .orElseThrow(() -> new IllegalArgumentException("profile_id is required and no default profile is configured."));
                resolvedProfileId = profile.profileId();
            } else {
                throw new IllegalArgumentException("profile_id is required");
            }
        } else {
            resolvedProfileId = resolvedProfileId.trim();
            if (calibrationProfileService != null) {
                profile = calibrationProfileService.getProfile(resolvedProfileId).orElse(null);
                if (profile == null) {
                    throw new IllegalArgumentException("Requested calibration profile not found: " + resolvedProfileId);
                }
            } else {
                throw new IllegalArgumentException("Requested calibration profile not found: " + resolvedProfileId);
            }
        }
        if (profile != null && !profile.active()) {
            throw new IllegalArgumentException("Requested calibration profile is inactive: " + resolvedProfileId);
        }

        if (!request.hallDelta().equals(profile.hallDelta())
                || !request.refPressure().equals(profile.refPressure())
                || !request.bladder1Pressure().equals(profile.bladder1Pressure())
                || !request.bladder2Pressure().equals(profile.bladder2Pressure())) {
            throw new IllegalArgumentException(
                    "Calibration targets must exactly match profile "
                            + resolvedProfileId
                            + "; update the profile before starting calibration"
            );
        }

        int version = profile.version();
        String hash = profile.profileHash();

        CalibrationStartRequest enrichedRequest = new CalibrationStartRequest(
                request.hallDelta(),
                request.refPressure(),
                request.bladder1Pressure(),
                request.bladder2Pressure(),
                resolvedProfileId,
                request.sampleIntervalMs(),
                request.calibrationWindowMs(),
                request.fullDepthMm(),
                request.pressure0KpaPerCount(),
                request.pressure1KpaPerCount(),
                request.pressure2KpaPerCount(),
                version,
                hash
        );

        MqttCommandPublisherService.FirmwareCommandPublishResult sensorStart =
                ensureSensorAcquisitionStarted(normalizedDeviceId);

        // Publish to MQTT broker
        try {
            mqttCommandPublisherService.publishCalibrationStart(normalizedDeviceId, requestId, enrichedRequest);
        } catch (RuntimeException error) {
            stopTemporarySensorAcquisition(normalizedDeviceId, sensorStart, "calibration_start_publish_failed");
            throw error;
        }

        // Update readiness only after publish succeeds
        DeviceReadinessState readiness = deviceReadinessService.markCalibrationStartRequested(normalizedDeviceId, requestId);
        calibrationStreamService.publishReadinessSnapshot(normalizedDeviceId, readiness);

        // Safe try-catch block for persistence
        try {
            CalibrationEvidence evidence = new CalibrationEvidence(
                    null,
                    normalizedDeviceId,
                    requestId,
                    Instant.now(), // startedAt
                    null, // completedAt
                    "RUNNING", // finalResult
                    "STARTING", // calibrationState
                    false, // readyForSessionAtCompletion
                    null, // lastProgressId
                    null, // lastReasonId
                    null, // lastActionId
                    "STARTING", // firmwareState
                    request.profileId() != null ? request.profileId() : "default",
                    request.hallDelta(),
                    request.refPressure(),
                    request.bladder1Pressure(),
                    request.bladder2Pressure(),
                    request.sampleIntervalMs() != null ? request.sampleIntervalMs() : 100,
                    request.calibrationWindowMs() != null ? request.calibrationWindowMs() : 10000,
                    createdByUsername != null ? createdByUsername : "system",
                    Instant.now(), // createdAt
                    Instant.now() // updatedAt
            );
            calibrationPersistenceRepository.saveEvidence(evidence);
        } catch (Exception error) {
            logger.error("Failed to save calibration evidence for device {}", normalizedDeviceId, error);
        }

        return new CalibrationCommandResponse(
                normalizedDeviceId,
                requestId,
                "calibration/start",
                "PUBLISHED",
                "Calibration start command published. Waiting for firmware acknowledgement.",
                Instant.now()
        );
    }

    private MqttCommandPublisherService.FirmwareCommandPublishResult ensureSensorAcquisitionStarted(String deviceId) {
        Instant requestedAt = Instant.now();
        SensorStreamCommandUpdate current = sensorStreamService.latestControl(deviceId).orElse(null);
        if (current != null && "RUNNING".equals(current.streamState())
                && sensorStreamService.hasFreshSnapshot(deviceId, requestedAt.minus(sensorSampleMaxAge), sensorSampleMaxAge)) {
            logger.info("Calibration sensor acquisition already running deviceId={} requestId={} firmwareState={} ownershipState={}",
                    deviceId, current.requestId(), current.firmwareState(), current.streamState());
            return null;
        }

        boolean shouldPublish = sensorStreamService.beginStart(deviceId);
        MqttCommandPublisherService.FirmwareCommandPublishResult publishResult = null;
        if (shouldPublish) {
            publishResult = mqttCommandPublisherService.publishTelemetryControl(
                    deviceId,
                    "START",
                    SensorStreamService.SENSOR_STREAM_DEFAULT_INTERVAL_MS
            );
            sensorStreamService.commandPublished(deviceId, publishResult.requestId(), "START");
            logger.info("Sensor mode START published for calibration deviceId={} sensorModeRequestId={} topic={}",
                    deviceId, publishResult.requestId(), publishResult.topic());
        } else if (current != null && current.requestId() != null && "STARTING".equals(current.streamState())) {
            publishResult = new MqttCommandPublisherService.FirmwareCommandPublishResult(
                    "existing telemetry/start",
                    current.requestId(),
                    java.util.Map.of("action", "START")
            );
            logger.info("Calibration waiting on existing sensor START request deviceId={} sensorModeRequestId={}",
                    deviceId, current.requestId());
        } else if (current != null && "RUNNING".equals(current.streamState())) {
            logger.info("Calibration using running sensor stream without publishing START deviceId={} sensorModeRequestId={}",
                    deviceId, current.requestId());
        }

        if (publishResult != null && publishResult.requestId() != null) {
            SensorStreamCommandUpdate reply = sensorStreamService.awaitCommandReply(
                    deviceId,
                    publishResult.requestId(),
                    sensorReplyTimeout
            );
            if (!"ACK".equalsIgnoreCase(reply.status())) {
                logger.info("Sensor mode START rejected for calibration deviceId={} sensorModeRequestId={} status={} reason={} firmwareState={}",
                        deviceId, publishResult.requestId(), reply.status(), reply.reasonId(), reply.firmwareState());
                throw new IllegalArgumentException("Sensor acquisition mode could not start"
                        + (reply.reasonId() == null ? "." : ": " + reply.reasonId()));
            }
            logger.info("Sensor mode ACK received for calibration deviceId={} sensorModeRequestId={} firmwareState={}",
                    deviceId, publishResult.requestId(), reply.firmwareState());
        }

        if (!sensorStreamService.awaitFreshSnapshot(deviceId, requestedAt, sensorSampleTimeout, sensorSampleMaxAge)) {
            stopTemporarySensorAcquisition(deviceId, publishResult, "sensor_sample_timeout");
            throw new IllegalArgumentException("Sensor acquisition mode started, but no fresh sensor sample was received.");
        }

        return publishResult;
    }

    private void stopTemporarySensorAcquisition(
            String deviceId,
            MqttCommandPublisherService.FirmwareCommandPublishResult startedByThisAttempt,
            String cleanupAction
    ) {
        if (startedByThisAttempt == null || startedByThisAttempt.requestId() == null) {
            return;
        }
        try {
            MqttCommandPublisherService.FirmwareCommandPublishResult stopResult =
                    mqttCommandPublisherService.publishTelemetryControl(deviceId, "STOP", null);
            sensorStreamService.commandPublished(deviceId, stopResult.requestId(), "STOP");
            logger.info("Calibration cleanup published sensor mode STOP deviceId={} cleanupAction={} sensorModeRequestId={} stopRequestId={}",
                    deviceId, cleanupAction, startedByThisAttempt.requestId(), stopResult.requestId());
        } catch (Exception cleanupError) {
            logger.warn("Calibration cleanup failed to publish sensor mode STOP deviceId={} cleanupAction={} sensorModeRequestId={} error={}",
                    deviceId, cleanupAction, startedByThisAttempt.requestId(), cleanupError.getMessage(), cleanupError);
        }
    }

    public CalibrationCommandResponse cancelCalibration(String deviceId) {
        if (deviceId == null || deviceId.trim().isEmpty()) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String normalizedDeviceId = deviceId.trim();

        if (manikinRegistryService.getLiveSummary(normalizedDeviceId).isEmpty()) {
            throw new IllegalArgumentException("Device " + normalizedDeviceId + " is not registered");
        }

        ensureDeviceOnline(normalizedDeviceId);

        String requestId = requestIdGenerator.next(FirmwareCommandTypeId.CALIBRATION_CANCEL);

        // Publish to MQTT broker
        mqttCommandPublisherService.publishCalibrationCancel(normalizedDeviceId, requestId);

        // Safe try-catch block for persistence - update running evidence to CANCEL_REQUESTED (non-terminal)
        try {
            Optional<CalibrationEvidence> matchingOpt = calibrationPersistenceRepository.findLatestRunningEvidence(normalizedDeviceId);
            if (matchingOpt.isPresent()) {
                CalibrationEvidence old = matchingOpt.get();
                CalibrationEvidence updated = new CalibrationEvidence(
                        old.id(),
                        old.deviceId(),
                        old.requestId(),
                        old.startedAt(),
                        old.completedAt(),
                        old.finalResult(),
                        "CANCEL_REQUESTED", // calibrationState
                        old.readyForSessionAtCompletion(),
                        old.lastProgressId(),
                        old.lastReasonId(),
                        old.lastActionId(),
                        old.firmwareState(),
                        old.profileId(),
                        old.hallDelta(),
                        old.refPressure(),
                        old.bladder1Pressure(),
                        old.bladder2Pressure(),
                        old.sampleIntervalMs(),
                        old.calibrationWindowMs(),
                        old.createdByUsername(),
                        old.createdAt(),
                        Instant.now()
                );
                calibrationPersistenceRepository.updateEvidence(updated);
            }
        } catch (Exception error) {
            logger.error("Failed to update calibration evidence on cancel for device {}", normalizedDeviceId, error);
        }

        return new CalibrationCommandResponse(
                normalizedDeviceId,
                requestId,
                "calibration/cancel",
                "PUBLISHED",
                "Calibration cancel command published. Waiting for firmware acknowledgement.",
                Instant.now()
        );
    }

    private void ensureDeviceOnline(String deviceId) {
        ManikinLiveSummary liveSummary = manikinRegistryService.getLiveSummary(deviceId)
                .orElseThrow(() -> new IllegalArgumentException("Device " + deviceId + " is not registered"));

        boolean online = liveSummary.online() && !liveSummary.offline() && !liveSummary.stale();
        if (!online) {
            throw new IllegalArgumentException("Device " + deviceId + " is offline or unavailable");
        }
    }
}
