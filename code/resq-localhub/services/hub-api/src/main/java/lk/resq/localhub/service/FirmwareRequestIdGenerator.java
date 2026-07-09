package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.FirmwareRequestIds;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class FirmwareRequestIdGenerator {
    private final ConcurrentHashMap<Integer, AtomicLong> sequences = new ConcurrentHashMap<>();

    public String nextRequestId(int commandTypeId) {
        long seq = sequences.computeIfAbsent(commandTypeId, id -> new AtomicLong(0L)).incrementAndGet();
        return FirmwareRequestIds.format(commandTypeId, Math.toIntExact(seq));
    }
}
