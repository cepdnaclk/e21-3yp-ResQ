package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.CalibrationProfileRequest;
import lk.resq.localhub.model.firmware.CalibrationProfileResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CalibrationProfileRepository;
import lk.resq.localhub.service.CalibrationProfileService;
import lk.resq.localhub.service.LocalAuthRepository;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CalibrationProfileControllerTest {

    @Test
    void listProfilesReturnsDefaultProfile() {
        Fixture fixture = newFixture();

        var response = fixture.controller.listProfiles(null);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isInstanceOf(List.class);
        assertThat((List<?>) response.getBody()).hasSize(1);
    }

    @Test
    void createProfileReturnsCreatedProfile() {
        Fixture fixture = newFixture();

        var response = fixture.controller.createProfile(null, new CalibrationProfileRequest(
                "Trainer",
                14000,
                20500,
                15200,
                15200,
                "Custom",
                true,
                false
        ));

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        CalibrationProfileResponse body = (CalibrationProfileResponse) response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.name()).isEqualTo("Trainer");
    }

    private Fixture newFixture() {
        ObjectMapper objectMapper = new ObjectMapper();
        CalibrationProfileRepository repository = new CalibrationProfileRepository(
                Path.of("target", "calibration-profile-controller-test-" + UUID.randomUUID() + ".sqlite").toString()
        );
        repository.initialize();
        CalibrationProfileService service = new CalibrationProfileService(repository);
        CalibrationProfileController controller = new CalibrationProfileController(service, new AllowingAuthService(objectMapper));
        return new Fixture(controller);
    }

    private static final class AllowingAuthService extends AuthService {
        private AllowingAuthService(ObjectMapper objectMapper) {
            super(
                    new LocalAuthRepository(Path.of("target", "calibration-profile-controller-auth-" + UUID.randomUUID() + ".sqlite").toString()),
                    objectMapper,
                    8
            );
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            return new AuthUser("instructor", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        }
    }

    private record Fixture(CalibrationProfileController controller) {
    }
}