package lk.resq.cloudapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.jdbc.core.JdbcTemplate;
import lk.resq.cloudapi.service.CloudAdminBootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;

@SpringBootTest(properties = {
    "resq.cloud-cors.allowed-origins=https://test-no-hardware-localhub-firmware-contract.d3kmweq8ijz6vs.amplifyapp.com"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CloudApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private CloudAdminBootstrap adminBootstrap;

    private String localSessionId;
    private String adminAuthorization;
    private final String testHubKey = "hub-secret-123";

    @BeforeEach
    void setUp() throws Exception {
        jdbcTemplate.update("DELETE FROM cloud_session_summaries");
        jdbcTemplate.update("DELETE FROM cloud_hub_api_keys");
        adminBootstrap.ensureBootstrapAdmin();
        adminAuthorization = login("admin@resq.local", "admin123");
        localSessionId = "S-" + java.util.UUID.randomUUID();

        String keyHash = new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode(testHubKey);
        String[] hubs = {
            "HUB-1", "HUB-2", "HUB-3", "HUB-STORE", "HUB-PRESERVE",
            "HUB-LIST", "HUB-CLOUD-LOOKUP", "HUB-LOCAL-LOOKUP", "UNASSIGNED_LOCAL_HUB"
        };
        for (String hubId : hubs) {
            jdbcTemplate.update("INSERT INTO cloud_hub_api_keys (hub_id, hub_name, key_hash, active) VALUES (?, ?, ?, ?)",
                    hubId, "Test Hub " + hubId, keyHash, true);
        }
    }

    @Test
    void contextStarts() {
        assertThat(mockMvc).isNotNull();
        assertThat(jdbcTemplate).isNotNull();
    }

    @Test
    void healthReturnsUp() throws Exception {
        mockMvc.perform(get("/api/cloud/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.service").value("resq-cloud-api"))
                .andExpect(jsonPath("$.storageMode").value("POSTGRESQL"));
    }

    @Test
    void cloudReadEndpointsAllowLocalDashboardOrigin() throws Exception {
        mockMvc.perform(get("/api/cloud/health")
                        .header("Origin", "http://localhost:1430"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:1430"));
    }

    @Test
    void corsPreflightRequestsSucceed() throws Exception {
        String origin = "https://test-no-hardware-localhub-firmware-contract.d3kmweq8ijz6vs.amplifyapp.com";
        String[] paths = {
            "/api/cloud/auth/login",
            "/api/cloud/session-summaries",
            "/api/cloud/reports",
            "/api/cloud/analytics",
            "/api/sync/session-summaries"
        };

        for (String path : paths) {
            mockMvc.perform(options(path)
                            .header("Origin", origin)
                            .header("Access-Control-Request-Method", "GET")
                            .header("Access-Control-Request-Headers", "authorization,content-type,x-resq-hub-id,x-resq-hub-key"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Access-Control-Allow-Origin", origin));
        }
    }

    @Test
    void authenticatedRoutesRemainProtected() throws Exception {
        mockMvc.perform(get("/api/cloud/session-summaries"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/cloud/reports"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/cloud/analytics"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void syncRoutesRemainProtectedWithoutHeaders() throws Exception {
        mockMvc.perform(post("/api/sync/session-summaries")
                        .header("X-ResQ-Hub-Id", "")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void validPayloadIsAccepted() throws Exception {
        JsonNode response = postValidPayload("HUB-1", localSessionId);

        assertThat(response.path("accepted").asBoolean()).isTrue();
        assertThat(response.path("result").asText()).isEqualTo("CREATED");
    }

    @Test
    void validPayloadStoresCloudSessionRecord() throws Exception {
        JsonNode response = postValidPayload("HUB-STORE", localSessionId);
        Integer rowCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cloud_session_summaries WHERE local_session_id = ?",
                Integer.class,
                localSessionId
        );
        assertThat(rowCount).isEqualTo(1);

        mockMvc.perform(get("/api/cloud/sessions/{id}", response.path("cloudSessionId").asText()))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/cloud/sessions/{id}", response.path("cloudSessionId").asText())
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.localSessionId").value(localSessionId));
    }

    @Test
    void duplicatePayloadDoesNotCreateDuplicate() throws Exception {
        JsonNode first = postValidPayload("HUB-2", localSessionId);
        JsonNode second = objectMapper.readTree(mockMvc.perform(post("/api/sync/session-summaries")
                        .header("X-ResQ-Hub-Id", "HUB-2")
                        .header("X-ResQ-Hub-Key", testHubKey)
                        .contentType("application/json")
                        .content(validPayload("HUB-2", localSessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UPDATED"))
                .andReturn().getResponse().getContentAsString());

        assertThat(second.path("cloudSessionId").asText()).isEqualTo(first.path("cloudSessionId").asText());

        JsonNode sessions = objectMapper.readTree(mockMvc.perform(get("/api/cloud/sessions")
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        long matches = java.util.stream.StreamSupport.stream(sessions.spliterator(), false)
                .filter(record -> localSessionId.equals(record.path("payload").path("localSessionId").asText()))
                .count();
        assertThat(matches).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cloud_session_summaries WHERE idempotency_key = ?",
                Integer.class,
                "HUB-2:" + localSessionId
        )).isEqualTo(1);
    }

    @Test
    void duplicatePayloadPreservesCloudSessionIdAndReceivedAt() throws Exception {
        JsonNode first = postValidPayload("HUB-PRESERVE", localSessionId);
        java.time.OffsetDateTime receivedAt = jdbcTemplate.queryForObject(
                "SELECT received_at FROM cloud_session_summaries WHERE idempotency_key = ?",
                java.time.OffsetDateTime.class,
                "HUB-PRESERVE:" + localSessionId
        );

        Thread.sleep(5);
        JsonNode second = objectMapper.readTree(mockMvc.perform(post("/api/sync/session-summaries")
                        .header("X-ResQ-Hub-Id", "HUB-PRESERVE")
                        .header("X-ResQ-Hub-Key", testHubKey)
                        .contentType("application/json")
                        .content(validPayload("HUB-PRESERVE", localSessionId).replace("\"score\": 92", "\"score\": 95")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UPDATED"))
                .andReturn().getResponse().getContentAsString());

        assertThat(second.path("cloudSessionId").asText()).isEqualTo(first.path("cloudSessionId").asText());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT received_at FROM cloud_session_summaries WHERE idempotency_key = ?",
                java.time.OffsetDateTime.class,
                "HUB-PRESERVE:" + localSessionId
        )).isEqualTo(receivedAt);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT score FROM cloud_session_summaries WHERE idempotency_key = ?",
                Double.class,
                "HUB-PRESERVE:" + localSessionId
        )).isEqualTo(95.0);
    }

    @Test
    void invalidContractVersionReturnsBadRequest() throws Exception {
        mockMvc.perform(post("/api/sync/session-summaries")
                        .header("X-ResQ-Hub-Id", "HUB-3")
                        .header("X-ResQ-Hub-Key", testHubKey)
                        .contentType("application/json")
                        .content(validPayload("HUB-3", localSessionId)
                                .replace("resq.cloud.session-summary.v1", "resq.cloud.session-summary.v0")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void missingLocalSessionIdReturnsBadRequest() throws Exception {
        mockMvc.perform(post("/api/sync/session-summaries")
                        .header("X-ResQ-Hub-Id", "UNASSIGNED_LOCAL_HUB")
                        .header("X-ResQ-Hub-Key", testHubKey)
                        .contentType("application/json")
                        .content("""
                                {
                                  "contractVersion": "resq.cloud.session-summary.v1",
                                  "entityType": "SESSION_SUMMARY"
                                }
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void listSessionsReturnsStoredRecords() throws Exception {
        JsonNode created = postValidPayload("HUB-LIST", localSessionId);

        mockMvc.perform(get("/api/cloud/sessions")
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.cloudSessionId == '%s')]".formatted(
                        created.path("cloudSessionId").asText())).exists());
    }

    @Test
    void getCloudSessionByCloudSessionIdReturnsRecord() throws Exception {
        JsonNode created = postValidPayload("HUB-CLOUD-LOOKUP", localSessionId);
        mockMvc.perform(get("/api/cloud/sessions/{id}", created.path("cloudSessionId").asText())
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotencyKey").value("HUB-CLOUD-LOOKUP:" + localSessionId));
    }

    @Test
    void getSyncSessionByLocalIdentityReturnsRecord() throws Exception {
        JsonNode created = postValidPayload("HUB-LOCAL-LOOKUP", localSessionId);
        mockMvc.perform(get("/api/sync/session-summaries/{hubId}/{sessionId}",
                        "HUB-LOCAL-LOOKUP", localSessionId)
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cloudSessionId").value(created.path("cloudSessionId").asText()));
    }

    @Test
    void blankLocalHubUsesFallbackIdempotencyKey() throws Exception {
        JsonNode response = postValidPayload(null, localSessionId);

        assertThat(response.path("idempotencyKey").asText())
                .isEqualTo("UNASSIGNED_LOCAL_HUB:" + localSessionId);

        mockMvc.perform(get("/api/sync/session-summaries/{hubId}/{sessionId}",
                        "UNASSIGNED_LOCAL_HUB", localSessionId)
                        .header(AUTHORIZATION, adminAuthorization))
                .andExpect(status().isOk());
    }

    private JsonNode postValidPayload(String localHubId, String sessionId) throws Exception {
        String hubId = localHubId != null ? localHubId : "UNASSIGNED_LOCAL_HUB";
        String body = mockMvc.perform(post("/api/sync/session-summaries")
                        .header("X-ResQ-Hub-Id", hubId)
                        .header("X-ResQ-Hub-Key", testHubKey)
                        .contentType("application/json")
                        .content(validPayload(localHubId, sessionId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accepted").value(true))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
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

    private static String validPayload(String localHubId, String sessionId) {
        String hubField = localHubId == null ? "" : "\"localHubId\": \"" + localHubId + "\",";
        return """
                {
                  "contractVersion": "resq.cloud.session-summary.v1",
                  "entityType": "SESSION_SUMMARY",
                  %s
                  "localSessionId": "%s",
                  "deviceId": "M01",
                  "totalCompressions": 40,
                  "score": 92,
                  "source": "LOCALHUB",
                  "generatedAt": "2026-06-08T08:01:31Z"
                }
                """.formatted(hubField, sessionId);
    }
}
