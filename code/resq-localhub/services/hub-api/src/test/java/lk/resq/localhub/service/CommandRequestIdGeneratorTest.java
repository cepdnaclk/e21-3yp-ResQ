package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.FirmwareCommandTypeId;
import lk.resq.localhub.model.firmware.FirmwareRequestIds;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class CommandRequestIdGeneratorTest {
    private static final Pattern REQUEST_ID_PATTERN = Pattern.compile("^req-(\\d+)-([0-9a-f]{8})-(\\d{6,})$");

    @Test
    void usesSameProcessInstanceIdAndDifferentSequences() {
        CommandRequestIdGenerator generator = new CommandRequestIdGenerator("a4f18d2c");

        String first = generator.next(FirmwareCommandTypeId.SESSION_START);
        String second = generator.next(FirmwareCommandTypeId.SESSION_START);

        assertThat(first).isEqualTo("req-300-a4f18d2c-000001");
        assertThat(second).isEqualTo("req-300-a4f18d2c-000002");
    }

    @Test
    void differentGeneratorInstancesDoNotCollide() {
        CommandRequestIdGenerator first = new CommandRequestIdGenerator();
        CommandRequestIdGenerator second = new CommandRequestIdGenerator();

        assertThat(first.currentHubInstanceId()).isNotEqualTo(second.currentHubInstanceId());
        assertThat(first.next(FirmwareCommandTypeId.SESSION_START))
                .isNotEqualTo(second.next(FirmwareCommandTypeId.SESSION_START));
    }

    @Test
    void incrementsSafelyUnderConcurrentAccess() throws Exception {
        CommandRequestIdGenerator generator = new CommandRequestIdGenerator("a4f18d2c");
        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            tasks.add(() -> generator.next(FirmwareCommandTypeId.CALIBRATION_START));
        }

        List<Future<String>> futures = executor.invokeAll(tasks);
        List<String> results = new ArrayList<>();
        for (Future<String> future : futures) {
            results.add(future.get());
        }
        executor.shutdown();

        assertThat(results).hasSize(100).doesNotContainNull().doesNotHaveDuplicates();
        assertThat(Set.copyOf(results)).hasSize(100);
    }

    @Test
    void preservesCommandTypeForGeneratedIds() {
        CommandRequestIdGenerator generator = new CommandRequestIdGenerator("a4f18d2c");

        assertThat(FirmwareRequestIds.parseCommandTypeId(generator.next(FirmwareCommandTypeId.SESSION_START)))
                .hasValue(FirmwareCommandTypeId.SESSION_START.value());
        assertThat(FirmwareRequestIds.parseCommandTypeId(generator.next(FirmwareCommandTypeId.SESSION_STOP)))
                .hasValue(FirmwareCommandTypeId.SESSION_STOP.value());
        assertThat(FirmwareRequestIds.parseCommandTypeId(generator.next(FirmwareCommandTypeId.CALIBRATION_START)))
                .hasValue(FirmwareCommandTypeId.CALIBRATION_START.value());
    }

    @Test
    void supportsHistoricalAndNewFormats() {
        assertThat(FirmwareRequestIds.parseCommandTypeId("req-300-0001"))
                .hasValue(FirmwareCommandTypeId.SESSION_START.value());
        assertThat(FirmwareRequestIds.parseCommandTypeId("req-300-a4f18d2c-000001"))
                .hasValue(FirmwareCommandTypeId.SESSION_START.value());
        assertThat(REQUEST_ID_PATTERN.matcher(new CommandRequestIdGenerator("a4f18d2c")
                .next(FirmwareCommandTypeId.SESSION_START)).matches()).isTrue();
    }

    @Test
    void rejectsMalformedIdsSafely() {
        assertThat(FirmwareRequestIds.parseCommandTypeId(null)).isEmpty();
        assertThat(FirmwareRequestIds.parseCommandTypeId("bad-value")).isEmpty();
        assertThat(FirmwareRequestIds.parseCommandTypeId("req-300")).isEmpty();
        assertThat(FirmwareRequestIds.parseCommandTypeId("req-300-a4f18d2c")).isEmpty();
    }
}
