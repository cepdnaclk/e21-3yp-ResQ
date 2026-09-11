package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class CalibrationProfileFingerprintServiceTest {

    @Test
    void testComputeHashMatchesKnownAnswerVector() {
        CalibrationProfileFingerprintService service = new CalibrationProfileFingerprintService();
        String hash = service.computeHash(
            "adult-basic",
            1,
            13500,
            20100,
            15000,
            15000
        );

        assertThat(hash).isEqualTo("d9c9747c1ede10bf156a16e33f67f39bc21694d42fc91a35be50df7d7e24ca4a");
    }
}
