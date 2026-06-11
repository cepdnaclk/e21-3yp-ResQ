package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRequest;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CalibrationProfileServiceTest {

    @Test
    void createProfileValidatesPositiveValues() {
        CalibrationProfileService service = newService();

        assertThatThrownBy(() -> service.createProfile(new CalibrationProfileRequest(
                "Invalid",
                0,
                20100,
                15000,
                15000,
                null,
                true,
                false
        ))).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("hallDelta");

        assertThatThrownBy(() -> service.createProfile(new CalibrationProfileRequest(
                "Invalid",
                4096,
                20100,
                15000,
                15000,
                null,
                true,
                false
        ))).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("4095");
    }

    @Test
    void updateProfileWorksAndSetDefaultClearsPreviousDefault() {
        CalibrationProfileService service = newService();
        var created = service.createProfile(new CalibrationProfileRequest(
                "Training Profile",
                700,
                20500,
                15200,
                15200,
                "Training",
                true,
                false
        ));

        var updated = service.updateProfile(created.profileId(), new CalibrationProfileRequest(
                "Training Profile v2",
                710,
                20600,
                15300,
                15300,
                "Training updated",
                false,
                false
        ));
        assertThat(updated.name()).isEqualTo("Training Profile v2");
        assertThat(updated.active()).isFalse();

        var defaultProfile = service.setDefaultProfile(created.profileId());
        assertThat(defaultProfile.defaultProfile()).isTrue();
        assertThat(service.getDefaultProfile().orElseThrow().profileId()).isEqualTo(created.profileId());
    }

    @Test
    void deleteOrDeactivateProfileRejectsRemovingOnlyActiveDefaultProfile() {
        CalibrationProfileService service = newService();

        assertThatThrownBy(() -> service.deleteOrDeactivateProfile("adult-basic"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("default profile");
    }

    private CalibrationProfileService newService() {
        CalibrationProfileRepository repository = new CalibrationProfileRepository(
                Path.of("target", "calibration-profile-service-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        return new CalibrationProfileService(repository);
    }
}
