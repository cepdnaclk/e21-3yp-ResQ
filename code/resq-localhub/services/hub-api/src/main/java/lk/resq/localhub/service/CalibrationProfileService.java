package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;
import lk.resq.localhub.model.firmware.CalibrationProfileRequest;
import lk.resq.localhub.model.firmware.CalibrationProfileResponse;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class CalibrationProfileService {

    private final CalibrationProfileRepository calibrationProfileRepository;

    public CalibrationProfileService(CalibrationProfileRepository calibrationProfileRepository) {
        this.calibrationProfileRepository = calibrationProfileRepository;
    }

    public List<CalibrationProfileResponse> listProfiles() {
        return calibrationProfileRepository.findAll().stream().map(this::toResponse).toList();
    }

    public Optional<CalibrationProfileResponse> getProfile(String profileId) {
        return calibrationProfileRepository.findById(requireProfileId(profileId)).map(this::toResponse);
    }

    public Optional<CalibrationProfileResponse> getDefaultProfile() {
        return calibrationProfileRepository.findDefaultProfile().map(this::toResponse);
    }

    public CalibrationProfileResponse createProfile(CalibrationProfileRequest request) {
        String now = Instant.now().toString();
        CalibrationProfileRecord record = buildRecord(UUID.randomUUID().toString(), request, now, now, false);
        calibrationProfileRepository.insertProfile(record);
        return toResponse(record);
    }

    public CalibrationProfileResponse updateProfile(String profileId, CalibrationProfileRequest request) {
        String normalizedProfileId = requireProfileId(profileId);
        CalibrationProfileRecord existing = calibrationProfileRepository.findById(normalizedProfileId)
                .orElseThrow(() -> new IllegalArgumentException("Calibration profile not found: " + normalizedProfileId));

        CalibrationProfileRecord updated = buildUpdatedRecord(existing, request, Instant.now().toString());
        calibrationProfileRepository.updateProfile(updated);
        return toResponse(updated);
    }

    public CalibrationProfileResponse setDefaultProfile(String profileId) {
        String normalizedProfileId = requireProfileId(profileId);
        CalibrationProfileRecord existing = calibrationProfileRepository.findById(normalizedProfileId)
                .orElseThrow(() -> new IllegalArgumentException("Calibration profile not found: " + normalizedProfileId));

        String now = Instant.now().toString();
        CalibrationProfileRecord updated = new CalibrationProfileRecord(
                existing.profileId(),
                existing.name(),
                existing.hallDelta(),
                existing.refPressure(),
                existing.bladder1Pressure(),
                existing.bladder2Pressure(),
                existing.description(),
                true,
                true,
                existing.createdAt(),
                now
        );
        calibrationProfileRepository.setDefaultProfile(normalizedProfileId, now);
        return toResponse(updated);
    }

    public CalibrationProfileResponse deleteOrDeactivateProfile(String profileId) {
        String normalizedProfileId = requireProfileId(profileId);
        CalibrationProfileRecord existing = calibrationProfileRepository.findById(normalizedProfileId)
                .orElseThrow(() -> new IllegalArgumentException("Calibration profile not found: " + normalizedProfileId));

        if (existing.defaultProfile()) {
            throw new IllegalArgumentException("Select another default profile before deactivating the current default profile");
        }

        long activeProfiles = calibrationProfileRepository.countActiveProfiles();
        if (existing.active() && activeProfiles <= 1) {
            throw new IllegalArgumentException("At least one active calibration profile must remain available");
        }

        String now = Instant.now().toString();
        calibrationProfileRepository.deactivateProfile(normalizedProfileId, now);
        return toResponse(new CalibrationProfileRecord(
                existing.profileId(),
                existing.name(),
                existing.hallDelta(),
                existing.refPressure(),
                existing.bladder1Pressure(),
                existing.bladder2Pressure(),
                existing.description(),
                false,
                existing.defaultProfile(),
                existing.createdAt(),
                now
        ));
    }

    public Optional<CalibrationProfileRecord> getProfileRecord(String profileId) {
        return calibrationProfileRepository.findById(requireProfileId(profileId));
    }

    public Optional<CalibrationProfileRecord> getDefaultProfileRecord() {
        return calibrationProfileRepository.findDefaultProfile();
    }

    private CalibrationProfileRecord buildUpdatedRecord(CalibrationProfileRecord existing, CalibrationProfileRequest request, String updatedAt) {
        String name = firstNonBlank(request == null ? null : request.name(), existing.name());
        Integer hallDelta = request != null && request.hallDelta() != null ? request.hallDelta() : existing.hallDelta();
        Integer refPressure = request != null && request.refPressure() != null ? request.refPressure() : existing.refPressure();
        Integer bladder1Pressure = request != null && request.bladder1Pressure() != null ? request.bladder1Pressure() : existing.bladder1Pressure();
        Integer bladder2Pressure = request != null && request.bladder2Pressure() != null ? request.bladder2Pressure() : existing.bladder2Pressure();
        String description = request != null && request.description() != null ? request.description() : existing.description();
        boolean active = request != null && request.active() != null ? request.active() : existing.active();
        boolean defaultProfile = existing.defaultProfile();

        validate(name, hallDelta, refPressure, bladder1Pressure, bladder2Pressure);

        if (existing.defaultProfile() && request != null && Boolean.FALSE.equals(request.active())) {
            throw new IllegalArgumentException("Select another default profile before deactivating the current default profile");
        }

        if (request != null && Boolean.TRUE.equals(request.defaultProfile())) {
            defaultProfile = true;
        }

        if (!active && defaultProfile) {
            throw new IllegalArgumentException("Default calibration profiles must remain active");
        }

        return new CalibrationProfileRecord(
                existing.profileId(),
                name,
                hallDelta,
                refPressure,
                bladder1Pressure,
                bladder2Pressure,
                description,
                active,
                defaultProfile,
                existing.createdAt(),
                updatedAt
        );
    }

    private CalibrationProfileRecord buildRecord(String profileId, CalibrationProfileRequest request, String createdAt, String updatedAt, boolean defaultProfile) {
        String name = request == null ? null : request.name();
        Integer hallDelta = request == null ? null : request.hallDelta();
        Integer refPressure = request == null ? null : request.refPressure();
        Integer bladder1Pressure = request == null ? null : request.bladder1Pressure();
        Integer bladder2Pressure = request == null ? null : request.bladder2Pressure();
        String description = request == null ? null : request.description();
        boolean active = request == null || request.active() == null || request.active();
        boolean requestedDefault = request != null && Boolean.TRUE.equals(request.defaultProfile());
        boolean resolvedDefault = defaultProfile || requestedDefault;

        validate(name, hallDelta, refPressure, bladder1Pressure, bladder2Pressure);

        if (resolvedDefault && !active) {
            active = true;
        }

        return new CalibrationProfileRecord(
                profileId,
                name.trim(),
                hallDelta,
                refPressure,
                bladder1Pressure,
                bladder2Pressure,
                description,
                active,
                resolvedDefault,
                createdAt,
                updatedAt
        );
    }

    private void validate(String name, Integer hallDelta, Integer refPressure, Integer bladder1Pressure, Integer bladder2Pressure) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("name is required");
        }
        CalibrationConstraints.requireHallDelta(hallDelta);
        requirePositive(refPressure, "refPressure must be greater than 0");
        requirePositive(bladder1Pressure, "bladder1Pressure must be greater than 0");
        requirePositive(bladder2Pressure, "bladder2Pressure must be greater than 0");
    }

    private static Integer requirePositive(Integer value, String message) {
        if (value == null || value <= 0) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }

    private static String firstNonBlank(String value, String fallback) {
        if (value != null && !value.trim().isEmpty()) {
            return value.trim();
        }
        return fallback;
    }

    private static String requireProfileId(String profileId) {
        if (profileId == null || profileId.trim().isEmpty()) {
            throw new IllegalArgumentException("profileId is required");
        }
        return profileId.trim();
    }

    private CalibrationProfileResponse toResponse(CalibrationProfileRecord record) {
        return new CalibrationProfileResponse(
                record.profileId(),
                record.name(),
                record.hallDelta(),
                record.refPressure(),
                record.bladder1Pressure(),
                record.bladder2Pressure(),
                record.description(),
                record.active(),
                record.defaultProfile(),
                record.createdAt(),
                record.updatedAt()
        );
    }
}
