package lk.resq.localhub.model.firmware;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FirmwareRequestIdsTest {

    @Test
    void formatsAndParsesRequestIds() {
        String requestId = FirmwareRequestIds.format(FirmwareCommandTypeId.SESSION_START.value(), 1);

        assertThat(requestId).isEqualTo("req-300-0001");
        assertThat(FirmwareRequestIds.isValid(requestId)).isTrue();
        assertThat(FirmwareRequestIds.parseCommandTypeId(requestId)).hasValue(FirmwareCommandTypeId.SESSION_START.value());
    }

    @Test
    void rejectsInvalidRequestIds() {
        assertThat(FirmwareRequestIds.isValid("req-300-1")).isFalse();
        assertThat(FirmwareRequestIds.isValid("bad-value")).isFalse();
        assertThat(FirmwareRequestIds.parseCommandTypeId("bad-value")).isEmpty();
    }
}