package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.firmware.RuntimeMessageDisposition;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceRuntimeOrderingTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void firstSequencedMessageAccepted() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        var result = service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 10, "PAIRED_IDLE", false));

        assertThat(result.disposition()).isEqualTo(RuntimeMessageDisposition.ACCEPTED);
        assertThat(result.state().bootId()).isEqualTo("aaaaaaaaaaaaaaaa");
        assertThat(result.state().stateSeq()).isEqualTo(10);
    }

    @Test
    void sameBootHigherSequenceAcceptedAndEqualOrLowerRejected() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 10, "PAIRED_IDLE", false));
        var higher = service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 11, "READY_FOR_SESSION", true));
        var equal = service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 11, "PAIRED_IDLE", false));
        var lower = service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 9, "PAIRED_IDLE", false));

        assertThat(higher.disposition()).isEqualTo(RuntimeMessageDisposition.ACCEPTED);
        assertThat(equal.disposition()).isEqualTo(RuntimeMessageDisposition.DUPLICATE);
        assertThat(lower.disposition()).isEqualTo(RuntimeMessageDisposition.STALE_SEQUENCE);
        assertThat(lower.state().readyForSession()).isTrue();
    }

    @Test
    void newBootWithLowerSequenceAcceptedAndOldBootRejected() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 10, "READY_FOR_SESSION", true));
        var newBoot = service.applyStatusResult("M01", status("bbbbbbbbbbbbbbbb", 1, "PAIRED_IDLE", false));
        var oldBoot = service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 99, "READY_FOR_SESSION", true));

        assertThat(newBoot.disposition()).isEqualTo(RuntimeMessageDisposition.ACCEPTED);
        assertThat(newBoot.bootChanged()).isTrue();
        assertThat(oldBoot.disposition()).isEqualTo(RuntimeMessageDisposition.SUPERSEDED_BOOT);
        assertThat(oldBoot.state().bootId()).isEqualTo("bbbbbbbbbbbbbbbb");
        assertThat(oldBoot.state().readyForSession()).isFalse();
    }

    @Test
    void devicesRemainIsolated() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 10, "READY_FOR_SESSION", true));
        var m02 = service.applyStatusResult("M02", status("aaaaaaaaaaaaaaaa", 1, "PAIRED_IDLE", false));

        assertThat(m02.disposition()).isEqualTo(RuntimeMessageDisposition.ACCEPTED);
        assertThat(m02.state().stateSeq()).isEqualTo(1);
    }

    @Test
    void legacyAcceptedBeforeSequencedButIgnoredAfterSequenced() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        var legacy = service.applyStatusResult("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":1}
                """));
        service.applyStatusResult("M01", status("aaaaaaaaaaaaaaaa", 10, "PAIRED_IDLE", false));
        var delayedLegacy = service.applyStatusResult("M01", objectMapper.readTree("""
                {"state":"READY_FOR_SESSION","calibrated":true,"session_active":false,"ts_ms":999}
                """));

        assertThat(legacy.disposition()).isEqualTo(RuntimeMessageDisposition.LEGACY_ACCEPTED);
        assertThat(delayedLegacy.disposition()).isEqualTo(RuntimeMessageDisposition.LEGACY_IGNORED);
        assertThat(delayedLegacy.state().readyForSession()).isFalse();
    }

    @Test
    void malformedOrderingFieldsRejectedSafely() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        var badBoot = service.applyStatusResult("M01", objectMapper.readTree("""
                {"boot_id":"not-a-boot","state_seq":1,"state":"READY_FOR_SESSION","calibrated":true}
                """));
        var badSeq = service.applyStatusResult("M01", objectMapper.readTree("""
                {"boot_id":"aaaaaaaaaaaaaaaa","state_seq":0,"state":"READY_FOR_SESSION","calibrated":true}
                """));

        assertThat(badBoot.disposition()).isEqualTo(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS);
        assertThat(badSeq.disposition()).isEqualTo(RuntimeMessageDisposition.INVALID_ORDERING_FIELDS);
    }

    @Test
    void delayedOldBootCalibrationPassDoesNotOverrideNewBootStatus() throws Exception {
        DeviceRuntimeStateService service = new DeviceRuntimeStateService();

        service.applyCalibrationEventResult("M01", DeviceRuntimeStateServiceTest.calibrationEvent(4002, "PASS", "ACK", "READY_FOR_SESSION", 100L)
                .withOrdering("aaaaaaaaaaaaaaaa", 10L));
        service.applyStatusResult("M01", status("bbbbbbbbbbbbbbbb", 1, "PAIRED_IDLE", false));
        var delayed = service.applyCalibrationEventResult("M01", DeviceRuntimeStateServiceTest.calibrationEvent(4002, "PASS", "ACK", "READY_FOR_SESSION", 110L)
                .withOrdering("aaaaaaaaaaaaaaaa", 11L));

        assertThat(delayed.disposition()).isEqualTo(RuntimeMessageDisposition.SUPERSEDED_BOOT);
        assertThat(delayed.state().bootId()).isEqualTo("bbbbbbbbbbbbbbbb");
        assertThat(delayed.state().readyForSession()).isFalse();
    }

    private com.fasterxml.jackson.databind.JsonNode status(String bootId, long stateSeq, String state, boolean calibrated) throws Exception {
        return objectMapper.readTree("""
                {"boot_id":"%s","state_seq":%d,"state":"%s","calibrated":%s,"session_active":false,"ts_ms":%d}
                """.formatted(bootId, stateSeq, state, calibrated, stateSeq));
    }
}
