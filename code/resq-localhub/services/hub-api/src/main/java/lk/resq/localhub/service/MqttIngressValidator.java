package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.JsonNode;
import lk.resq.localhub.model.ingestion.MqttIngestionEnvelope;
import lk.resq.localhub.model.ingestion.MqttTopicFamily;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.LongAdder;

final class MqttIngressValidator {
    private final Map<String, OrderingState> orderingByDevice = new HashMap<>();
    private final Map<String, Set<String>> observedBootsByDevice = new HashMap<>();
    private final LongAdder identityMismatchCount = new LongAdder();
    private final LongAdder staleSequenceCount = new LongAdder();
    private final LongAdder duplicateSequenceCount = new LongAdder();
    private final LongAdder conflictingSequenceCount = new LongAdder();
    private final LongAdder malformedOrderingCount = new LongAdder();
    private final LongAdder legacyUnorderedMessageCount = new LongAdder();
    private final LongAdder legacyTopicMessageCount = new LongAdder();

    synchronized ValidationDecision validate(MqttIngestionEnvelope envelope) {
        if (envelope.legacyTopicUsed()) {
            legacyTopicMessageCount.increment();
        }

        String identityError = validatePayloadIdentity(envelope.canonicalDeviceId(), envelope.normalizedPayload());
        if (identityError != null) {
            identityMismatchCount.increment();
            return ValidationDecision.rejected(Disposition.IDENTITY_MISMATCH, identityError);
        }

        if (!usesStateOrdering(envelope.topicFamily())) {
            return ValidationDecision.valid();
        }

        String bootId = normalized(envelope.bootId());
        Long sequence = envelope.stateSequence();
        if (bootId == null && sequence == null) {
            legacyUnorderedMessageCount.increment();
            return ValidationDecision.acceptedLegacyUnordered();
        }
        if (bootId == null || sequence == null || sequence < 0) {
            malformedOrderingCount.increment();
            return ValidationDecision.rejected(
                    Disposition.MALFORMED_ORDERING,
                    "boot_id and a non-negative state_seq must be supplied together"
            );
        }

        String fingerprint = envelope.normalizedPayload().toString();
        OrderingState current = orderingByDevice.get(envelope.canonicalDeviceId());
        Set<String> observedBoots = observedBootsByDevice.computeIfAbsent(
                envelope.canonicalDeviceId(),
                ignored -> new HashSet<>()
        );
        if (current == null) {
            observedBoots.add(bootId);
            orderingByDevice.put(envelope.canonicalDeviceId(), new OrderingState(bootId, sequence, fingerprint));
            return ValidationDecision.valid();
        }

        if (!current.bootId().equals(bootId)) {
            if (observedBoots.contains(bootId)) {
                staleSequenceCount.increment();
                return ValidationDecision.rejected(
                        Disposition.STALE_SEQUENCE,
                        "message belongs to a previously superseded boot"
                );
            }
            observedBoots.add(bootId);
            orderingByDevice.put(envelope.canonicalDeviceId(), new OrderingState(bootId, sequence, fingerprint));
            return ValidationDecision.acceptedNewBoot();
        }

        if (sequence < current.sequence()) {
            staleSequenceCount.increment();
            return ValidationDecision.rejected(
                    Disposition.STALE_SEQUENCE,
                    "state_seq is lower than the latest accepted sequence"
            );
        }
        if (sequence.equals(current.sequence())) {
            if (fingerprint.equals(current.fingerprint())) {
                duplicateSequenceCount.increment();
                return ValidationDecision.rejected(
                        Disposition.DUPLICATE_SEQUENCE,
                        "state_seq and content duplicate the latest accepted message"
                );
            }
            conflictingSequenceCount.increment();
            return ValidationDecision.rejected(
                    Disposition.CONFLICTING_SEQUENCE,
                    "state_seq matches the latest message but content differs"
            );
        }

        orderingByDevice.put(envelope.canonicalDeviceId(), new OrderingState(bootId, sequence, fingerprint));
        return ValidationDecision.valid();
    }

    DiagnosticCounters counters() {
        return new DiagnosticCounters(
                identityMismatchCount.sum(),
                staleSequenceCount.sum(),
                duplicateSequenceCount.sum(),
                conflictingSequenceCount.sum(),
                malformedOrderingCount.sum(),
                legacyUnorderedMessageCount.sum(),
                legacyTopicMessageCount.sum()
        );
    }

    private static boolean usesStateOrdering(MqttTopicFamily family) {
        return family != MqttTopicFamily.TELEMETRY && family != MqttTopicFamily.DEBUG;
    }

    private static String validatePayloadIdentity(String canonicalDeviceId, JsonNode payload) {
        for (String alias : new String[]{"device_id", "deviceId", "manikin_id", "manikinId"}) {
            JsonNode value = payload.get(alias);
            if (value == null || value.isNull()) {
                continue;
            }
            if (!value.isValueNode() || value.asText().isBlank()) {
                return "payload identity alias " + alias + " is malformed";
            }
            if (!canonicalDeviceId.equals(value.asText().trim())) {
                return "payload identity alias " + alias + " differs from the topic identity";
            }
        }
        return null;
    }

    private static String normalized(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    enum Disposition {
        ACCEPTED,
        ACCEPTED_NEW_BOOT,
        ACCEPTED_LEGACY_UNORDERED,
        IDENTITY_MISMATCH,
        STALE_SEQUENCE,
        DUPLICATE_SEQUENCE,
        CONFLICTING_SEQUENCE,
        MALFORMED_ORDERING
    }

    record ValidationDecision(boolean accepted, Disposition disposition, String reason) {
        static ValidationDecision valid() {
            return new ValidationDecision(true, Disposition.ACCEPTED, null);
        }

        static ValidationDecision acceptedNewBoot() {
            return new ValidationDecision(true, Disposition.ACCEPTED_NEW_BOOT, null);
        }

        static ValidationDecision acceptedLegacyUnordered() {
            return new ValidationDecision(true, Disposition.ACCEPTED_LEGACY_UNORDERED, null);
        }

        static ValidationDecision rejected(Disposition disposition, String reason) {
            return new ValidationDecision(false, disposition, reason);
        }
    }

    record DiagnosticCounters(
            long identityMismatchCount,
            long staleSequenceCount,
            long duplicateSequenceCount,
            long conflictingSequenceCount,
            long malformedOrderingCount,
            long legacyUnorderedMessageCount,
            long legacyTopicMessageCount
    ) {
    }

    private record OrderingState(String bootId, Long sequence, String fingerprint) {
    }
}
