package lk.resq.cloudapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.cloudapi.model.*;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import lk.resq.cloudapi.repository.CloudSessionRepository;
import lk.resq.cloudapi.service.CloudAdminBootstrap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
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
class SessionReportIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private CloudAdminBootstrap adminBootstrap;

    @Autowired
    private CloudManagementRepository managementRepository;

    @Autowired
    private CloudSessionRepository sessionRepository;

    private String adminAuth;
    private String inst1Auth;
    private String inst2Auth;
    private String trainee1Auth;
    private String trainee2Auth;

    private CloudUser adminUser;
    private CloudUser inst1;
    private CloudUser inst2;
    private CloudUser trainee1;
    private CloudUser trainee2;

    private CloudCourse course1;
    private CloudCourse course2;

    private String sessionC1T1;
    private String sessionC2T2;
    private String sessionNullInst1;
    private String sessionNullTrainee1;

    @BeforeEach
    void setUp() throws Exception {
        jdbcTemplate.update("DELETE FROM cloud_session_summaries");
        jdbcTemplate.update("DELETE FROM cloud_enrollments");
        jdbcTemplate.update("DELETE FROM cloud_course_instructors");
        jdbcTemplate.update("DELETE FROM cloud_courses");
        jdbcTemplate.update("DELETE FROM cloud_users");

        adminBootstrap.ensureBootstrapAdmin();
        adminAuth = login("admin@resq.local", "admin123");
        adminUser = managementRepository.findUserByEmail("admin@resq.local").orElseThrow();

        // Create instructors and trainees
        inst1 = createUser("Instructor One", "inst1@resq.test", "INSTRUCTOR");
        inst2 = createUser("Instructor Two", "inst2@resq.test", "INSTRUCTOR");
        trainee1 = createUser("Trainee One", "trainee1@resq.test", "TRAINEE");
        trainee2 = createUser("Trainee Two", "trainee2@resq.test", "TRAINEE");

        inst1Auth = login("inst1@resq.test", "password123");
        inst2Auth = login("inst2@resq.test", "password123");
        trainee1Auth = login("trainee1@resq.test", "password123");
        trainee2Auth = login("trainee2@resq.test", "password123");

        // Create courses
        course1 = createCourse("C-101", "Course 1", null);
        course2 = createCourse("C-102", "Course 2", null);

        // Assign instructor 1 to course 1 via cloud_course_instructors
        managementRepository.assignInstructor(course1.courseId(), inst1.userId());
        // Assign instructor 2 to course 2 via cloud_course_instructors
        managementRepository.assignInstructor(course2.courseId(), inst2.userId());

        // Enroll trainee 1 to course 1, trainee 2 to course 2
        enroll(course1.courseId(), trainee1.userId());
        enroll(course2.courseId(), trainee2.userId());

        // Create and save test session summaries directly through repo
        Instant now = Instant.now();
        sessionC1T1 = UUID.randomUUID().toString();
        sessionRepository.save(new CloudSessionRecord(
                sessionC1T1,
                "key-1",
                new CloudSessionSummarySyncPayload(
                        "resq.cloud.session-summary.v1",
                        CloudSyncEntityType.SESSION_SUMMARY,
                        "HUB-1",
                        "S-1",
                        null, "D-1", null,
                        trainee1.userId(), inst1.userId(), course1.courseId(),
                        now.minusSeconds(100), now, 100000L, "COMPLETED", "COMPLETED",
                        40, 38, 51.5, 108.0, 95.0, 38, 2, 1, 92, "DEPTH_OK,RATE_OK",
                        "notes", "adult-cpr", "LOCALHUB", now
                ),
                now, now
        ));

        sessionC2T2 = UUID.randomUUID().toString();
        sessionRepository.save(new CloudSessionRecord(
                sessionC2T2,
                "key-2",
                new CloudSessionSummarySyncPayload(
                        "resq.cloud.session-summary.v1",
                        CloudSyncEntityType.SESSION_SUMMARY,
                        "HUB-2",
                        "S-2",
                        null, "D-2", null,
                        trainee2.userId(), inst2.userId(), course2.courseId(),
                        now.minusSeconds(200), now, 200000L, "COMPLETED", "COMPLETED",
                        40, 38, 51.5, 108.0, 95.0, 38, 2, 1, 92, "DEPTH_OK,RATE_OK",
                        "notes", "adult-cpr", "LOCALHUB", now
                ),
                now, now
        ));

        sessionNullInst1 = UUID.randomUUID().toString();
        sessionRepository.save(new CloudSessionRecord(
                sessionNullInst1,
                "key-3",
                new CloudSessionSummarySyncPayload(
                        "resq.cloud.session-summary.v1",
                        CloudSyncEntityType.SESSION_SUMMARY,
                        "HUB-3",
                        "S-3",
                        null, "D-3", null,
                        null, inst1.userId(), null,
                        now.minusSeconds(300), now, 300000L, "COMPLETED", "COMPLETED",
                        40, 38, 51.5, 108.0, 95.0, 38, 2, 1, 92, "DEPTH_OK,RATE_OK",
                        "notes", "adult-cpr", "LOCALHUB", now
                ),
                now, now
        ));

        sessionNullTrainee1 = UUID.randomUUID().toString();
        sessionRepository.save(new CloudSessionRecord(
                sessionNullTrainee1,
                "key-4",
                new CloudSessionSummarySyncPayload(
                        "resq.cloud.session-summary.v1",
                        CloudSyncEntityType.SESSION_SUMMARY,
                        "HUB-4",
                        "S-4",
                        null, "D-4", null,
                        trainee1.userId(), null, null,
                        now.minusSeconds(400), now, 400000L, "COMPLETED", "COMPLETED",
                        40, 38, 51.5, 108.0, 95.0, 38, 2, 1, 92, "DEPTH_OK,RATE_OK",
                        "notes", "adult-cpr", "LOCALHUB", now
                ),
                now, now
        ));
    }

    @Test
    void adminCanListAllAndFilter() throws Exception {
        // List all (4 sessions)
        mockMvc.perform(get("/api/cloud/session-summaries")
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4));

        // Filter by course 1 (1 session)
        mockMvc.perform(get("/api/cloud/session-summaries?courseId=" + course1.courseId())
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].cloudSessionId").value(sessionC1T1))
                .andExpect(jsonPath("$[0].payload.courseId").value(course1.courseId()));

        // Null-course summaries remain visible for admin
        mockMvc.perform(get("/api/cloud/session-summaries")
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.payload.localSessionId == 'S-3')].cloudSessionId").value(sessionNullInst1))
                .andExpect(jsonPath("$[?(@.payload.localSessionId == 'S-4')].cloudSessionId").value(sessionNullTrainee1));
    }

    @Test
    void instructorScopeAccess() throws Exception {
        // Instructor 1 is assigned to course 1. They should see:
        // - sessionC1T1 (in course 1)
        // - sessionNullInst1 (where they instructed, null course)
        mockMvc.perform(get("/api/cloud/session-summaries")
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[?(@.cloudSessionId == '%s')]".formatted(sessionC1T1)).exists())
                .andExpect(jsonPath("$[?(@.cloudSessionId == '%s')]".formatted(sessionNullInst1)).exists());

        // If Instructor 1 requests course 2, they get 404
        mockMvc.perform(get("/api/cloud/session-summaries?courseId=" + course2.courseId())
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isNotFound());

        // If Instructor 1 requests Trainee 2 (unassigned), they get 404
        mockMvc.perform(get("/api/cloud/session-summaries?traineeId=" + trainee2.userId())
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isNotFound());
    }

    @Test
    void traineeScopeAccess() throws Exception {
        // Trainee 1 is enrolled in course 1. They should see:
        // - sessionC1T1 (their own session in course 1)
        // - sessionNullTrainee1 (their own session, null course)
        mockMvc.perform(get("/api/cloud/session-summaries")
                        .header(AUTHORIZATION, trainee1Auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[?(@.cloudSessionId == '%s')]".formatted(sessionC1T1)).exists())
                .andExpect(jsonPath("$[?(@.cloudSessionId == '%s')]".formatted(sessionNullTrainee1)).exists());

        // Trainee 1 requesting trainee 2's id is rejected with 403 Forbidden
        mockMvc.perform(get("/api/cloud/session-summaries?traineeId=" + trainee2.userId())
                        .header(AUTHORIZATION, trainee1Auth))
                .andExpect(status().isForbidden());

        // Trainee 1 requesting un-enrolled course 2 gets 404
        mockMvc.perform(get("/api/cloud/session-summaries?courseId=" + course2.courseId())
                        .header(AUTHORIZATION, trainee1Auth))
                .andExpect(status().isNotFound());
    }

    @Test
    void traineeHistoryEndpoint() throws Exception {
        // Trainee history route: GET /api/cloud/users/{userId}/session-summaries
        // Trainee 1 requesting their own history: succeeds
        mockMvc.perform(get("/api/cloud/users/{userId}/session-summaries", trainee1.userId())
                        .header(AUTHORIZATION, trainee1Auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        // Trainee 1 requesting Trainee 2 history: 403
        mockMvc.perform(get("/api/cloud/users/{userId}/session-summaries", trainee2.userId())
                        .header(AUTHORIZATION, trainee1Auth))
                .andExpect(status().isForbidden());

        // Instructor 1 requesting Trainee 1 history (assigned): succeeds
        mockMvc.perform(get("/api/cloud/users/{userId}/session-summaries", trainee1.userId())
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1)); // only sessionC1T1 (null course trainee one is instructed by null, not inst1, so not visible)

        // Instructor 1 requesting Trainee 2 history (unassigned): 404
        mockMvc.perform(get("/api/cloud/users/{userId}/session-summaries", trainee2.userId())
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isNotFound());

        // Admin requesting any history: succeeds
        mockMvc.perform(get("/api/cloud/users/{userId}/session-summaries", trainee2.userId())
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void courseScopedEndpoint() throws Exception {
        // GET /api/cloud/courses/{courseId}/session-summaries
        mockMvc.perform(get("/api/cloud/courses/{courseId}/session-summaries", course1.courseId())
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].cloudSessionId").value(sessionC1T1));

        // Instructor 1 (assigned) succeeds
        mockMvc.perform(get("/api/cloud/courses/{courseId}/session-summaries", course1.courseId())
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isOk());

        // Instructor 1 (unassigned course 2) gets 404
        mockMvc.perform(get("/api/cloud/courses/{courseId}/session-summaries", course2.courseId())
                        .header(AUTHORIZATION, inst1Auth))
                .andExpect(status().isNotFound());
    }

    @Test
    void safePaginationAndNegativeInputRejection() throws Exception {
        // Negative limit -> 400
        mockMvc.perform(get("/api/cloud/session-summaries?limit=-1")
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isBadRequest());

        // Negative offset -> 400
        mockMvc.perform(get("/api/cloud/session-summaries?offset=-5")
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isBadRequest());

        // Safe pagination limit check (limit=1)
        mockMvc.perform(get("/api/cloud/session-summaries?limit=1")
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void responseDtoFieldsAndSecurityExclusion() throws Exception {
        String result = mockMvc.perform(get("/api/cloud/session-summaries/{id}", sessionC1T1)
                        .header(AUTHORIZATION, adminAuth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.courseId").value(course1.courseId()))
                .andExpect(jsonPath("$.payload.traineeId").value(trainee1.userId()))
                .andExpect(jsonPath("$.payload.instructorId").value(inst1.userId()))
                .andReturn().getResponse().getContentAsString();

        // Ensure no passwords or hashes leak
        assertThat(result).doesNotContain("password_hash");
        assertThat(result).doesNotContain("local_login_hash");
        assertThat(result).doesNotContain("key_hash");
    }

    private CloudUser createUser(String displayName, String email, String role) throws Exception {
        String response = mockMvc.perform(post("/api/cloud/users")
                        .header(AUTHORIZATION, adminAuth)
                        .contentType("application/json")
                        .content("""
                                {
                                  "displayName":"%s",
                                  "email":"%s",
                                  "role":"%s",
                                  "password":"password123"
                                }
                                """.formatted(displayName, email, role)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(response, CloudUser.class);
    }

    private CloudCourse createCourse(String code, String title, String instructorId) throws Exception {
        String instructorField = instructorId == null ? "" : "\"instructorId\":\"" + instructorId + "\",";
        String response = mockMvc.perform(post("/api/cloud/courses")
                        .header(AUTHORIZATION, adminAuth)
                        .contentType("application/json")
                        .content("""
                                {
                                  "courseCode":"%s",
                                  "title":"%s",
                                  %s
                                  "description":"Report test course"
                                }
                                """.formatted(code, title, instructorField)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(response, CloudCourse.class);
    }

    private void enroll(String courseId, String traineeId) throws Exception {
        mockMvc.perform(post("/api/cloud/courses/{id}/enrollments", courseId)
                        .header(AUTHORIZATION, adminAuth)
                        .contentType("application/json")
                        .content("""
                                {"traineeId":"%s"}
                                """.formatted(traineeId)))
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
}
