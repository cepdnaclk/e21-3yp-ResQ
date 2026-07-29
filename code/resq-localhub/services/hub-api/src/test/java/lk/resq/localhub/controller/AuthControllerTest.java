package lk.resq.localhub.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthBootstrapResponse;
import lk.resq.localhub.model.AuthStatusResponse;
import lk.resq.localhub.model.AuthTokenIssue;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.CreateFirstAdminRequest;
import lk.resq.localhub.model.CreateUserRequest;
import lk.resq.localhub.model.LoginRequest;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.LocalAuthRepository;
import lk.resq.localhub.service.UnauthorizedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration;
import org.springframework.boot.autoconfigure.security.servlet.SecurityFilterAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = AuthController.class,
        excludeAutoConfiguration = {
                SecurityAutoConfiguration.class,
                SecurityFilterAutoConfiguration.class
        }
)
@Import(AuthControllerTest.TestConfig.class)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private StubAuthService authService;

    @BeforeEach
    void resetStub() {
        authService.reset();
    }

    @Test
    void bootstrapReturnsFirstRunFlag() throws Exception {
        authService.setBootstrapResponse(new AuthBootstrapResponse(true));

        mockMvc.perform(get("/api/auth/bootstrap"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.firstRunRequired").value(true));
    }

    @Test
    void statusReturnsAuthenticationState() throws Exception {
        authService.setStatusResponse(new AuthStatusResponse(true, false));

        mockMvc.perform(get("/api/auth/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasUsers").value(true))
                .andExpect(jsonPath("$.requiresFirstAdmin").value(false));
    }

    @Test
    void loginReturnsCookieAndSessionPayload() throws Exception {
        AuthUser user = new AuthUser("user-1", "instructor@example.com", "Instructor", UserRole.INSTRUCTOR, null);
        Instant expiresAt = Instant.parse("2026-07-29T12:00:00Z");
        authService.setLoginResponse(new AuthTokenIssue(user, "token-123", expiresAt));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("instructor@example.com", "secret"))))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("RESQ_LOCALHUB_AUTH=token-123")))
                .andExpect(jsonPath("$.token").value("token-123"))
                .andExpect(jsonPath("$.user.id").value("user-1"))
                .andExpect(jsonPath("$.user.role").value("INSTRUCTOR"))
                .andExpect(jsonPath("$.expiresAt").value(expiresAt.toString()));
    }

    @Test
    void loginReturnsBadRequestWhenServiceRejectsMissingCredentials() throws Exception {
        authService.setLoginError(new IllegalArgumentException("Username and password are required."));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Username and password are required."));
    }

    @Test
    void loginReturnsBadRequestForMalformedJson() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void setupReturnsSessionCookieForFirstAdmin() throws Exception {
        AuthUser user = new AuthUser("admin-1", "admin", "Admin", UserRole.ADMIN, null);
        Instant expiresAt = Instant.parse("2026-07-29T12:00:00Z");
        authService.setSetupResponse(new AuthTokenIssue(user, "setup-token", expiresAt));

        mockMvc.perform(post("/api/auth/setup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateFirstAdminRequest("admin", "Admin", "secret"))))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("RESQ_LOCALHUB_AUTH=setup-token")))
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andExpect(jsonPath("$.token").value("setup-token"));
    }

    @Test
    void logoutClearsSessionCookie() throws Exception {
        AuthUser user = new AuthUser("user-1", "instructor@example.com", "Instructor", UserRole.INSTRUCTOR, null);
        authService.setRequireAuthResponse(user);

        mockMvc.perform(post("/api/auth/logout"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("RESQ_LOCALHUB_AUTH=")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("Max-Age=0")))
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void logoutReturnsUnauthorizedWhenTokenMissing() throws Exception {
        authService.setRequireAuthError(new UnauthorizedException("Authentication is required."));

        mockMvc.perform(post("/api/auth/logout"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Authentication is required."));
    }

    @Test
    void meReturnsCurrentUser() throws Exception {
        AuthUser user = new AuthUser("user-1", "instructor@example.com", "Instructor", UserRole.INSTRUCTOR, null);
        authService.setRequireAuthResponse(user);

        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("user-1"))
                .andExpect(jsonPath("$.role").value("INSTRUCTOR"));
    }

    @Test
    void meReturnsUnauthorizedWhenSessionInvalid() throws Exception {
        authService.setRequireAuthError(new UnauthorizedException("Authentication is required."));

        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Authentication is required."));
    }

    @Test
    void listUsersReturnsUsersForAdmin() throws Exception {
        AuthUser user = new AuthUser("user-1", "admin@example.com", "Admin", UserRole.ADMIN, null);
        authService.setListUsersResponse(List.of(user));

        mockMvc.perform(get("/api/auth/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].username").value("admin@example.com"))
                .andExpect(jsonPath("$[0].role").value("ADMIN"));
    }

    @Test
    void listUsersReturnsForbiddenForNonAdmin() throws Exception {
        authService.setListUsersError(new ForbiddenException("Access denied."));

        mockMvc.perform(get("/api/auth/users"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Access denied."));
    }

    @Test
    void createUserReturnsCreatedUser() throws Exception {
        AuthUser created = new AuthUser("user-2", "trainee@example.com", "Trainee", UserRole.TRAINEE, null);
        authService.setCreateUserResponse(created);

        mockMvc.perform(post("/api/auth/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUserRequest("trainee@example.com", "Trainee", "secret", UserRole.TRAINEE))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("user-2"))
                .andExpect(jsonPath("$.role").value("TRAINEE"));
    }

    @Test
    void createUserReturnsBadRequestForInvalidPayload() throws Exception {
        authService.setCreateUserError(new IllegalArgumentException("Role is required."));

        mockMvc.perform(post("/api/auth/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUserRequest("trainee@example.com", "Trainee", "secret", null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Role is required."));
    }

    @Test
    void createUserReturnsUnauthorizedWhenNotAuthenticated() throws Exception {
        authService.setCreateUserError(new UnauthorizedException("Authentication is required."));

        mockMvc.perform(post("/api/auth/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUserRequest("trainee@example.com", "Trainee", "secret", UserRole.TRAINEE))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Authentication is required."));
    }

    @Test
    void createUserReturnsForbiddenForNonAdmin() throws Exception {
        authService.setCreateUserError(new ForbiddenException("Access denied."));

        mockMvc.perform(post("/api/auth/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUserRequest("trainee@example.com", "Trainee", "secret", UserRole.TRAINEE))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Access denied."));
    }

    @Test
    void disableUserReturnsUpdatedUser() throws Exception {
        AuthUser disabled = new AuthUser("user-2", "trainee@example.com", "Trainee", UserRole.TRAINEE, "2026-07-29T00:00:00Z");
        authService.setDisableUserResponse(disabled);

        mockMvc.perform(post("/api/auth/users/user-2/disable"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disabledAt").value("2026-07-29T00:00:00Z"));
    }

    @Test
    void disableUserReturnsBadRequestWhenUserMissing() throws Exception {
        authService.setDisableUserError(new IllegalArgumentException("User user-2 was not found."));

        mockMvc.perform(post("/api/auth/users/user-2/disable"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("User user-2 was not found."));
    }

    @Test
    void enableUserReturnsUpdatedUser() throws Exception {
        AuthUser enabled = new AuthUser("user-2", "trainee@example.com", "Trainee", UserRole.TRAINEE, null);
        authService.setEnableUserResponse(enabled);

        mockMvc.perform(post("/api/auth/users/user-2/enable"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("user-2"))
                .andExpect(jsonPath("$.role").value("TRAINEE"));
    }

    @Test
    void setCloudUserPasswordReturnsUpdatedUser() throws Exception {
        AuthUser updated = new AuthUser("cloud-user-1", "cloud@example.com", "Cloud User", UserRole.TRAINEE, null);
        authService.setCloudPasswordResponse(updated);

        mockMvc.perform(post("/api/auth/cloud-users/cloud-user-1/local-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"secret\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("cloud-user-1"));
    }

    @Test
    void setCloudUserPasswordReturnsBadRequestWhenPasswordMissing() throws Exception {
        authService.setCloudPasswordError(new IllegalArgumentException("Password is required."));

        mockMvc.perform(post("/api/auth/cloud-users/cloud-user-1/local-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Password is required."));
    }

    @Test
    void listCloudUsersReturnsCloudRoster() throws Exception {
        AuthUser cloudUser = new AuthUser("cloud-user-1", "cloud@example.com", "Cloud User", UserRole.TRAINEE, null);
        authService.setListCloudUsersResponse(List.of(cloudUser));

        mockMvc.perform(get("/api/auth/cloud-users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("cloud-user-1"));
    }

    @Test
    void listCloudUsersReturnsForbiddenForNonAdmin() throws Exception {
        authService.setListCloudUsersError(new ForbiddenException("Access denied."));

        mockMvc.perform(get("/api/auth/cloud-users"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Access denied."));
    }

    @TestConfiguration
    static class TestConfig {

        @Bean
        StubAuthService authService() throws Exception {
            return new StubAuthService();
        }
    }

    static final class StubAuthService extends AuthService {

        private AuthBootstrapResponse bootstrapResponse = new AuthBootstrapResponse(false);
        private AuthStatusResponse statusResponse = new AuthStatusResponse(true, false);
        private AuthTokenIssue loginResponse;
        private IllegalArgumentException loginError;
        private AuthTokenIssue setupResponse;
        private RuntimeException setupError;
        private AuthUser requireAuthResponse;
        private UnauthorizedException requireAuthError;
        private List<AuthUser> listUsersResponse;
        private RuntimeException listUsersError;
        private AuthUser createUserResponse;
        private RuntimeException createUserError;
        private AuthUser disableUserResponse;
        private RuntimeException disableUserError;
        private AuthUser enableUserResponse;
        private RuntimeException enableUserError;
        private AuthUser cloudPasswordResponse;
        private RuntimeException cloudPasswordError;
        private List<AuthUser> listCloudUsersResponse;
        private RuntimeException listCloudUsersError;

        StubAuthService() throws Exception {
            super(
                    new LocalAuthRepository(java.nio.file.Path.of("target", "auth-controller-test-" + java.util.UUID.randomUUID() + ".sqlite").toString()),
                    new ObjectMapper(),
                    8
            );
        }

        void reset() {
            bootstrapResponse = new AuthBootstrapResponse(false);
            statusResponse = new AuthStatusResponse(true, false);
            loginResponse = null;
            loginError = null;
            setupResponse = null;
            setupError = null;
            requireAuthResponse = null;
            requireAuthError = null;
            listUsersResponse = null;
            listUsersError = null;
            createUserResponse = null;
            createUserError = null;
            disableUserResponse = null;
            disableUserError = null;
            enableUserResponse = null;
            enableUserError = null;
            cloudPasswordResponse = null;
            cloudPasswordError = null;
            listCloudUsersResponse = null;
            listCloudUsersError = null;
        }

        void setBootstrapResponse(AuthBootstrapResponse response) {
            this.bootstrapResponse = response;
        }

        void setStatusResponse(AuthStatusResponse response) {
            this.statusResponse = response;
        }

        void setLoginResponse(AuthTokenIssue response) {
            this.loginResponse = response;
        }

        void setLoginError(IllegalArgumentException error) {
            this.loginError = error;
        }

        void setSetupResponse(AuthTokenIssue response) {
            this.setupResponse = response;
        }

        void setRequireAuthResponse(AuthUser response) {
            this.requireAuthResponse = response;
        }

        void setRequireAuthError(UnauthorizedException error) {
            this.requireAuthError = error;
        }

        void setListUsersResponse(List<AuthUser> response) {
            this.listUsersResponse = response;
        }

        void setListUsersError(RuntimeException error) {
            this.listUsersError = error;
        }

        void setCreateUserResponse(AuthUser response) {
            this.createUserResponse = response;
        }

        void setCreateUserError(RuntimeException error) {
            this.createUserError = error;
        }

        void setDisableUserResponse(AuthUser response) {
            this.disableUserResponse = response;
        }

        void setDisableUserError(RuntimeException error) {
            this.disableUserError = error;
        }

        void setEnableUserResponse(AuthUser response) {
            this.enableUserResponse = response;
        }

        void setEnableUserError(RuntimeException error) {
            this.enableUserError = error;
        }

        void setCloudPasswordResponse(AuthUser response) {
            this.cloudPasswordResponse = response;
        }

        void setCloudPasswordError(RuntimeException error) {
            this.cloudPasswordError = error;
        }

        void setListCloudUsersResponse(List<AuthUser> response) {
            this.listCloudUsersResponse = response;
        }

        void setListCloudUsersError(RuntimeException error) {
            this.listCloudUsersError = error;
        }

        @Override
        public AuthBootstrapResponse bootstrap() {
            return bootstrapResponse;
        }

        @Override
        public AuthStatusResponse status() {
            return statusResponse;
        }

        @Override
        public AuthTokenIssue login(LoginRequest request) {
            if (loginError != null) {
                throw loginError;
            }
            return loginResponse;
        }

        @Override
        public AuthTokenIssue setupFirstAdmin(CreateFirstAdminRequest request) {
            if (setupError != null) {
                throw setupError;
            }
            return setupResponse;
        }

        @Override
        public AuthUser requireAuth(HttpServletRequest request) {
            if (requireAuthError != null) {
                throw requireAuthError;
            }
            return requireAuthResponse;
        }

        @Override
        public void logout(HttpServletRequest request) {
        }

        @Override
        public List<AuthUser> listUsers(HttpServletRequest request) {
            if (listUsersError != null) {
                throw listUsersError;
            }
            return listUsersResponse;
        }

        @Override
        public AuthUser createUser(HttpServletRequest request, CreateUserRequest createUserRequest) {
            if (createUserError != null) {
                throw createUserError;
            }
            return createUserResponse;
        }

        @Override
        public AuthUser disableUser(HttpServletRequest request, String userId) {
            if (disableUserError != null) {
                throw disableUserError;
            }
            return disableUserResponse;
        }

        @Override
        public AuthUser enableUser(HttpServletRequest request, String userId) {
            if (enableUserError != null) {
                throw enableUserError;
            }
            return enableUserResponse;
        }

        @Override
        public AuthUser setCloudUserPassword(HttpServletRequest request, String cloudUserId, String newPassword) {
            if (cloudPasswordError != null) {
                throw cloudPasswordError;
            }
            return cloudPasswordResponse;
        }

        @Override
        public List<AuthUser> listCloudUsers(HttpServletRequest request) {
            if (listCloudUsersError != null) {
                throw listCloudUsersError;
            }
            return listCloudUsersResponse;
        }
    }
}