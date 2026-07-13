package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareRequestIds;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class CommandRequestIdGenerator {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int HUB_INSTANCE_BYTES = 4;

    private final String hubInstanceId;
    private final AtomicLong sequence = new AtomicLong(0L);

    public CommandRequestIdGenerator() {
        this(randomHubInstanceId());
    }

    CommandRequestIdGenerator(String hubInstanceId) {
        this.hubInstanceId = requireHubInstanceId(hubInstanceId);
    }

    public String next(FirmwareCommandTypeId commandType) {
        Objects.requireNonNull(commandType, "commandType must not be null");
        return FirmwareRequestIds.format(commandType.value(), hubInstanceId, sequence.incrementAndGet());
    }

    public String currentHubInstanceId() {
        return hubInstanceId;
    }

    private static String randomHubInstanceId() {
        byte[] bytes = new byte[HUB_INSTANCE_BYTES];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private static String requireHubInstanceId(String value) {
        if (value == null || !value.matches("[0-9a-f]{8,12}")) {
            throw new IllegalArgumentException("hubInstanceId must be 8-12 lowercase hexadecimal characters");
        }
        return value;
    }
}
