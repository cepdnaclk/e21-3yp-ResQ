package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.config.RosterSyncProperties;
import lk.resq.localhub.model.cloudsync.CloudRosterResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * HTTP client for pulling the cloud-master roster from the Cloud API.
 * Uses properties configured under {@code resq.roster-sync}.
 */
@Component
public class RosterSyncClient {

    private static final Logger logger = LoggerFactory.getLogger(RosterSyncClient.class);

    private final RosterSyncProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public RosterSyncClient(RosterSyncProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getTimeoutMs()))
                .build();
    }

    /**
     * Performs a GET /api/sync/roster call.
     *
     * @return CloudRosterResponse containing users, courses, assignments, enrollments.
     * @throws RosterSyncException on network failures or non-2xx API responses.
     */
    public CloudRosterResponse pullRoster() throws RosterSyncException {
        if (!properties.hasCredentials()) {
            throw new RosterSyncException("Roster sync credentials are not fully configured (missing base-url, hub-id, or hub-key).");
        }

        URI uri = rosterUri();
        logger.info("Preparing to pull cloud roster from {}", uri);

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMillis(properties.getTimeoutMs()))
                .header("Accept", "application/json")
                .header("X-ResQ-Hub-Id", properties.getHubId())
                .header("X-ResQ-Hub-Key", properties.getHubKey())
                .GET()
                .build();

        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            int statusCode = response.statusCode();
            if (statusCode < 200 || statusCode >= 300) {
                throw new RosterSyncException(
                        "Cloud API returned HTTP " + statusCode + ": " + abbreviate(response.body())
                );
            }
            return objectMapper.readValue(response.body(), CloudRosterResponse.class);
        } catch (IOException error) {
            throw new RosterSyncException("Cloud API roster pull failed: " + error.getMessage(), error);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new RosterSyncException("Cloud API roster pull was interrupted", error);
        }
    }

    private URI rosterUri() {
        String baseUrl = properties.getBaseUrl().replaceAll("/+$", "");
        return URI.create(baseUrl + "/api/sync/roster");
    }

    private static String abbreviate(String value) {
        if (value == null) {
            return "";
        }
        String compact = value.replaceAll("\\s+", " ").trim();
        return compact.length() <= 300 ? compact : compact.substring(0, 300);
    }

    public static class RosterSyncException extends Exception {
        public RosterSyncException(String message) {
            super(message);
        }

        public RosterSyncException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
