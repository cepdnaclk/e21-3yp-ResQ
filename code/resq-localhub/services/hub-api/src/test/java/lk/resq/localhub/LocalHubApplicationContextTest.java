package lk.resq.localhub;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Spring ApplicationContext smoke test.
 *
 * Verifies that all beans can be constructed and wired successfully.
 * This test will FAIL if any bean has a broken constructor (e.g. missing
 * @Autowired when multiple constructors exist) and PASS once the wiring
 * is correct.
 */
@SpringBootTest
class LocalHubApplicationContextTest {

    @Test
    void contextLoads() {
        // If Spring cannot build the ApplicationContext the test framework
        // throws before this body is reached, so no assertions are needed.
    }
}
