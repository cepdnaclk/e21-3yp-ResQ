package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import java.util.Optional;

@Component
public class CalibrationProfileIdentityValidator {

    private final CalibrationProfileRepository profileRepository;
    private final CalibrationProfileFingerprintService fingerprintService;

    @Autowired
    public CalibrationProfileIdentityValidator(
            CalibrationProfileRepository profileRepository,
            CalibrationProfileFingerprintService fingerprintService) {
        this.profileRepository = profileRepository;
        this.fingerprintService = fingerprintService;
    }

    public ValidationResult validate(
            Integer schemaVersion,
            Integer generation,
            String storageStatus,
            Boolean recalibrationRequired,
            String profileId,
            Integer profileVersion,
            String profileHash
    ) {
        // schema version exactly 1
        if (schemaVersion == null || schemaVersion != 1) {
            return ValidationResult.failure("SCHEMA_VERSION_INVALID", "Schema version must be exactly 1");
        }
        // generation > 0
        if (generation == null || generation <= 0) {
            return ValidationResult.failure("GENERATION_INVALID", "Generation must be greater than 0");
        }
        // storage status exactly VALID
        if (!"VALID".equals(storageStatus)) {
            return ValidationResult.failure("STORAGE_STATUS_INVALID", "Storage status must be VALID");
        }
        // recalibrationRequired exactly false
        if (recalibrationRequired == null || recalibrationRequired) {
            return ValidationResult.failure("RECALIBRATION_REQUIRED", "Recalibration required must be false");
        }
        // profile ID matches [A-Za-z0-9_-]{1,31}
        if (profileId == null || !profileId.matches("^[A-Za-z0-9_-]{1,31}$")) {
            return ValidationResult.failure("PROFILE_ID_INVALID", "Profile ID format is invalid");
        }
        // active profile lookup by ID (exact case-sensitive)
        Optional<CalibrationProfileRecord> profileOpt = profileRepository.findById(profileId);
        if (profileOpt.isEmpty()) {
            return ValidationResult.failure("PROFILE_NOT_FOUND", "Profile not found: " + profileId);
        }
        CalibrationProfileRecord profile = profileOpt.get();
        // active profile version must match metadata version
        if (profileVersion == null || profile.version() != profileVersion) {
            return ValidationResult.failure("PROFILE_VERSION_MISMATCH", "Profile version mismatch");
        }
        // hash must be exactly 64 lowercase hexadecimal characters
        if (profileHash == null || !profileHash.matches("^[0-9a-f]{64}$")) {
            return ValidationResult.failure("HASH_INVALID_FORMAT", "Hash must be exactly 64 lowercase hex characters");
        }
        // hash must not be all zeros
        if (profileHash.matches("^0{64}$")) {
            return ValidationResult.failure("HASH_ALL_ZEROS", "Hash must not be all zeros");
        }
        // expected fingerprint must match computed fingerprint using the active profile values
        String expectedHash = fingerprintService.computeHash(
            profile.profileId(),
            profile.version(),
            profile.hallDelta(),
            profile.refPressure(),
            profile.bladder1Pressure(),
            profile.bladder2Pressure()
        );
        if (!expectedHash.equals(profileHash)) {
            return ValidationResult.failure("FINGERPRINT_MISMATCH", "Fingerprint mismatch");
        }

        return ValidationResult.success(profile);
    }

    public static record ValidationResult(boolean valid, String errorCode, String errorMessage, CalibrationProfileRecord profile) {
        public static ValidationResult success(CalibrationProfileRecord profile) {
            return new ValidationResult(true, null, null, profile);
        }
        public static ValidationResult failure(String errorCode, String errorMessage) {
            return new ValidationResult(false, errorCode, errorMessage, null);
        }
    }
}
