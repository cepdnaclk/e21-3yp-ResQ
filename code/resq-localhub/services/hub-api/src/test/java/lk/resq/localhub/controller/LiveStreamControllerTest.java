package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.CalibrationStreamService;
import lk.resq.localhub.service.DeviceReadinessService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.ManikinRegistryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LiveStreamControllerTest {

    private CalibrationStreamService calibrationStreamService;
    private AllowingAuthService authService;
    private LiveStreamController controller;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper();
        
        LiveStreamService liveStreamService = new DummyLiveStreamService();
        ManikinRegistryService registryService = new DummyManikinRegistryService();
        ActiveSessionService sessionService = new DummyActiveSessionService();
        DeviceReadinessService readinessService = new DeviceReadinessService();
        calibrationStreamService = new CalibrationStreamService(readinessService);
        
        authService = new AllowingAuthService(objectMapper);
        controller = new LiveStreamController(
                liveStreamService,
                registryService,
                sessionService,
                authService,
                calibrationStreamService
        );
    }

    @Test
    void streamCalibrationReturnsOkAndSseEmitter() {
        ResponseEntity<SseEmitter> response = controller.streamCalibration(null, "M01");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
    }

    @Test
    void streamCalibrationReturnsForbiddenForInvalidRole() {
        authService.setAllowedRole(UserRole.TRAINEE);

        ResponseEntity<SseEmitter> response = controller.streamCalibration(null, "M01");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).isNull();
    }

    private static final class DummyLiveStreamService extends LiveStreamService {
        private DummyLiveStreamService() {
            super();
        }
    }

    private static final class DummyManikinRegistryService extends ManikinRegistryService {
        private DummyManikinRegistryService() {
            super(12);
        }
    }

    private static final class DummyActiveSessionService extends ActiveSessionService {
        private DummyActiveSessionService() {
            super(null, null, null, null, null, null, null);
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private UserRole role = UserRole.INSTRUCTOR;

        private AllowingAuthService(ObjectMapper objectMapper) {
            super(
                    new LocalAuthRepository(Path.of("target", "livestream-controller-auth-test-" + UUID.randomUUID() + ".sqlite").toString()),
                    objectMapper,
                    8
            );
        }

        public void setAllowedRole(UserRole role) {
            this.role = role;
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            boolean allowed = false;
            for (UserRole r : allowedRoles) {
                if (r == this.role) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) {
                throw new ForbiddenException("Access Denied");
            }
            return new AuthUser("user-1", "user-1", "Instructor/Admin", this.role, null);
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        }
    }
}
