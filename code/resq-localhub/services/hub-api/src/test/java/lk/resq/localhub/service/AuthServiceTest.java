package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.AuthTokenIssue;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.LoginRequest;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cloudsync.CloudRosterUser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

class AuthServiceTest {

    private Path tempDbPath;
    private LocalAuthRepository authRepository;
    private RosterCacheRepository rosterRepository;
    private AuthService authService;
    private BCryptPasswordEncoder encoder;

    @BeforeEach
    void setUp() throws IOException {
        tempDbPath = Path.of("target", "auth-service-test-" + UUID.randomUUID() + ".sqlite");
        Files.deleteIfExists(tempDbPath);

        String sqlitePath = tempDbPath.toAbsolutePath().toString();

        authRepository = new LocalAuthRepository(sqlitePath);
        authRepository.initialize();

        rosterRepository = new RosterCacheRepository(sqlitePath);
        rosterRepository.initialize();

        authService = new AuthService(authRepository, rosterRepository, new ObjectMapper(), 8);
        encoder = new BCryptPasswordEncoder();
    }

    @AfterEach
    void tearDown() throws IOException {
        Files.deleteIfExists(tempDbPath);
    }

    @Test
    void existingLocalUserLoginWorks() {
        String username = "admin";
        String password = "password123";
        String hash = encoder.encode(password);
        authRepository.createUser("u-1", username, "Admin User", hash, UserRole.ADMIN, Instant.now());

        LoginRequest request = new LoginRequest(username, password);
        AuthTokenIssue issue = authService.login(request);

        assertThat(issue).isNotNull();
        assertThat(issue.user().username()).isEqualTo(username);
        assertThat(issue.user().role()).isEqualTo(UserRole.ADMIN);
    }

    @Test
    void activeCloudUserWithLocalLoginHashCanLogin() {
        String email = "instructor@example.com";
        String password = "cloudPassword123";
        String hash = encoder.encode(password);

        // Insert into roster cache repository
        CloudRosterUser cloudUser = new CloudRosterUser("cloud-id-1", "Cloud Instructor", email, "INSTRUCTOR", true, Instant.now(), hash);
        rosterRepository.upsertUser(cloudUser, Instant.now());

        // Login
        LoginRequest request = new LoginRequest(email, password);
        AuthTokenIssue issue = authService.login(request);

        assertThat(issue).isNotNull();
        assertThat(issue.user().id()).isEqualTo("cloud-id-1");
        assertThat(issue.user().displayName()).isEqualTo("Cloud Instructor");
        assertThat(issue.user().role()).isEqualTo(UserRole.INSTRUCTOR);

        // Verify shadow user in local repository
        var localUser = authRepository.findUserById("cloud-id-1").orElse(null);
        assertThat(localUser).isNotNull();
        assertThat(localUser.username()).isEqualTo(email);
        assertThat(localUser.role()).isEqualTo(UserRole.INSTRUCTOR);
    }

    @Test
    void inactiveCloudUserCannotLogin() {
        String email = "inactive@example.com";
        String password = "cloudPassword123";
        String hash = encoder.encode(password);

        CloudRosterUser cloudUser = new CloudRosterUser("cloud-id-2", "Inactive Instructor", email, "INSTRUCTOR", false, Instant.now(), hash);
        rosterRepository.upsertUser(cloudUser, Instant.now());

        LoginRequest request = new LoginRequest(email, password);
        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void cloudUserWithoutLocalLoginHashCannotLogin() {
        String email = "nohash@example.com";
        String password = "cloudPassword123";

        CloudRosterUser cloudUser = new CloudRosterUser("cloud-id-3", "No Hash Instructor", email, "INSTRUCTOR", true, Instant.now(), null);
        rosterRepository.upsertUser(cloudUser, Instant.now());
        // Do not set password hash

        LoginRequest request = new LoginRequest(email, password);
        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void requireAuthMeWorksForCloudSyncedUser() {
        String email = "me@example.com";
        String password = "cloudPassword123";
        String hash = encoder.encode(password);

        CloudRosterUser cloudUser = new CloudRosterUser("cloud-id-4", "Me Instructor", email, "INSTRUCTOR", true, Instant.now(), hash);
        rosterRepository.upsertUser(cloudUser, Instant.now());

        LoginRequest request = new LoginRequest(email, password);
        AuthTokenIssue issue = authService.login(request);

        // Set up mock request carrying cookie
        HttpServletRequest mockRequest = Mockito.mock(HttpServletRequest.class);
        Cookie cookie = new Cookie("RESQ_LOCALHUB_AUTH", issue.token());
        when(mockRequest.getCookies()).thenReturn(new Cookie[]{cookie});

        AuthUser authUser = authService.requireAuth(mockRequest);
        assertThat(authUser).isNotNull();
        assertThat(authUser.id()).isEqualTo("cloud-id-4");
        assertThat(authUser.displayName()).isEqualTo("Me Instructor");
        assertThat(authUser.role()).isEqualTo(UserRole.INSTRUCTOR);
    }

    @Test
    void existingShadowRowCannotBypassCloudActiveCheck() {
        String email = "shadow@example.com";
        String password = "cloudPassword123";
        String hash = encoder.encode(password);

        CloudRosterUser cloudUser = new CloudRosterUser("cloud-id-5", "Shadow Instructor", email, "INSTRUCTOR", true, Instant.now(), hash);
        rosterRepository.upsertUser(cloudUser, Instant.now());

        // 1. Successful login creates local shadow record
        LoginRequest request = new LoginRequest(email, password);
        AuthTokenIssue issue = authService.login(request);
        assertThat(issue).isNotNull();

        // Verify shadow record exists
        assertThat(authRepository.findUserById("cloud-id-5")).isPresent();

        // 2. Mark the cloud user inactive in sync cache
        CloudRosterUser inactiveCloudUser = new CloudRosterUser("cloud-id-5", "Shadow Instructor", email, "INSTRUCTOR", false, Instant.now(), hash);
        rosterRepository.upsertUser(inactiveCloudUser, Instant.now());

        // 3. Login attempt must fail now despite shadow row existing
        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class);
    }
}
