package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import org.springframework.stereotype.Component;

@Component
public class FirmwareRequestIdGenerator {
    private final CommandRequestIdGenerator delegate;

    public FirmwareRequestIdGenerator(CommandRequestIdGenerator delegate) {
        this.delegate = delegate;
    }

    public FirmwareRequestIdGenerator() {
        this(new CommandRequestIdGenerator());
    }

    public String nextRequestId(int commandTypeId) {
        FirmwareCommandTypeId commandType = FirmwareCommandTypeId.fromValue(commandTypeId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown firmware command type id " + commandTypeId));
        return delegate.next(commandType);
    }
}
