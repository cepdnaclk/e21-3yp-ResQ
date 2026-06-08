package lk.resq.cloudapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CloudApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String localSessionId;

    @BeforeEach
    void setUp() {
        localSessionId = "S-" + java.util.UUID.randomUUID();
    }

    @Test
    void healthReturnsUp() throws Exception {
        mockMvc.perform(get("/api/cloud/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.service").value("resq-cloud-api"))
                .andExpect(jsonPath("$.storageMode").value("IN_MEMORY"));
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
                .andExpect(jsonPath("$.result").value("ALREADY_EXISTS"))
                .andReturn().getResponse().getContentAsString());

        assertThat(second.path("cloudSessionId").asText()).isEqualTo(first.path("cloudSessionId").asText());

        JsonNode sessions = objectMapper.readTree(mockMvc.perform(get("/api/cloud/sessions"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        long matches = java.util.stream.StreamSupport.stream(sessions.spliterator(), false)
                .filter(record -> localSessionId.equals(record.path("payload").path("localSessionId").asText()))
                .count();
        assertThat(matches).isEqualTo(1);
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
