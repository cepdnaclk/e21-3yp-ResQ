package lk.resq.localhub.service;

import lk.resq.localhub.model.ManikinLiveSummary;
import lk.resq.localhub.model.firmware.CalibrationProfileResponse;
import lk.resq.localhub.model.firmware.FirmwareCalibrationCommandResponse;
import lk.resq.localhub.model.firmware.FirmwareCalibrationResultRecord;
import lk.resq.localhub.model.firmware.FirmwareCalibrationStartRequest;
import lk.resq.localhub.model.firmware.FirmwareReadinessResponse;
import lk.resq.localhub.model.firmware.FirmwareState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;

@Service
public class FirmwareCalibrationService {

    private static final Logger logger = LoggerFactory.getLogger(FirmwareCalibrationService.class);

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
        ensureDeviceOnline(normalizedDeviceId);
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
        warnIfSuspiciousPressureScale(normalizedDeviceId, refPressure, bladder1Pressure, bladder2Pressure);

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
        ensureDeviceOnline(normalizedDeviceId);
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
        String latestResult = firstNonBlank(result == null ? null : result.result(), summary.map(ManikinLiveSummary::calibrationResult).orElse(null));
        boolean calibrated = Boolean.TRUE.equals(result == null ? null : result.calibrated())
                || summary.map(ManikinLiveSummary::calibrated).orElse(null) == Boolean.TRUE
                || "PASS".equalsIgnoreCase(nullToBlank(latestResult))
                || "PASS_WITH_WARNINGS".equalsIgnoreCase(nullToBlank(latestResult));
        boolean readyForSession = determineReadyForSession(firmwareState, latestResult)
                || summary.map(ManikinLiveSummary::readyForSession).orElse(null) == Boolean.TRUE;

        return new FirmwareReadinessResponse(
                normalizedDeviceId,
                firmwareState,
                calibrated,
                readyForSession,
                latestResult,
                result != null && result.progressId() != null ? result.progressId() : summary.map(ManikinLiveSummary::progressId).orElse(null),
                result != null && result.reasonId() != null ? result.reasonId() : summary.map(ManikinLiveSummary::reasonId).orElse(null),
                result != null && result.actionId() != null ? result.actionId() : summary.map(ManikinLiveSummary::actionId).orElse(null),
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
        String latestResult = firstNonBlank(
                latest.map(FirmwareCalibrationResultRecord::result).orElse(null),
                summary.map(ManikinLiveSummary::calibrationResult).orElse(null)
        );

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

        if ("READY_FOR_SESSION".equalsIgnoreCase(nullToBlank(normalizedState))) {
            return true;
        }

        if ("FAIL".equalsIgnoreCase(nullToBlank(normalizedResult)) || "CANCELLED".equalsIgnoreCase(nullToBlank(normalizedResult))) {
            return false;
        }

        if (normalizedState != null) {
            if (
                    "CALIBRATING".equalsIgnoreCase(normalizedState) ||
                    "CALIBRATION_FAIL".equalsIgnoreCase(normalizedState) ||
                    "ERROR".equalsIgnoreCase(normalizedState) ||
                    "SESSION_ACTIVE".equalsIgnoreCase(normalizedState)
            ) {
                return false;
            }
        }

        return "PASS".equalsIgnoreCase(nullToBlank(normalizedResult))
                || "PASS_WITH_WARNINGS".equalsIgnoreCase(nullToBlank(normalizedResult));
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

    private void ensureDeviceOnline(String deviceId) {
        ManikinLiveSummary liveSummary = manikinRegistryService.getLiveSummary(deviceId)
                .orElseThrow(() -> new IllegalArgumentException("Device " + deviceId + " is not registered"));

        boolean online = liveSummary.online() && !liveSummary.offline() && !liveSummary.stale();
        if (!online) {
            throw new IllegalArgumentException("Device " + deviceId + " is offline or unavailable");
        }
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

    private static void warnIfSuspiciousPressureScale(String deviceId, Integer refPressure, Integer bladder1Pressure, Integer bladder2Pressure) {
        if (refPressure < CalibrationConstraints.SUSPICIOUS_PRESSURE_TARGET_BELOW_RAW
                || bladder1Pressure < CalibrationConstraints.SUSPICIOUS_PRESSURE_TARGET_BELOW_RAW
                || bladder2Pressure < CalibrationConstraints.SUSPICIOUS_PRESSURE_TARGET_BELOW_RAW) {
            logger.warn(
                    "Calibration targets for device {} look below the current firmware raw HX710 scale: refPressure={}, bladder1Pressure={}, bladder2Pressure={}",
                    deviceId,
                    refPressure,
                    bladder1Pressure,
                    bladder2Pressure
            );
        }
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
