package lk.resq.localhub.service;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.firmware.CalibrationProfileResponse;
import lk.resq.localhub.model.firmware.FirmwareCalibrationCommandResponse;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCalibrationStartRequest;
import lk.resq.localhub.model.firmware.FirmwareReadinessResponse;
import lk.resq.localhub.model.firmware.FirmwareState;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;

@Service
public class FirmwareCalibrationService {

    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final FirmwarePersistenceRepository firmwarePersistenceRepository;
        private final CalibrationProfileService calibrationProfileService;
    private final ManikinRegistryService manikinRegistryService;

    public FirmwareCalibrationService(
            MqttCommandPublisherService mqttCommandPublisherService,
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            CalibrationProfileService calibrationProfileService,
            ManikinRegistryService manikinRegistryService
    ) {
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.firmwarePersistenceRepository = firmwarePersistenceRepository;
        this.calibrationProfileService = calibrationProfileService;
        this.manikinRegistryService = manikinRegistryService;
    }

    public FirmwareCalibrationCommandResponse startCalibration(String deviceId, FirmwareCalibrationStartRequest request) {
        String normalizedDeviceId = requireDeviceId(deviceId);
        FirmwareCalibrationStartRequest normalizedRequest = request == null
                ? new FirmwareCalibrationStartRequest(null, null, null, null, null)
                : request;

        String requestedProfileId = normalize(normalizedRequest.profileId());
        CalibrationProfileResponse profile = requestedProfileId != null
            ? calibrationProfileService.getProfile(requestedProfileId).orElseThrow(() -> new IllegalArgumentException("Calibration profile not found: " + requestedProfileId))
            : calibrationProfileService.getDefaultProfile().orElseThrow(() -> new IllegalArgumentException("No calibration profile is available"));

        Integer hallDelta = coalesce(normalizedRequest.hallDelta(), profile.hallDelta());
        Integer refPressure = coalesce(normalizedRequest.refPressure(), profile.refPressure());
        Integer bladder1Pressure = coalesce(normalizedRequest.bladder1Pressure(), profile.bladder1Pressure());
        Integer bladder2Pressure = coalesce(normalizedRequest.bladder2Pressure(), profile.bladder2Pressure());

        hallDelta = CalibrationConstraints.requireHallDelta(hallDelta);
        refPressure = requirePositiveInteger(refPressure, "refPressure must be greater than 0");
        bladder1Pressure = requirePositiveInteger(bladder1Pressure, "bladder1Pressure must be greater than 0");
        bladder2Pressure = requirePositiveInteger(bladder2Pressure, "bladder2Pressure must be greater than 0");

        String resolvedProfileId = requestedProfileId != null ? requestedProfileId : profile.profileId();

        MqttCommandPublisherService.FirmwareCommandPublishResult result =
                mqttCommandPublisherService.publishCalibrationStartCommand(
                        normalizedDeviceId,
                        hallDelta,
                        refPressure,
                        bladder1Pressure,
                        bladder2Pressure,
                resolvedProfileId
                );

        return new FirmwareCalibrationCommandResponse(
                normalizedDeviceId,
                result.requestId(),
                result.topic(),
                "PUBLISHED",
                null
        );
    }

    public FirmwareCalibrationCommandResponse cancelCalibration(String deviceId) {
        String normalizedDeviceId = requireDeviceId(deviceId);
        MqttCommandPublisherService.FirmwareCommandPublishResult result =
                mqttCommandPublisherService.publishCalibrationCancelCommand(normalizedDeviceId);

        return new FirmwareCalibrationCommandResponse(
                normalizedDeviceId,
                result.requestId(),
                result.topic(),
                "PUBLISHED",
                null
        );
    }

    public FirmwareReadinessResponse getLatestReadiness(String deviceId) {
        String normalizedDeviceId = requireDeviceId(deviceId);
        Optional<FirmwareCalibrationResultRecord> latest = firmwarePersistenceRepository.findLatestCalibrationResult(normalizedDeviceId);
        Optional<ManikinLiveSummary> summary = manikinRegistryService.getLiveSummary(normalizedDeviceId);

        String registryState = summary.map(ManikinLiveSummary::state).map(FirmwareCalibrationService::normalize).orElse(null);
        FirmwareCalibrationResultRecord result = latest.orElse(null);
        String firmwareState = firstNonBlank(registryState, result == null ? null : result.firmwareState());
        String latestResult = normalize(result == null ? null : result.result());
        boolean calibrated = Boolean.TRUE.equals(result == null ? null : result.calibrated()) || "PASS".equalsIgnoreCase(nullToBlank(latestResult));
        boolean readyForSession = determineReadyForSession(firmwareState, latestResult);

        return new FirmwareReadinessResponse(
                normalizedDeviceId,
                firmwareState,
                calibrated,
                readyForSession,
                latestResult,
                result == null ? null : result.progressId(),
                result == null ? null : result.reasonId(),
                result == null ? null : result.actionId(),
                result == null ? null : result.tsMs(),
                result == null ? null : toIso(result.receivedAt()),
                summary.map(ManikinLiveSummary::sessionId).orElse(null),
                latestErrorId(summary.orElse(null), result)
        );
    }

    public Optional<String> sessionStartBlockReason(String deviceId) {
        String normalizedDeviceId = normalize(deviceId);
        if (normalizedDeviceId == null) {
            return Optional.of("deviceId is required");
        }

        Optional<FirmwareCalibrationResultRecord> latest = firmwarePersistenceRepository.findLatestCalibrationResult(normalizedDeviceId);
        Optional<ManikinLiveSummary> summary = manikinRegistryService.getLiveSummary(normalizedDeviceId);
        String firmwareState = firstNonBlank(
                summary.map(ManikinLiveSummary::state).orElse(null),
                latest.map(FirmwareCalibrationResultRecord::firmwareState).orElse(null)
        );
        String latestResult = latest.map(FirmwareCalibrationResultRecord::result).map(FirmwareCalibrationService::normalize).orElse(null);

        if (!hasFirmwareReadinessEvidence(firmwareState, latestResult)) {
            return Optional.empty();
        }

        if (!determineReadyForSession(firmwareState, latestResult)) {
            if (firmwareState != null) {
                return Optional.of("Device " + normalizedDeviceId + " is not ready for a session (firmwareState=" + firmwareState + ")");
            }
            return Optional.of("Device " + normalizedDeviceId + " is not ready for a session (latest calibration result=" + latestResult + ")");
        }

        return Optional.empty();
    }

    private static boolean determineReadyForSession(String firmwareState, String latestResult) {
        String normalizedState = normalize(firmwareState);
        String normalizedResult = normalize(latestResult);

        if ("FAIL".equalsIgnoreCase(nullToBlank(normalizedResult)) || "CANCELLED".equalsIgnoreCase(nullToBlank(normalizedResult))) {
            return false;
        }

        if (normalizedState != null) {
            if ("READY_FOR_SESSION".equalsIgnoreCase(normalizedState)) {
                return true;
            }
            if (
                    "CALIBRATING".equalsIgnoreCase(normalizedState) ||
                    "CALIBRATION_FAIL".equalsIgnoreCase(normalizedState) ||
                    "ERROR".equalsIgnoreCase(normalizedState) ||
                    "SESSION_ACTIVE".equalsIgnoreCase(normalizedState)
            ) {
                return false;
            }
        }

        return "PASS".equalsIgnoreCase(nullToBlank(normalizedResult));
    }

    private static boolean hasFirmwareReadinessEvidence(String firmwareState, String latestResult) {
        String normalizedState = normalize(firmwareState);
        return normalizedState != null && isFirmwareState(normalizedState) || normalize(latestResult) != null;
    }

    private static boolean isFirmwareState(String value) {
        try {
            FirmwareState.valueOf(value.trim().toUpperCase(Locale.ROOT));
            return true;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static String latestErrorId(ManikinLiveSummary summary, FirmwareCalibrationResultRecord result) {
        if (result != null && result.reasonId() != null && !"00000".equals(result.reasonId())) {
            return result.reasonId();
        }
        return null;
    }

    private static String requireDeviceId(String deviceId) {
        String normalized = normalize(deviceId);
        if (normalized == null) {
            throw new IllegalArgumentException("deviceId is required");
        }
        return normalized;
    }

    private static Integer requireInteger(Integer value, String message) {
        if (value == null) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }

    private static Integer requirePositiveInteger(Integer value, String message) {
        if (value == null || value <= 0) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }

    private static Integer coalesce(Integer first, Integer second) {
        return first != null ? first : second;
    }

    private static String firstNonBlank(String first, String second) {
        String normalizedFirst = normalize(first);
        return normalizedFirst != null ? normalizedFirst : normalize(second);
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String nullToBlank(String value) {
        return value == null ? "" : value;
    }

    private static String toIso(Instant instant) {
        return instant == null ? null : instant.toString();
    }
}
