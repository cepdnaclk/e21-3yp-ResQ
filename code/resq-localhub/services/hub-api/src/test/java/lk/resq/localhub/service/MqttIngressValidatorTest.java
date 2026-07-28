package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.ingestion.MqttIngestionEnvelope;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class MqttIngressValidatorTest {
    private final CanonicalMqttIngestion ingestion = new CanonicalMqttIngestion(
            new ObjectMapper(),
            Clock.fixed(Instant.parse("2026-07-28T09:00:00Z"), ZoneOffset.UTC)
    );
    private final MqttIngressValidator validator = new MqttIngressValidator();

    @Test
    void acceptsMatchingMissingAndMixedIdentityAliases() {
        assertThat(validate("resq/M01/status", """
                {"device_id":"M01","deviceId":"M01","manikin_id":"M01","manikinId":"M01"}
                """).accepted()).isTrue();
        assertThat(validate("resq/M01/heartbeat", "{}").accepted()).isTrue();
    }

    @Test
    void rejectsEveryMismatchingIdentityAlias() {
        for (String alias : new String[]{"device_id", "deviceId", "manikin_id", "manikinId"}) {
            var decision = validate("resq/M01/status", "{\"%s\":\"M02\"}".formatted(alias));
            assertThat(decision.disposition()).isEqualTo(MqttIngressValidator.Disposition.IDENTITY_MISMATCH);
        }
        assertThat(validator.counters().identityMismatchCount()).isEqualTo(4);
    }

    @Test
    void canonicalAndLegacyTopicsShareOneOrderingDomain() {
        assertThat(validate("resq/M01/status", ordered("boot-a", 5, "PAIRED_IDLE")).accepted()).isTrue();
        assertThat(validate("resq/manikins/M01/heartbeat", ordered("boot-a", 4, "PAIRED_IDLE")).disposition())
                .isEqualTo(MqttIngressValidator.Disposition.STALE_SEQUENCE);
        assertThat(validator.counters().legacyTopicMessageCount()).isEqualTo(1);
    }

    @Test
    void handlesHigherDuplicateConflictAndNewBootSequences() {
        String first = ordered("boot-a", 5, "PAIRED_IDLE");
        assertThat(validate("resq/M01/status", first).accepted()).isTrue();
        assertThat(validate("resq/M01/status", first).disposition())
                .isEqualTo(MqttIngressValidator.Disposition.DUPLICATE_SEQUENCE);
        assertThat(validate("resq/M01/status", ordered("boot-a", 5, "READY_FOR_SESSION")).disposition())
                .isEqualTo(MqttIngressValidator.Disposition.CONFLICTING_SEQUENCE);
        assertThat(validate("resq/M01/status", ordered("boot-a", 6, "READY_FOR_SESSION")).accepted()).isTrue();
        assertThat(validate("resq/M01/status", ordered("boot-b", 1, "BOOTING")).disposition())
                .isEqualTo(MqttIngressValidator.Disposition.ACCEPTED_NEW_BOOT);
        assertThat(validate("resq/M01/status", ordered("boot-a", 7, "READY_FOR_SESSION")).disposition())
                .isEqualTo(MqttIngressValidator.Disposition.STALE_SEQUENCE);
    }

    @Test
    void marksMissingOrderingAsLegacyAndRejectsPartialOrNegativeOrdering() {
        assertThat(validate("resq/M01/status", "{}").disposition())
                .isEqualTo(MqttIngressValidator.Disposition.ACCEPTED_LEGACY_UNORDERED);
        assertThat(validate("resq/M02/status", "{\"boot_id\":\"boot-a\"}").disposition())
                .isEqualTo(MqttIngressValidator.Disposition.MALFORMED_ORDERING);
        assertThat(validate("resq/M03/status", "{\"boot_id\":\"boot-a\",\"state_seq\":-1}").disposition())
                .isEqualTo(MqttIngressValidator.Disposition.MALFORMED_ORDERING);
    }

    @Test
    void doesNotApplyStateOrderingToHighRateTelemetry() {
        String sample = "{\"boot_id\":\"boot-a\",\"state_seq\":5,\"state\":\"SESSION_ACTIVE\"}";
        assertThat(validate("resq/M01/telemetry", sample).accepted()).isTrue();
        assertThat(validate("resq/M01/telemetry", sample).accepted()).isTrue();
    }

    private MqttIngressValidator.ValidationDecision validate(String topic, String json) {
        return validator.validate(envelope(topic, json));
    }

    private MqttIngestionEnvelope envelope(String topic, String json) {
        return ingestion.parse(topic, json.getBytes(StandardCharsets.UTF_8)).envelope();
    }

    private static String ordered(String bootId, long sequence, String state) {
        return """
                {"boot_id":"%s","state_seq":%d,"state":"%s"}
                """.formatted(bootId, sequence, state);
    }
}
