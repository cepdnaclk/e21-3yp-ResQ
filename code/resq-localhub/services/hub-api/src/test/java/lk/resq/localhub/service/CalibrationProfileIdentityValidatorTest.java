package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class CalibrationProfileIdentityValidatorTest {

    private TestProfileRepository repository;
    private CalibrationProfileFingerprintService fingerprintService;
    private CalibrationProfileIdentityValidator validator;

    private static class TestProfileRepository extends CalibrationProfileRepository {
        private CalibrationProfileRecord recordToReturn;
        public TestProfileRepository() {
            super(java.nio.file.Path.of("target", "validator-repo-test-" + java.util.UUID.randomUUID() + ".sqlite").toString());
        }
        public void setRecordToReturn(CalibrationProfileRecord record) {
            this.recordToReturn = record;
        }
        @Override
        public synchronized Optional<CalibrationProfileRecord> findById(String profileId) {
            if ("nonexistent".equals(profileId)) {
                return Optional.empty();
            }
            return Optional.ofNullable(recordToReturn);
        }
    }

    @BeforeEach
    void setUp() {
        repository = new TestProfileRepository();
        fingerprintService = new CalibrationProfileFingerprintService();
        validator = new CalibrationProfileIdentityValidator(repository, fingerprintService);
    }

    @Test
    void testValidCalibrationSucceeds() {
        CalibrationProfileRecord record = new CalibrationProfileRecord(
                "adult-basic", "Adult Basic", 13500, 20100, 15000, 15000,
                "Description", true, true, "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z", 1
        );
        repository.setRecordToReturn(record);

        String expectedHash = fingerprintService.computeHash(record);

        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, // schemaVersion
                10, // generation
                "VALID", // storageStatus
                false, // recalibrationRequired
                "adult-basic", // profileId
                1, // profileVersion
                expectedHash // profileHash
        );

        assertThat(result.valid()).isTrue();
        assertThat(result.profile()).isEqualTo(record);
        assertThat(result.errorCode()).isNull();
    }

    @Test
    void testInvalidSchemaVersionRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                2, 10, "VALID", false, "adult-basic", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("SCHEMA_VERSION_INVALID");
    }

    @Test
    void testInvalidGenerationRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 0, "VALID", false, "adult-basic", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("GENERATION_INVALID");
    }

    @Test
    void testInvalidStorageStatusRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "MISSING", false, "adult-basic", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("STORAGE_STATUS_INVALID");
    }

    @Test
    void testRecalibrationRequiredRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", true, "adult-basic", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("RECALIBRATION_REQUIRED");
    }

    @Test
    void testInvalidProfileIdFormatRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "invalid id space", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("PROFILE_ID_INVALID");
    }

    @Test
    void testProfileIdLengthRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "a12345678901234567890123456789012", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("PROFILE_ID_INVALID");
    }

    @Test
    void testProfileNotFoundRejects() {
        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "nonexistent", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("PROFILE_NOT_FOUND");
    }

    @Test
    void testProfileVersionMismatchRejects() {
        CalibrationProfileRecord record = new CalibrationProfileRecord(
                "adult-basic", "Adult Basic", 13500, 20100, 15000, 15000,
                "Description", true, true, "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z", 2
        );
        repository.setRecordToReturn(record);

        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "adult-basic", 1, "hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("PROFILE_VERSION_MISMATCH");
    }

    @Test
    void testInvalidHashFormatRejects() {
        CalibrationProfileRecord record = new CalibrationProfileRecord(
                "adult-basic", "Adult Basic", 13500, 20100, 15000, 15000,
                "Description", true, true, "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z", 1
        );
        repository.setRecordToReturn(record);

        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "adult-basic", 1, "short_hash"
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("HASH_INVALID_FORMAT");
    }

    @Test
    void testHashAllZerosRejects() {
        CalibrationProfileRecord record = new CalibrationProfileRecord(
                "adult-basic", "Adult Basic", 13500, 20100, 15000, 15000,
                "Description", true, true, "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z", 1
        );
        repository.setRecordToReturn(record);

        String allZerosHash = "0000000000000000000000000000000000000000000000000000000000000000";

        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "adult-basic", 1, allZerosHash
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("HASH_ALL_ZEROS");
    }

    @Test
    void testFingerprintMismatchRejects() {
        CalibrationProfileRecord record = new CalibrationProfileRecord(
                "adult-basic", "Adult Basic", 13500, 20100, 15000, 15000,
                "Description", true, true, "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z", 1
        );
        repository.setRecordToReturn(record);

        String wrongHash = "a9c9747c1ede10bf156a16e33f67f39bc21694d42fc91a35be50df7d7e24ca4a";

        CalibrationProfileIdentityValidator.ValidationResult result = validator.validate(
                1, 10, "VALID", false, "adult-basic", 1, wrongHash
        );
        assertThat(result.valid()).isFalse();
        assertThat(result.errorCode()).isEqualTo("FINGERPRINT_MISMATCH");
    }
}
