package lk.resq.localhub.model.firmware;

public final class FirmwareTopics {
    private FirmwareTopics() {
    }

    public static String baseTopic(String deviceId) {
        return String.format("resq/%s", normalize(deviceId));
    }

    public static String statusTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "status");
    }

    public static String heartbeatTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "heartbeat");
    }

    public static String telemetryTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "telemetry");
    }

    public static String debugTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "debug");
    }

    public static String eventsTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "events");
    }

    public static String calibrationEventsTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "events/calibration");
    }

    public static String errorEventsTopic(String deviceId) {
        return commandOrStatusTopic(deviceId, "events/error");
    }

    public static String commandTopic(String deviceId, String suffix) {
        return commandOrStatusTopic(deviceId, suffix);
    }

    public static String debugCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/debug");
    }

    public static String calibrationStartCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/calibration/start");
    }

    public static String calibrationCancelCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/calibration/cancel");
    }

    public static String sessionStartCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/session/start");
    }

    public static String sessionStopCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/session/stop");
    }

    public static String telemetryCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/telemetry");
    }

    public static String systemRetryCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/system/retry");
    }

    public static String systemResetCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/system/reset");
    }

    public static String systemFlushConfigCommandTopic(String deviceId) {
        return commandTopic(deviceId, "cmd/system/flush-config");
    }

    private static String commandOrStatusTopic(String deviceId, String suffix) {
        return String.format("resq/%s/%s", normalize(deviceId), normalizeSuffix(suffix));
    }

    private static String normalize(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("deviceId must not be blank");
        }
        return normalized;
    }

    private static String normalizeSuffix(String value) {
        String normalized = value == null ? "" : value.trim().replaceAll("^/+|/+$", "");
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("suffix must not be blank");
        }
        return normalized;
    }
}
