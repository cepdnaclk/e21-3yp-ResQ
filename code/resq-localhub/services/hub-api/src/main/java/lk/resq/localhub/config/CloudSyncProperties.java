package lk.resq.localhub.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "resq.cloud-sync")
public class CloudSyncProperties {

    private boolean enabled = false;
    private String baseUrl = "http://localhost:19080";
    private String hubId = "";
    private String hubKey = "";
    private int batchSize = 10;
    private long fixedDelayMs = 30_000;
    private long requestTimeoutMs = 5_000;
    private int maxRetryCount = 10;

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

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }

    public long getFixedDelayMs() {
        return fixedDelayMs;
    }

    public void setFixedDelayMs(long fixedDelayMs) {
        this.fixedDelayMs = fixedDelayMs;
    }

    public long getRequestTimeoutMs() {
        return requestTimeoutMs;
    }

    public void setRequestTimeoutMs(long requestTimeoutMs) {
        this.requestTimeoutMs = requestTimeoutMs;
    }

    public int getMaxRetryCount() {
        return maxRetryCount;
    }

    public void setMaxRetryCount(int maxRetryCount) {
        this.maxRetryCount = maxRetryCount;
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

    public boolean hasCredentials() {
        return hasText(hubId) && hasText(hubKey);
    }

    public boolean isReadyForUpload() {
        return hasText(baseUrl) && hasText(hubId) && hasText(hubKey);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
