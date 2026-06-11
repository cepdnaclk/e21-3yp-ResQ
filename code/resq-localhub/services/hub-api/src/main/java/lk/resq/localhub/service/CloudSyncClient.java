package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.config.CloudSyncProperties;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

@Component
public class CloudSyncClient implements CloudSyncGateway {

    private final CloudSyncProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public CloudSyncClient(CloudSyncProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getRequestTimeoutMs()))
                .build();
    }

    @Override
    public CloudSyncResult uploadSessionSummary(String payloadJson) throws CloudSyncException {
        HttpRequest request = HttpRequest.newBuilder(sessionSummariesUri())
                .timeout(Duration.ofMillis(properties.getRequestTimeoutMs()))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payloadJson))
                .build();

        try {
            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString()
            );
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new CloudSyncException(
                        "Cloud API returned HTTP " + response.statusCode() + ": " + abbreviate(response.body())
                );
            }
            return new CloudSyncResult(response.statusCode(), cloudSessionId(response.body()), response.body());
        } catch (IOException error) {
            throw new CloudSyncException("Cloud API request failed: " + error.getMessage(), error);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CloudSyncException("Cloud API request was interrupted", error);
        }
    }

    private URI sessionSummariesUri() {
        String baseUrl = properties.getBaseUrl().replaceAll("/+$", "");
        return URI.create(baseUrl + "/api/sync/session-summaries");
    }

    private String cloudSessionId(String body) {
        try {
            JsonNode response = objectMapper.readTree(body);
            return response.path("cloudSessionId").isTextual()
                    ? response.path("cloudSessionId").asText()
                    : null;
        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
            return null;
        }
    }

    private static String abbreviate(String value) {
        if (value == null) {
            return "";
        }
        String compact = value.replaceAll("\\s+", " ").trim();
        return compact.length() <= 300 ? compact : compact.substring(0, 300);
    }

    public record CloudSyncResult(int statusCode, String cloudSessionId, String responseBody) {
    }

    public static class CloudSyncException extends Exception {

        public CloudSyncException(String message) {
            super(message);
        }

        public CloudSyncException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
