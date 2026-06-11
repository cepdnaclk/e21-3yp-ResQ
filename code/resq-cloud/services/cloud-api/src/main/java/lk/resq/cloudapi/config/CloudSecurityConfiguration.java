package lk.resq.cloudapi.config;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableConfigurationProperties(CloudAuthProperties.class)
public class CloudSecurityConfiguration {

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    SecurityFilterChain cloudSecurityFilterChain(
            HttpSecurity http,
            CloudJwtAuthenticationFilter jwtFilter,
            CloudHubAuthenticationFilter hubFilter
    ) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> {
                })
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, error) ->
                                writeError(response, 401, "authentication_required"))
                        .accessDeniedHandler((request, response, error) ->
                                writeError(response, 403, "access_denied")))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/error").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/cloud/health").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/cloud/auth/login").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/sync/session-summaries").permitAll()
                        // Roster pull: authenticated only by hub API key (ROLE_HUB), NOT permitAll.
                        .requestMatchers(HttpMethod.GET, "/api/sync/roster").hasRole("HUB")
                        .requestMatchers("/api/cloud/auth/me", "/api/cloud/auth/logout").authenticated()
                        .requestMatchers(HttpMethod.POST, "/api/cloud/users/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PATCH, "/api/cloud/users/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/cloud/courses/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PATCH, "/api/cloud/courses/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.DELETE, "/api/cloud/courses/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.GET, "/api/cloud/session-summaries/**")
                            .hasAnyRole("ADMIN", "INSTRUCTOR", "TRAINEE")
                        .requestMatchers(HttpMethod.GET, "/api/cloud/courses/*/session-summaries")
                            .hasAnyRole("ADMIN", "INSTRUCTOR", "TRAINEE")
                        .requestMatchers(HttpMethod.GET, "/api/cloud/users/*/session-summaries")
                            .hasAnyRole("ADMIN", "INSTRUCTOR", "TRAINEE")
                        .requestMatchers(HttpMethod.GET, "/api/cloud/users/**")
                            .hasAnyRole("ADMIN", "INSTRUCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/cloud/courses/**")
                            .hasAnyRole("ADMIN", "INSTRUCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/cloud/sessions/**")
                            .hasAnyRole("ADMIN", "INSTRUCTOR")
                        .requestMatchers(HttpMethod.GET, "/api/sync/session-summaries/**")
                            .hasAnyRole("ADMIN", "INSTRUCTOR")
                        .anyRequest().authenticated())
                // Hub filter runs before JWT filter so it can authenticate hub requests
                // independently of JWT tokens.
                .addFilterBefore(hubFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    private static void writeError(
            HttpServletResponse response,
            int status,
            String error
    ) throws java.io.IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
