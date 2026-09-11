package lk.resq.localhub.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.Nullable;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

@Configuration
public class WebConfig {

    private static final int DASHBOARD_PORT = 1420;
    private static final Set<String> FIXED_ORIGINS = Set.of(
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost");

    @Bean
    public CorsFilter localHubCorsFilter() {
        CorsConfiguration configuration = new LocalHubCorsConfiguration();
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of(
                "Authorization",
                "Content-Type",
                "Accept",
                "Cache-Control",
                "Last-Event-ID"));
        configuration.setExposedHeaders(List.of("Content-Disposition"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return new CorsFilter(source);
    }

    static boolean isAllowedLocalHubOrigin(String origin) {
        if (FIXED_ORIGINS.contains(origin)) {
            return true;
        }

        final URI uri;
        try {
            uri = new URI(origin);
        } catch (URISyntaxException | NullPointerException exception) {
            return false;
        }

        if (!"http".equalsIgnoreCase(uri.getScheme())
                || uri.getPort() != DASHBOARD_PORT
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty())) {
            return false;
        }

        return isPrivateIpv4Literal(uri.getHost());
    }

    private static boolean isPrivateIpv4Literal(@Nullable String host) {
        if (host == null) {
            return false;
        }

        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) {
            return false;
        }

        int[] octets = new int[4];
        for (int index = 0; index < parts.length; index++) {
            if (parts[index].isEmpty() || !parts[index].chars().allMatch(Character::isDigit)) {
                return false;
            }
            try {
                octets[index] = Integer.parseInt(parts[index]);
            } catch (NumberFormatException exception) {
                return false;
            }
            if (octets[index] < 0 || octets[index] > 255) {
                return false;
            }
        }

        return octets[0] == 10
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168);
    }

    private static final class LocalHubCorsConfiguration extends CorsConfiguration {
        @Override
        @Nullable
        public String checkOrigin(@Nullable String requestOrigin) {
            if (requestOrigin == null) {
                return null;
            }
            return isAllowedLocalHubOrigin(requestOrigin) ? requestOrigin : null;
        }
    }
}
