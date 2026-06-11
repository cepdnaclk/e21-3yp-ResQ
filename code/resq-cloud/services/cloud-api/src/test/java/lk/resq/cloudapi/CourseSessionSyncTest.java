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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CourseSessionSyncTest {

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
    void setUp() throws Exception {
        jdbcTemplate.update("DELETE FROM cloud_session_summaries");
        jdbcTemplate.update("DELETE FROM cloud_enrollments");
        jdbcTemplate.update("DELETE FROM cloud_courses");
        jdbcTemplate.update("DELETE FROM cloud_users");

        adminBootstrap.ensureBootstrapAdmin();
        adminAuthorization = login("admin@resq.local", "admin123");
    }

    @Test
    void legacySessionSyncSucceeds() throws Exception {
        String sessionId = "S-LEGACY-" + UUID.randomUUID();
        String payload = sessionPayload("HUB-LEG", sessionId, null, null, null);

        mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accepted").value(true))
                .andExpect(jsonPath("$.result").value("CREATED"));

        Integer rowCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cloud_session_summaries WHERE local_session_id = ? AND course_id IS NULL",
                Integer.class,
                sessionId
        );
        assertThat(rowCount).isEqualTo(1);
    }

    @Test
    void validCourseSessionSyncSucceeds() throws Exception {
        JsonNode trainee = createUser("Trainee Bob", "trainee.bob@resq.test", "TRAINEE");
        JsonNode instructor = createUser("Instructor Jack", "instructor.jack@resq.test", "INSTRUCTOR");
        JsonNode course = createCourse("CPR-TEST-01", "CPR Test 01", instructor.path("userId").asText());
        enroll(course, trainee);

        String sessionId = "S-VALID-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-VALID",
                sessionId,
                course.path("courseId").asText(),
                trainee.path("userId").asText(),
                instructor.path("userId").asText()
        );

        mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accepted").value(true));

        Integer rowCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cloud_session_summaries WHERE local_session_id = ? AND course_id = ?",
                Integer.class,
                sessionId,
                course.path("courseId").asText()
        );
        assertThat(rowCount).isEqualTo(1);
    }

    @Test
    void courseOnlySessionSyncSucceeds() throws Exception {
        JsonNode course = createCourse("CPR-TEST-02", "CPR Test 02", null);

        String sessionId = "S-COURSE-ONLY-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-COURSE-ONLY",
                sessionId,
                course.path("courseId").asText(),
                null,
                null
        );

        mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accepted").value(true));
    }

    @Test
    void nonexistentCourseSyncFails() throws Exception {
        String randomCourseId = UUID.randomUUID().toString();
        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload("HUB-FAIL", sessionId, randomCourseId, null, null);

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("Course not found: " + randomCourseId);
    }

    @Test
    void inactiveCourseSyncFails() throws Exception {
        JsonNode course = createCourse("CPR-INACTIVE", "Inactive Course", null);
        deactivateCourse(course.path("courseId").asText());

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload("HUB-FAIL", sessionId, course.path("courseId").asText(), null, null);

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("Course is inactive: " + course.path("courseId").asText());
    }

    @Test
    void inactiveTraineeSyncFails() throws Exception {
        JsonNode trainee = createUser("Trainee bob", "bob.inactive@resq.test", "TRAINEE");
        JsonNode course = createCourse("CPR-TEST-03", "CPR Test 03", null);
        enroll(course, trainee);
        deactivateUser(trainee.path("userId").asText());

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-FAIL",
                sessionId,
                course.path("courseId").asText(),
                trainee.path("userId").asText(),
                null
        );

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("Trainee is inactive: " + trainee.path("userId").asText());
    }

    @Test
    void traineeWithWrongRoleSyncFails() throws Exception {
        JsonNode instructor = createUser("Instructor bob", "bob.instructor@resq.test", "INSTRUCTOR");
        JsonNode course = createCourse("CPR-TEST-04", "CPR Test 04", null);

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-FAIL",
                sessionId,
                course.path("courseId").asText(),
                instructor.path("userId").asText(),
                null
        );

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("does not have TRAINEE role");
    }

    @Test
    void unenrolledTraineeSyncFails() throws Exception {
        JsonNode trainee = createUser("Trainee Alice", "alice@resq.test", "TRAINEE");
        JsonNode course = createCourse("CPR-TEST-05", "CPR Test 05", null);

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-FAIL",
                sessionId,
                course.path("courseId").asText(),
                trainee.path("userId").asText(),
                null
        );

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("is not enrolled in course");
    }

    @Test
    void inactiveInstructorSyncFails() throws Exception {
        JsonNode instructor = createUser("Instructor Jack", "jack.inactive@resq.test", "INSTRUCTOR");
        JsonNode course = createCourse("CPR-TEST-06", "CPR Test 06", instructor.path("userId").asText());
        deactivateUser(instructor.path("userId").asText());

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-FAIL",
                sessionId,
                course.path("courseId").asText(),
                null,
                instructor.path("userId").asText()
        );

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("Instructor is inactive");
    }

    @Test
    void instructorWithWrongRoleSyncFails() throws Exception {
        JsonNode trainee = createUser("Trainee Bob", "bob@resq.test", "TRAINEE");
        JsonNode course = createCourse("CPR-TEST-07", "CPR Test 07", null);

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-FAIL",
                sessionId,
                course.path("courseId").asText(),
                null,
                trainee.path("userId").asText()
        );

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("is neither an INSTRUCTOR nor an ADMIN");
    }

    @Test
    void unassignedInstructorSyncFails() throws Exception {
        JsonNode instructor1 = createUser("Instructor 1", "inst1@resq.test", "INSTRUCTOR");
        JsonNode instructor2 = createUser("Instructor 2", "inst2@resq.test", "INSTRUCTOR");
        JsonNode course = createCourse("CPR-TEST-08", "CPR Test 08", instructor1.path("userId").asText());

        String sessionId = "S-FAIL-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-FAIL",
                sessionId,
                course.path("courseId").asText(),
                null,
                instructor2.path("userId").asText()
        );

        var result = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertThat(result.getResolvedException()).isNotNull();
        assertThat(result.getResolvedException().getMessage()).contains("is not assigned to course");
    }

    @Test
    void adminInstructorUnassignedSyncSucceeds() throws Exception {
        JsonNode adminInstructor = createUser("Admin Instructor", "admin.inst@resq.test", "ADMIN");
        JsonNode course = createCourse("CPR-TEST-09", "CPR Test 09", null);

        String sessionId = "S-VALID-ADMIN-" + UUID.randomUUID();
        String payload = sessionPayload(
                "HUB-VALID-ADMIN",
                sessionId,
                course.path("courseId").asText(),
                null,
                adminInstructor.path("userId").asText()
        );

        mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accepted").value(true));
    }

    @Test
    void querySessionResponseIncludesCourseId() throws Exception {
        JsonNode course = createCourse("CPR-TEST-10", "CPR Test 10", null);
        String sessionId = "S-QUERY-" + UUID.randomUUID();
        String payload = sessionPayload("HUB-QUERY", sessionId, course.path("courseId").asText(), null, null);

        String syncResponseStr = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode syncResponse = objectMapper.readTree(syncResponseStr);
        String cloudSessionId = syncResponse.path("cloudSessionId").asText();

        mockMvc.perform(get("/api/cloud/sessions/{id}", cloudSessionId)
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.courseId").value(course.path("courseId").asText()));
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
                                  "description":"Course-aware session test"
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

    private void deactivateUser(String userId) throws Exception {
        mockMvc.perform(post("/api/cloud/users")
                        .header(AUTHORIZATION, adminAuthorization)
                        .contentType("application/json") // we can also just use PATCH to deactivate
                        );
        jdbcTemplate.update("UPDATE cloud_users SET active = FALSE WHERE user_id = ?", UUID.fromString(userId));
    }

    private void deactivateCourse(String courseId) throws Exception {
        jdbcTemplate.update("UPDATE cloud_courses SET active = FALSE WHERE course_id = ?", UUID.fromString(courseId));
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

    private static String sessionPayload(String localHubId, String sessionId, String courseId, String traineeId, String instructorId) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"contractVersion\": \"resq.cloud.session-summary.v1\",\n");
        sb.append("  \"entityType\": \"SESSION_SUMMARY\",\n");
        if (localHubId != null) {
            sb.append("  \"localHubId\": \"").append(localHubId).append("\",\n");
        }
        sb.append("  \"localSessionId\": \"").append(sessionId).append("\",\n");
        sb.append("  \"deviceId\": \"M01\",\n");
        sb.append("  \"totalCompressions\": 40,\n");
        sb.append("  \"score\": 92,\n");
        sb.append("  \"source\": \"LOCALHUB\",\n");
        sb.append("  \"generatedAt\": \"2026-06-08T08:01:31Z\"");
        if (courseId != null) {
            sb.append(",\n  \"courseId\": \"").append(courseId).append("\"");
        }
        if (traineeId != null) {
            sb.append(",\n  \"traineeId\": \"").append(traineeId).append("\"");
        }
        if (instructorId != null) {
            sb.append(",\n  \"instructorId\": \"").append(instructorId).append("\"");
        }
        sb.append("\n}");
        return sb.toString();
    }
}
