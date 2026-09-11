package lk.resq.localhub.model.firmware;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FirmwareTopicsTest {

    @Test
    void buildsCanonicalFirmwareTopics() {
        assertThat(FirmwareTopics.baseTopic("M01")).isEqualTo("resq/M01");
        assertThat(FirmwareTopics.statusTopic("M01")).isEqualTo("resq/M01/status");
        assertThat(FirmwareTopics.heartbeatTopic("M01")).isEqualTo("resq/M01/heartbeat");
        assertThat(FirmwareTopics.telemetryTopic("M01")).isEqualTo("resq/M01/telemetry");
        assertThat(FirmwareTopics.debugTopic("M01")).isEqualTo("resq/M01/debug");
        assertThat(FirmwareTopics.eventsTopic("M01")).isEqualTo("resq/M01/events");
        assertThat(FirmwareTopics.calibrationEventsTopic("M01")).isEqualTo("resq/M01/events/calibration");
        assertThat(FirmwareTopics.errorEventsTopic("M01")).isEqualTo("resq/M01/events/error");
        assertThat(FirmwareTopics.sessionStartCommandTopic("M01")).isEqualTo("resq/M01/cmd/session/start");
        assertThat(FirmwareTopics.telemetryCommandTopic("M01")).isEqualTo("resq/M01/cmd/telemetry");
        assertThat(FirmwareTopics.systemFlushConfigCommandTopic("M01")).isEqualTo("resq/M01/cmd/system/flush-config");
    }
}
