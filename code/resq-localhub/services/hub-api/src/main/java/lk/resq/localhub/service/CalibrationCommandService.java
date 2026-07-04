package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationCommandResponse;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.CalibrationEvidence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Optional;

@Service
public class CalibrationCommandService {

    private static final Logger logger = LoggerFactory.getLogger(CalibrationCommandService.class);

    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final DeviceReadinessService deviceReadinessService;
    private final ManikinRegistryService manikinRegistryService;
    private final FirmwareRequestIdGenerator requestIdGenerator;
    private final CalibrationStreamService calibrationStreamService;
    private final CalibrationPersistenceRepository calibrationPersistenceRepository;

    @Autowired
    public CalibrationCommandService(
            MqttCommandPublisherService mqttCommandPublisherService,
            DeviceReadinessService deviceReadinessService,
            ManikinRegistryService manikinRegistryService,
            FirmwareRequestIdGenerator requestIdGenerator,
            CalibrationStreamService calibrationStreamService,
            CalibrationPersistenceRepository calibrationPersistenceRepository
    ) {
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.deviceReadinessService = deviceReadinessService;
        this.manikinRegistryService = manikinRegistryService;
        this.requestIdGenerator = requestIdGenerator;
        this.calibrationStreamService = calibrationStreamService;
        this.calibrationPersistenceRepository = calibrationPersistenceRepository;
    }

    public CalibrationCommandService(
            MqttCommandPublisherService mqttCommandPublisherService,
            DeviceReadinessService deviceReadinessService,
            ManikinRegistryService manikinRegistryService,
            FirmwareRequestIdGenerator requestIdGenerator,
            CalibrationStreamService calibrationStreamService
    ) {
        this(
                mqttCommandPublisherService,
                deviceReadinessService,
                manikinRegistryService,
                requestIdGenerator,
                calibrationStreamService,
                null
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

        String requestId = requestIdGenerator.nextRequestId(200);

        // Publish to MQTT broker
        mqttCommandPublisherService.publishCalibrationStart(normalizedDeviceId, requestId, request);

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

    public CalibrationCommandResponse cancelCalibration(String deviceId) {
        if (deviceId == null || deviceId.trim().isEmpty()) {
            throw new IllegalArgumentException("deviceId is required");
        }

        String normalizedDeviceId = deviceId.trim();

        if (manikinRegistryService.getLiveSummary(normalizedDeviceId).isEmpty()) {
            throw new IllegalArgumentException("Device " + normalizedDeviceId + " is not registered");
        }

        String requestId = requestIdGenerator.nextRequestId(201);

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
}
