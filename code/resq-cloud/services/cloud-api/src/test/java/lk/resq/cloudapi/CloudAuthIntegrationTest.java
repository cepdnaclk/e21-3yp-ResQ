package lk.resq.cloudapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import lk.resq.cloudapi.service.CloudAdminBootstrap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CloudAuthIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private CloudAdminBootstrap adminBootstrap;

    @Autowired
    private CloudManagementRepository repository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private String adminAuthorization;

    @BeforeEach
    void resetUsers() throws Exception {
        jdbcTemplate.update("DELETE FROM cloud_enrollments");
        jdbcTemplate.update("DELETE FROM cloud_courses");
        jdbcTemplate.update("DELETE FROM cloud_users");
        adminBootstrap.ensureBootstrapAdmin();
        adminAuthorization = login("admin@resq.local", "admin123");
    }

    @Test
    void bootstrapAdminIsCreatedWithBcryptPassword() {
        var credentials = repository.findUserCredentialsByEmail("admin@resq.local").orElseThrow();

        assertThat(credentials.user().role().name()).isEqualTo("ADMIN");
        assertThat(credentials.user().active()).isTrue();
        assertThat(credentials.passwordHash()).startsWith("$2");
        assertThat(credentials.passwordHash()).doesNotContain("admin123");
        assertThat(passwordEncoder.matches("admin123", credentials.passwordHash())).isTrue();
    }

    @Test
    void bootstrapAdminLoginAndMeSucceedWithoutExposingHash() throws Exception {
        String loginBody = mockMvc.perform(post("/api/cloud/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email":"admin@resq.local","password":"admin123"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andReturn().getResponse().getContentAsString();

        assertThat(loginBody).doesNotContain("passwordHash", "password_hash", "admin123");

        mockMvc.perform(get("/api/cloud/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("admin@resq.local"))
                .andExpect(jsonPath("$.role").value("ADMIN"));
    }

    @Test
    void wrongPasswordAndMissingTokenAreRejected() throws Exception {
        mockMvc.perform(post("/api/cloud/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email":"admin@resq.local","password":"wrong-password"}
                                """))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/cloud/auth/me"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/cloud/users")
                        .contentType("application/json")
                        .content(newUser("Unauthenticated", "none@resq.test", "TRAINEE")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void adminCanCreateUserButInstructorCannot() throws Exception {
        createUser("Instructor", "instructor@resq.test", "INSTRUCTOR", adminAuthorization);
        String instructorAuthorization = login("instructor@resq.test", "password123");

        mockMvc.perform(post("/api/cloud/users")
                        .header(HttpHeaders.AUTHORIZATION, instructorAuthorization)
                        .contentType("application/json")
                        .content(newUser("Denied", "denied@resq.test", "TRAINEE")))
                .andExpect(status().isForbidden());
    }

    @Test
    void instructorCanReviewSessionsButTraineeCannot() throws Exception {
        createUser("Instructor", "instructor@resq.test", "INSTRUCTOR", adminAuthorization);
        createUser("Trainee", "trainee@resq.test", "TRAINEE", adminAuthorization);

        mockMvc.perform(get("/api/cloud/sessions")
                        .header(HttpHeaders.AUTHORIZATION,
                                login("instructor@resq.test", "password123")))
                .andExpect(status().isOk());

        String traineeAuthorization = login("trainee@resq.test", "password123");
        mockMvc.perform(get("/api/cloud/sessions")
                        .header(HttpHeaders.AUTHORIZATION, traineeAuthorization))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/cloud/users")
                        .header(HttpHeaders.AUTHORIZATION, traineeAuthorization))
                .andExpect(status().isForbidden());
    }

    @Test
    void inactiveUserCannotLoginAndExistingTokenIsRejected() throws Exception {
        JsonNode trainee = createUser(
                "Trainee",
                "inactive@resq.test",
                "TRAINEE",
                adminAuthorization
        );
        String traineeAuthorization = login("inactive@resq.test", "password123");

        mockMvc.perform(patch("/api/cloud/users/{id}", trainee.path("userId").asText())
                        .header(HttpHeaders.AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("{\"active\":false}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/cloud/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email":"inactive@resq.test","password":"password123"}
                                """))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/cloud/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, traineeAuthorization))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void localHubSessionSyncPostRemainsPublic() throws Exception {
        mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content("""
                                {
                                  "contractVersion":"resq.cloud.session-summary.v1",
                                  "entityType":"SESSION_SUMMARY",
                                  "localHubId":"AUTH-TEST-HUB",
                                  "localSessionId":"AUTH-TEST-SESSION"
                                }
                                """))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content("""
                                {
                                  "contractVersion":"resq.cloud.session-summary.v1",
                                  "entityType":"SESSION_SUMMARY"
                                }
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void dashboardPreflightAllowsBearerAuthorizationHeader() throws Exception {
        mockMvc.perform(options("/api/cloud/sessions")
                        .header("Origin", "http://localhost:1430")
                        .header("Access-Control-Request-Method", "GET")
                        .header("Access-Control-Request-Headers", "authorization"))
                .andExpect(status().isOk())
                .andExpect(header().string(
                        "Access-Control-Allow-Headers",
                        org.hamcrest.Matchers.containsStringIgnoringCase("authorization")
                ));
    }

    private JsonNode createUser(
            String name,
            String email,
            String role,
            String authorization
    ) throws Exception {
        String response = mockMvc.perform(post("/api/cloud/users")
                        .header(HttpHeaders.AUTHORIZATION, authorization)
                        .contentType("application/json")
                        .content(newUser(name, email, role)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        assertThat(response).doesNotContain("passwordHash", "password_hash", "password123");
        return objectMapper.readTree(response);
    }

    private String login(String email, String password) throws Exception {
        String response = mockMvc.perform(post("/api/cloud/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email":"%s","password":"%s"}
                                """.formatted(email, password)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return "Bearer " + objectMapper.readTree(response).path("accessToken").asText();
    }

    private static String newUser(String name, String email, String role) {
        return """
                {
                  "displayName":"%s",
                  "email":"%s",
                  "role":"%s",
                  "password":"password123"
                }
                """.formatted(name, email, role);
    }
}
