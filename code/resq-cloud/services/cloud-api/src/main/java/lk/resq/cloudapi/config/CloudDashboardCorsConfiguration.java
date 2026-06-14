package lk.resq.cloudapi.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Configuration
public class CloudDashboardCorsConfiguration implements WebMvcConfigurer {

    /**
     * Comma-separated list of additional allowed origins supplied via
     * the {@code RESQ_CLOUD_CORS_ALLOWED_ORIGINS} environment variable.
     * <p>
     * Local dev origins (http://localhost:* and http://127.0.0.1:*) are always
     * included regardless of this value, so local development is never broken.
     * <p>
     * Production example: {@code https://main.xxxx.amplifyapp.com}
     */
    @Value("${resq.cloud-cors.allowed-origins:}")
    private String extraAllowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = resolveAllowedOriginPatterns();
        addMapping(registry, "/api/cloud/health", origins, "GET");
        addMapping(registry, "/api/cloud/auth/**", origins, "GET", "POST", "OPTIONS");
        addMapping(registry, "/api/cloud/sessions/**", origins, "GET");
        addMapping(registry, "/api/cloud/users/**", origins, "GET", "POST", "PATCH", "OPTIONS");
        addMapping(registry, "/api/cloud/courses/**", origins, "GET", "POST", "PATCH", "DELETE", "OPTIONS");
        addMapping(registry, "/api/sync/**", origins, "GET", "POST", "OPTIONS");
    }

    /**
     * Builds the effective list of allowed origin patterns.
     * Always includes local dev patterns; adds any extra origins from env var.
     */
    private String[] resolveAllowedOriginPatterns() {
        List<String> origins = new ArrayList<>(List.of(
                "http://localhost:*",
                "http://127.0.0.1:*"
        ));
        if (extraAllowedOrigins != null && !extraAllowedOrigins.isBlank()) {
            Arrays.stream(extraAllowedOrigins.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(origins::add);
        }
        return origins.toArray(String[]::new);
    }

    private static void addMapping(
            CorsRegistry registry,
            String path,
            String[] origins,
            String... methods
    ) {
        registry.addMapping(path)
                .allowedOriginPatterns(origins)
                .allowedMethods(methods)
                .allowedHeaders("Accept", "Content-Type", "Authorization")
                .maxAge(3600);
    }
}

