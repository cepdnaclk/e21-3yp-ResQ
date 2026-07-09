package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

class FirmwareRequestIdGeneratorTest {

    private final FirmwareRequestIdGenerator generator = new FirmwareRequestIdGenerator();

    @Test
    void formatsRequestIdsCorrectly() {
        assertThat(generator.nextRequestId(200)).isEqualTo("req-200-0001");
        assertThat(generator.nextRequestId(200)).isEqualTo("req-200-0002");
        assertThat(generator.nextRequestId(201)).isEqualTo("req-201-0001");
    }

    @Test
    void incrementsSafelyUnderConcurrentAccess() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(10);
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            tasks.add(() -> generator.nextRequestId(200));
        }

        List<Future<String>> futures = executor.invokeAll(tasks);
        List<String> results = new ArrayList<>();
        for (Future<String> future : futures) {
            results.add(future.get());
        }
        executor.shutdown();

        assertThat(results).hasSize(100).doesNotContainNull().doesNotHaveDuplicates();
        assertThat(generator.nextRequestId(200)).isEqualTo("req-200-0101");
    }
}
