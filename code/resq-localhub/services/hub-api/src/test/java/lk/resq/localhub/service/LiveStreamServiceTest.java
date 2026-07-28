package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class LiveStreamServiceTest {
    @Test
    void suppressesDuplicateUnchangedInstructorUpdates() {
        LiveStreamService service = new LiveStreamService();

        service.publishInstructorLive(List.of());
        service.publishInstructorLive(List.of());

        assertThat(service.suppressedDuplicateUpdateCount()).isEqualTo(1);
    }
}
