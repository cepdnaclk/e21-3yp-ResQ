package lk.resq.localhub.model.ingestion;

public enum MqttTopicFamily {
    STATUS("status"),
    HEARTBEAT("heartbeat"),
    TELEMETRY("telemetry"),
    DEBUG("debug"),
    EVENT("events"),
    CALIBRATION_EVENT("events/calibration"),
    ERROR_EVENT("events/error");

    private final String canonicalSuffix;

    MqttTopicFamily(String canonicalSuffix) {
        this.canonicalSuffix = canonicalSuffix;
    }

    public String canonicalSuffix() {
        return canonicalSuffix;
    }
}
