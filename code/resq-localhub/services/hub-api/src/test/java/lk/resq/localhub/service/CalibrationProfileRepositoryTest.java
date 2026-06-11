package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CalibrationProfileRepositoryTest {

    @Test
    void initializeCreatesDefaultProfileWhenTableIsEmpty() {
        CalibrationProfileRepository repository = newRepository();

        assertThat(repository.countProfiles()).isEqualTo(1);

        CalibrationProfileRecord defaultProfile = repository.findDefaultProfile().orElseThrow();
        assertThat(defaultProfile.profileId()).isEqualTo("adult-basic");
        assertThat(defaultProfile.name()).isEqualTo("Adult Basic");
        assertThat(defaultProfile.hallDelta()).isEqualTo(620);
        assertThat(defaultProfile.refPressure()).isEqualTo(20100);
        assertThat(defaultProfile.bladder1Pressure()).isEqualTo(15000);
        assertThat(defaultProfile.bladder2Pressure()).isEqualTo(15000);
        assertThat(defaultProfile.active()).isTrue();
        assertThat(defaultProfile.defaultProfile()).isTrue();
    }

    @Test
    void initializeMigratesLegacyImpossibleHallDelta() {
        CalibrationProfileRepository repository = newRepository();
        CalibrationProfileRecord profile = repository.findDefaultProfile().orElseThrow();
        repository.updateProfile(new CalibrationProfileRecord(
                profile.profileId(),
                profile.name(),
                13500,
                profile.refPressure(),
                profile.bladder1Pressure(),
                profile.bladder2Pressure(),
                profile.description(),
                profile.active(),
                profile.defaultProfile(),
                profile.createdAt(),
                profile.updatedAt()
        ));

        repository.initialize();

        assertThat(repository.findDefaultProfile().orElseThrow().hallDelta()).isEqualTo(620);
    }

    @Test
    void listProfilesReturnsTheDefaultProfile() {
        CalibrationProfileRepository repository = newRepository();

        assertThat(repository.findAll())
                .hasSize(1)
                .first()
                .extracting(CalibrationProfileRecord::profileId)
                .isEqualTo("adult-basic");
    }

    private CalibrationProfileRepository newRepository() {
        CalibrationProfileRepository repository = new CalibrationProfileRepository(
                Path.of("target", "calibration-profile-repository-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return repository;
    }
}
