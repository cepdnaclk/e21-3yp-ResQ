package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.TraineeRecord;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.TraineeRecordsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.io.IOException;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class TraineeControllerTest {

    private Fixture fixture;

    @BeforeEach
    void setUp() throws Exception {
        fixture = new Fixture();
    }

    @Test
    void listTraineesReturnsForbiddenForTrainee() {
        fixture.authService.setRole(UserRole.TRAINEE);

        ResponseEntity<?> response = fixture.controller.listTrainees(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("Insufficient permissions");
    }

    @Test
    void listTraineesReturnsDatabaseErrorWhenRepositoryFails() {
        fixture.repository.listError = new SQLException("boom");

        ResponseEntity<?> response = fixture.controller.listTrainees(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("Database error: boom");
    }

    @Test
    void getTraineeReturnsNotFoundWhenRepositoryHasNoRecord() {
        fixture.repository.findByIdResult = Optional.empty();

        ResponseEntity<?> response = fixture.controller.getTrainee(null, "missing-1");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("missing-1");
    }

    @Test
    void createTraineeRejectsBlankCode() {
        ResponseEntity<?> response = fixture.controller.createTrainee(null, new TraineeController.CreateTraineeRequest(" ", "Jane", null, null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("traineeCode is required");
    }

    @Test
    void createTraineeRejectsBlankDisplayName() {
        ResponseEntity<?> response = fixture.controller.createTrainee(null, new TraineeController.CreateTraineeRequest("T-001", "", null, null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("displayName is required");
    }

    @Test
    void createTraineeReturnsConflictForDuplicateCode() {
        fixture.repository.createError = new SQLException("UNIQUE constraint failed: trainee_records.trainee_code");

        ResponseEntity<?> response = fixture.controller.createTrainee(null, new TraineeController.CreateTraineeRequest("T-001", "Jane", null, null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("Trainee code already exists");
    }

    @Test
    void updateTraineeReturnsNotFoundWhenRepositoryRejectsId() {
        fixture.repository.updateRuntimeError = new IllegalArgumentException("Trainee record not found: missing-1");

        ResponseEntity<?> response = fixture.controller.updateTrainee(null, "missing-1", new TraineeController.UpdateTraineeRequest("Jane", "G1", "notes"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("missing-1");
    }

    @Test
    void archiveTraineeReturnsNoContent() {
        ResponseEntity<?> response = fixture.controller.archiveTrainee(null, "trainee-1");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(fixture.repository.archivedId).isEqualTo("trainee-1");
    }

    private static final class Fixture {
        private final FakeTraineeRecordsRepository repository;
        private final AllowingAuthService authService;
        private final TraineeController controller;

        private Fixture() throws Exception {
            repository = new FakeTraineeRecordsRepository();
            authService = new AllowingAuthService(new ObjectMapper());
            controller = new TraineeController(repository, authService);
        }
    }

    private static final class FakeTraineeRecordsRepository extends TraineeRecordsRepository {
        private List<TraineeRecord> listResult = List.of();
        private Optional<TraineeRecord> findByIdResult = Optional.empty();
        private TraineeRecord createResult = new TraineeRecord("id-1", "T-001", "Jane", null, null, "now", "now", null);
        private TraineeRecord updateResult = createResult;
        private SQLException listError;
        private SQLException findError;
        private SQLException createError;
        private RuntimeException updateRuntimeError;
        private SQLException archiveError;
        private String archivedId;

        private FakeTraineeRecordsRepository() throws IOException {
            super();
        }

        @Override
        public List<TraineeRecord> listActiveTrainees() throws SQLException {
            if (listError != null) {
                throw listError;
            }
            return listResult;
        }

        @Override
        public Optional<TraineeRecord> findTraineeById(String id) throws SQLException {
            if (findError != null) {
                throw findError;
            }
            return findByIdResult;
        }

        @Override
        public TraineeRecord createTrainee(String traineeCode, String displayName, String groupName, String notes) throws SQLException {
            if (createError != null) {
                throw createError;
            }
            return createResult;
        }

        @Override
        public TraineeRecord updateTrainee(String id, String displayName, String groupName, String notes) throws SQLException {
            if (updateRuntimeError != null) {
                throw updateRuntimeError;
            }
            return updateResult;
        }

        @Override
        public void archiveTrainee(String id) throws SQLException {
            if (archiveError != null) {
                throw archiveError;
            }
            archivedId = id;
        }
    }

    private static final class AllowingAuthService extends AuthService {
        private UserRole role = UserRole.INSTRUCTOR;

        private AllowingAuthService(ObjectMapper objectMapper) throws Exception {
            super(new lk.resq.localhub.service.LocalAuthRepository(Path.of("target", "trainee-controller-auth-" + UUID.randomUUID() + ".sqlite").toString()), objectMapper, 8);
        }

        void setRole(UserRole role) {
            this.role = role;
        }

        @Override
        public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
            for (UserRole allowedRole : allowedRoles) {
                if (allowedRole == role) {
                    return new AuthUser("actor-1", "actor", "Actor", role, null);
                }
            }
            throw new ForbiddenException("Access denied");
        }

        @Override
        public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        }
    }
}