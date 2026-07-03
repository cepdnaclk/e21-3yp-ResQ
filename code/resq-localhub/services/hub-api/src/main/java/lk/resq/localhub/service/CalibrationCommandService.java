package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationCommandResponse;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
public class CalibrationCommandService {

    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final DeviceReadinessService deviceReadinessService;
    private final ManikinRegistryService manikinRegistryService;
    private final FirmwareRequestIdGenerator requestIdGenerator;

    public CalibrationCommandService(
            MqttCommandPublisherService mqttCommandPublisherService,
            DeviceReadinessService deviceReadinessService,
            ManikinRegistryService manikinRegistryService,
            FirmwareRequestIdGenerator requestIdGenerator
    ) {
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.deviceReadinessService = deviceReadinessService;
        this.manikinRegistryService = manikinRegistryService;
        this.requestIdGenerator = requestIdGenerator;
    }

    public CalibrationCommandResponse startCalibration(String deviceId, CalibrationStartRequest request) {
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
        deviceReadinessService.markCalibrationStartRequested(normalizedDeviceId, requestId);

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
