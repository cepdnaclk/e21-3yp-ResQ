package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import lk.resq.localhub.config.CloudSyncProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CloudSyncClientTest {

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void postsJsonPayloadAndReadsCloudSessionId() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/sync/session-summaries", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = """
                    {"accepted":true,"cloudSessionId":"cloud-123"}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(201, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        CloudSyncClient client = clientForServer();
        CloudSyncClient.CloudSyncResult result = client.uploadSessionSummary(
                "{\"contractVersion\":\"resq.cloud.session-summary.v1\"}"
        );

        assertThat(result.statusCode()).isEqualTo(201);
        assertThat(result.cloudSessionId()).isEqualTo("cloud-123");
        assertThat(requestBody.get()).contains("resq.cloud.session-summary.v1");
    }

    @Test
    void nonSuccessfulHttpStatusIsFailure() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/sync/session-summaries", exchange -> {
            byte[] response = "invalid payload".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(400, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        assertThatThrownBy(() -> clientForServer().uploadSessionSummary("{}"))
                .isInstanceOf(CloudSyncClient.CloudSyncException.class)
                .hasMessageContaining("HTTP 400")
                .hasMessageContaining("invalid payload");
    }

    private CloudSyncClient clientForServer() {
        CloudSyncProperties properties = new CloudSyncProperties();
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setRequestTimeoutMs(1_000);
        lk.resq.localhub.config.RosterSyncProperties rosterProperties = new lk.resq.localhub.config.RosterSyncProperties();
        rosterProperties.setHubId("mock-hub");
        rosterProperties.setHubKey("mock-key");
        return new CloudSyncClient(properties, rosterProperties, new ObjectMapper());
    }
}
