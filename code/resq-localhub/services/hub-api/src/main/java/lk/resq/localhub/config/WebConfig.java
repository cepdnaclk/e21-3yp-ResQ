package lk.resq.localhub.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Development-only CORS so the Tauri webview can call the local API during desktop dev.
        registry.addMapping("/api/**")
                .allowedOriginPatterns(
                        "http://localhost:1420",
                        "http://127.0.0.1:1420",
                        "http://*:1420",
                        "tauri://localhost"
                )
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}