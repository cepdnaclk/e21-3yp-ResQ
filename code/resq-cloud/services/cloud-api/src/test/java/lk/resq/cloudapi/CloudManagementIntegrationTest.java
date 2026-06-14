package lk.resq.cloudapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import lk.resq.cloudapi.service.CloudAdminBootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CloudManagementIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private CloudAdminBootstrap adminBootstrap;

    private String adminAuthorization;

    @BeforeEach
    void cleanManagementTables() throws Exception {
        jdbcTemplate.update("DELETE FROM cloud_enrollments");
        jdbcTemplate.update("DELETE FROM cloud_courses");
        jdbcTemplate.update("DELETE FROM cloud_users");
        jdbcTemplate.update("DELETE FROM cloud_hub_api_keys");
        adminBootstrap.ensureBootstrapAdmin();
        adminAuthorization = login("admin@resq.local", "admin123");
    }

    @Test
    void createUserSucceedsAndCanBeUpdated() throws Exception {
        JsonNode user = createUser("Course Admin", "admin@resq.test", "ADMIN");

        mockMvc.perform(patch("/api/cloud/users/{id}", user.path("userId").asText())
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"displayName":"Cloud Admin","active":false}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Cloud Admin"))
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    void invalidRoleIsRejected() throws Exception {
        mockMvc.perform(post("/api/cloud/users")
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"displayName":"Invalid User","role":"OBSERVER","password":"password123"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void duplicateEmailReturnsConflict() throws Exception {
        createUser("First User", "same@resq.test", "TRAINEE");

        mockMvc.perform(post("/api/cloud/users")
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"displayName":"Second User","email":"same@resq.test","role":"TRAINEE","password":"password123"}
                                """))
                .andExpect(status().isConflict());
    }

    @Test
    void createCourseWithInstructorSucceeds() throws Exception {
        JsonNode instructor = createUser("Instructor One", "instructor@resq.test", "INSTRUCTOR");

        JsonNode course = createCourse("CPR-101", "CPR Foundations", instructor.path("userId").asText());

        assertThat(course.path("courseCode").asText()).isEqualTo("CPR-101");
        assertThat(course.path("instructorDisplayName").asText()).isEqualTo("Instructor One");
    }

    @Test
    void instructorAssignmentRejectsTraineeRole() throws Exception {
        JsonNode trainee = createUser("Trainee One", null, "TRAINEE");

        mockMvc.perform(post("/api/cloud/courses")
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {
                                  "title":"Advanced CPR",
                                  "instructorId":"%s"
                                }
                                """.formatted(trainee.path("userId").asText())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void enrollTraineeSucceedsAndListReturnsEnrollment() throws Exception {
        JsonNode trainee = createUser("Trainee One", "trainee@resq.test", "TRAINEE");
        JsonNode course = createCourse("CPR-102", "CPR Practice", null);

        enroll(course, trainee);

        mockMvc.perform(get("/api/cloud/courses/{id}/enrollments", course.path("courseId").asText()))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/cloud/courses/{id}/enrollments", course.path("courseId").asText())
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].traineeId").value(trainee.path("userId").asText()))
                .andExpect(jsonPath("$[0].traineeDisplayName").value("Trainee One"))
                .andExpect(jsonPath("$[0].active").value(true));
    }

    @Test
    void duplicateEnrollmentDoesNotCreateDuplicateRows() throws Exception {
        JsonNode trainee = createUser("Trainee One", null, "TRAINEE");
        JsonNode course = createCourse(null, "CPR Practice", null);

        enroll(course, trainee);
        enroll(course, trainee);

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cloud_enrollments WHERE course_id = ? AND trainee_id = ?",
                Integer.class,
                java.util.UUID.fromString(course.path("courseId").asText()),
                java.util.UUID.fromString(trainee.path("userId").asText())
        )).isEqualTo(1);
    }

    @Test
    void removedEnrollmentIsInactiveAndCanBeReactivated() throws Exception {
        JsonNode trainee = createUser("Trainee One", null, "TRAINEE");
        JsonNode course = createCourse(null, "CPR Practice", null);
        enroll(course, trainee);

        mockMvc.perform(delete("/api/cloud/courses/{courseId}/enrollments/{traineeId}",
                        course.path("courseId").asText(),
                        trainee.path("userId").asText())
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/cloud/courses/{id}/enrollments", course.path("courseId").asText())
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].active").value(false));

        enroll(course, trainee);
        mockMvc.perform(get("/api/cloud/courses/{id}/enrollments", course.path("courseId").asText())
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].active").value(true));
    }

    @Test
    void onlyTraineeUsersCanBeEnrolled() throws Exception {
        JsonNode instructor = createUser("Instructor One", null, "INSTRUCTOR");
        JsonNode course = createCourse(null, "CPR Practice", instructor.path("userId").asText());

        mockMvc.perform(post("/api/cloud/courses/{id}/enrollments", course.path("courseId").asText())
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"traineeId":"%s"}
                                """.formatted(instructor.path("userId").asText())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void coursePatchCanClearInstructorAndDeactivateCourse() throws Exception {
        JsonNode instructor = createUser("Instructor One", null, "INSTRUCTOR");
        JsonNode course = createCourse("CPR-103", "CPR Practice", instructor.path("userId").asText());

        mockMvc.perform(patch("/api/cloud/courses/{id}", course.path("courseId").asText())
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"instructorId":null,"active":false,"title":"Archived CPR Practice"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.instructorId").doesNotExist())
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.title").value("Archived CPR Practice"));
    }

    @Test
    void corsAllowsManagementWritesButNotSessionIngestFromDashboard() throws Exception {
        mockMvc.perform(options("/api/cloud/users")
                        .header("Origin", "http://localhost:1430")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:1430"))
                .andExpect(header().string("Access-Control-Allow-Methods",
                        org.hamcrest.Matchers.containsString("POST")));

        mockMvc.perform(options("/api/cloud/sessions")
                        .header("Origin", "http://localhost:1430")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }

    private JsonNode createUser(String displayName, String email, String role) throws Exception {
        String emailField = email == null ? "" : "\"email\":\"" + email + "\",";
        String response = mockMvc.perform(post("/api/cloud/users")
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {
                                  "displayName":"%s",
                                  %s
                                  "role":"%s",
                                  "password":"password123"
                                }
                                """.formatted(displayName, emailField, role)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode createCourse(String code, String title, String instructorId) throws Exception {
        String codeField = code == null ? "" : "\"courseCode\":\"" + code + "\",";
        String instructorField = instructorId == null ? "" : "\"instructorId\":\"" + instructorId + "\",";
        String response = mockMvc.perform(post("/api/cloud/courses")
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {
                                  %s
                                  "title":"%s",
                                  %s
                                  "description":"Local management test"
                                }
                                """.formatted(codeField, title, instructorField)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private void enroll(JsonNode course, JsonNode trainee) throws Exception {
        mockMvc.perform(post("/api/cloud/courses/{id}/enrollments", course.path("courseId").asText())
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"traineeId":"%s"}
                                """.formatted(trainee.path("userId").asText())))
                .andExpect(status().isCreated());
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

    @Test
    void setLocalHubPasswordSecuredAndRosterIncludesHash() throws Exception {
        // 1. Create trainee and course, and enroll them
        JsonNode user = createUser("Offline Trainee", "offline@resq.test", "TRAINEE");
        String userId = user.path("userId").asText();
        JsonNode course = createCourse("CPR-OFFLINE", "Offline CPR Course", null);
        enroll(course, user);

        // 2. Non-admin is rejected
        mockMvc.perform(post("/api/cloud/users/{id}/localhub-password", userId)
                        .contentType("application/json")
                        .content("""
                                {"password":"localhubPassword123"}
                                """))
                .andExpect(status().isUnauthorized());

        // 3. Admin successfully sets LocalHub password and receives sanitized user info
        mockMvc.perform(post("/api/cloud/users/{id}/localhub-password", userId)
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json")
                        .content("""
                                {"password":"localhubPassword123"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Offline Trainee"))
                .andExpect(jsonPath("$.localLoginHash").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());

        // 4. Normal details fetch does not expose hash
        mockMvc.perform(get("/api/cloud/users/{id}", userId)
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localLoginHash").doesNotExist());

        // 5. Register a test hub and pull roster sync with auth headers
        String hubId = "hub-test-01";
        String rawKey = "hub-secret-123";
        String keyHash = new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode(rawKey);
        jdbcTemplate.update("INSERT INTO cloud_hub_api_keys (hub_id, hub_name, key_hash, active) VALUES (?, ?, ?, ?)",
                hubId, "Test Hub", keyHash, true);

        mockMvc.perform(get("/api/sync/roster")
                        .header("X-ResQ-Hub-Id", hubId)
                        .header("X-ResQ-Hub-Key", rawKey))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users[?(@.cloudUserId == '%s')].localLoginHash".formatted(userId)).exists());
    }
}
