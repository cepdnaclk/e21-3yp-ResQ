package lk.resq.localhub.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration properties for the LocalHub → Cloud roster pull.
 *
 * <p>Bound from the {@code resq.roster-sync} prefix in application.yml /
 * environment variables. Keys follow the same kebab-case convention as
 * the existing {@code resq.cloud-sync} block.</p>
 *
 * <p><strong>Security note:</strong> {@code hubKey} is never logged.
 * Do not add a log statement that prints this value.</p>
 */
@Component
@ConfigurationProperties(prefix = "resq.roster-sync")
public class RosterSyncProperties {

    /** Master switch. Set to true to enable the scheduled roster pull. */
    private boolean enabled = false;

    /**
     * Base URL of the Cloud API (no trailing slash).
     * Example: {@code https://cloud.resq.example.com}
     */
    private String baseUrl = "";

    /**
     * The hub's registered identifier, sent in the {@code X-ResQ-Hub-Id} header.
     * Must match a row in {@code cloud_hub_api_keys.hub_id} on the cloud side.
     */
    private String hubId = "";

    /**
     * The raw plaintext API key for this hub, sent in the {@code X-ResQ-Hub-Key} header.
     * Never logged. The cloud side stores only the BCrypt hash.
     */
    private String hubKey = "";

    /** How long to wait between roster pull attempts, in milliseconds. Default: 5 minutes. */
    private long fixedDelayMs = 300_000;

    /** HTTP request/connect timeout for the roster pull call, in milliseconds. Default: 10 s. */
    private long timeoutMs = 10_000;

    // -------------------------------------------------------------------------
    // Getters / setters (required for @ConfigurationProperties binding)
    // -------------------------------------------------------------------------

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getHubId() {
        return hubId;
    }

    public void setHubId(String hubId) {
        this.hubId = hubId;
    }

    public String getHubKey() {
        return hubKey;
    }

    public void setHubKey(String hubKey) {
        this.hubKey = hubKey;
    }

    public long getFixedDelayMs() {
        return fixedDelayMs;
    }

    public void setFixedDelayMs(long fixedDelayMs) {
        this.fixedDelayMs = fixedDelayMs;
    }

    public long getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(long timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /** Returns true only when all three credentials are non-blank. */
    public boolean hasCredentials() {
        return hasText(baseUrl) && hasText(hubId) && hasText(hubKey);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
