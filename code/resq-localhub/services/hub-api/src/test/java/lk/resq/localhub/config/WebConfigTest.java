package lk.resq.localhub.config;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.CorsFilter;

class WebConfigTest {

    private final CorsFilter filter = new WebConfig().localHubCorsFilter();

    @Test
    void allowsDesktopDevelopmentAndPrivateLanDashboardOrigins() {
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://localhost:1420")).isTrue();
        assertThat(WebConfig.isAllowedLocalHubOrigin("https://tauri.localhost")).isTrue();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://10.0.0.8:1420")).isTrue();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://172.16.0.8:1420")).isTrue();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://172.31.255.254:1420")).isTrue();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://192.168.137.1:1420")).isTrue();
    }

    @Test
    void rejectsUnrelatedOriginsNonPrivateAddressesAndOtherPorts() {
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://example.com:1420")).isFalse();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://203.0.113.10:1420")).isFalse();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://172.32.0.1:1420")).isFalse();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://192.168.8.10:3000")).isFalse();
        assertThat(WebConfig.isAllowedLocalHubOrigin("https://192.168.8.10:1420")).isFalse();
        assertThat(WebConfig.isAllowedLocalHubOrigin("http://192.168.8.10:1420/path")).isFalse();
    }

    @Test
    void appliesCorsHeadersToLanSseRequests() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(
                "GET", "/api/stream/manikins/live");
        request.addHeader("Origin", "http://192.168.8.100:1420");
        request.addHeader("Accept", "text/event-stream");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean(false);
        FilterChain chain = (servletRequest, servletResponse) -> chainInvoked.set(true);

        filter.doFilter(request, response, chain);

        assertThat(chainInvoked).isTrue();
        assertThat(response.getHeader("Access-Control-Allow-Origin"))
                .isEqualTo("http://192.168.8.100:1420");
        assertThat(response.getHeader("Access-Control-Allow-Credentials")).isEqualTo("true");
    }

    @Test
    void blocksUnrelatedOriginsBeforeTheyReachAnApiEndpoint() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/hub/health");
        request.addHeader("Origin", "http://example.com:1420");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean(false);

        filter.doFilter(request, response, (servletRequest, servletResponse) -> chainInvoked.set(true));

        assertThat(chainInvoked).isFalse();
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getHeader("Access-Control-Allow-Origin")).isNull();
    }
}
