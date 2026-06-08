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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CloudApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private String localSessionId;

    @BeforeEach
    void setUp() {
        jdbcTemplate.update("DELETE FROM cloud_session_summaries");
        localSessionId = "S-" + java.util.UUID.randomUUID();
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
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.localSessionId").value(localSessionId));
    }

    @Test
    void duplicatePayloadDoesNotCreateDuplicate() throws Exception {
        JsonNode first = postValidPayload("HUB-2", localSessionId);
        JsonNode second = objectMapper.readTree(mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(validPayload("HUB-2", localSessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UPDATED"))
                .andReturn().getResponse().getContentAsString());

        assertThat(second.path("cloudSessionId").asText()).isEqualTo(first.path("cloudSessionId").asText());

        JsonNode sessions = objectMapper.readTree(mockMvc.perform(get("/api/cloud/sessions"))
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
                        .contentType("application/json")
                        .content(validPayload("HUB-3", localSessionId)
                                .replace("resq.cloud.session-summary.v1", "resq.cloud.session-summary.v0")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void missingLocalSessionIdReturnsBadRequest() throws Exception {
        mockMvc.perform(post("/api/sync/session-summaries")
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

        mockMvc.perform(get("/api/cloud/sessions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.cloudSessionId == '%s')]".formatted(
                        created.path("cloudSessionId").asText())).exists());
    }

    @Test
    void getCloudSessionByCloudSessionIdReturnsRecord() throws Exception {
        JsonNode created = postValidPayload("HUB-CLOUD-LOOKUP", localSessionId);
        mockMvc.perform(get("/api/cloud/sessions/{id}", created.path("cloudSessionId").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotencyKey").value("HUB-CLOUD-LOOKUP:" + localSessionId));
    }

    @Test
    void getSyncSessionByLocalIdentityReturnsRecord() throws Exception {
        JsonNode created = postValidPayload("HUB-LOCAL-LOOKUP", localSessionId);
        mockMvc.perform(get("/api/sync/session-summaries/{hubId}/{sessionId}",
                        "HUB-LOCAL-LOOKUP", localSessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cloudSessionId").value(created.path("cloudSessionId").asText()));
    }

    @Test
    void blankLocalHubUsesFallbackIdempotencyKey() throws Exception {
        JsonNode response = postValidPayload(null, localSessionId);

        assertThat(response.path("idempotencyKey").asText())
                .isEqualTo("UNASSIGNED_LOCAL_HUB:" + localSessionId);

        mockMvc.perform(get("/api/sync/session-summaries/{hubId}/{sessionId}",
                        "UNASSIGNED_LOCAL_HUB", localSessionId))
                .andExpect(status().isOk());
    }

    private JsonNode postValidPayload(String localHubId, String sessionId) throws Exception {
        String body = mockMvc.perform(post("/api/sync/session-summaries")
                        .contentType("application/json")
                        .content(validPayload(localHubId, sessionId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accepted").value(true))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
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
