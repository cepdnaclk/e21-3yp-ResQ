package lk.resq.cloudapi.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CloudDashboardCorsConfiguration implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        addLocalDashboardMapping(registry, "/api/cloud/health", "GET");
        addLocalDashboardMapping(registry, "/api/cloud/sessions/**", "GET");
        addLocalDashboardMapping(registry, "/api/cloud/users/**", "GET", "POST", "PATCH", "OPTIONS");
        addLocalDashboardMapping(registry, "/api/cloud/courses/**", "GET", "POST", "PATCH", "DELETE", "OPTIONS");
    }

    private static void addLocalDashboardMapping(
            CorsRegistry registry,
            String path,
            String... methods
    ) {
        registry.addMapping(path)
                .allowedOriginPatterns("http://localhost:*", "http://127.0.0.1:*")
                .allowedMethods(methods)
                .allowedHeaders("Accept", "Content-Type")
                .maxAge(3600);
    }
}
