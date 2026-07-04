package lk.resq.localhub.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(@NonNull CorsRegistry registry) {
        // Allow both the Vite dev server and Tauri's packaged webview origin.
        registry.addMapping("/api/**")
                .allowedOriginPatterns(
                        "http://localhost:1420",
                        "http://127.0.0.1:1420",
                        "http://*:1420",
                        "tauri://localhost",
                        "http://tauri.localhost",
                        "https://tauri.localhost"
                )
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
