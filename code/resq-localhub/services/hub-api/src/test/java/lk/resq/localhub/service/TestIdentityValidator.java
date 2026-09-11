package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;

public class TestIdentityValidator extends CalibrationProfileIdentityValidator {
    private boolean valid = true;
    private String errorCode = null;
    private String errorMessage = null;
    private CalibrationProfileRecord profile = null;

    public TestIdentityValidator() {
        super(null, null);
    }

    public TestIdentityValidator(boolean valid, String errorCode, String errorMessage, CalibrationProfileRecord profile) {
        super(null, null);
        this.valid = valid;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        this.profile = profile;
    }

    public void setValid(boolean valid) {
        this.valid = valid;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public void setProfile(CalibrationProfileRecord profile) {
        this.profile = profile;
    }

    @Override
    public ValidationResult validate(
            Integer schemaVersion,
            Integer generation,
            String storageStatus,
            Boolean recalibrationRequired,
            String profileId,
            Integer profileVersion,
            String profileHash
    ) {
        if (!valid) {
            return new ValidationResult(false, errorCode, errorMessage, null);
        }
        if (profileId == null) {
            return new ValidationResult(false, "CALIBRATION_PROFILE_UNKNOWN", "Cannot verify the calibrated profile", null);
        }
        CalibrationProfileRecord actualProfile = profile;
        if (actualProfile == null) {
            actualProfile = new CalibrationProfileRecord(
                    profileId,
                    profileId,
                    13500,
                    20100,
                    15000,
                    15000,
                    "Description",
                    true,
                    true,
                    java.time.Instant.now().toString(),
                    java.time.Instant.now().toString(),
                    profileVersion != null ? profileVersion : 1
            );
        }
        return new ValidationResult(valid, errorCode, errorMessage, actualProfile);
    }
}
