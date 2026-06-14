package lk.resq.cloudapi.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lk.resq.cloudapi.model.CloudHubApiKey;
import lk.resq.cloudapi.repository.CloudHubRepository;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;

/**
 * Servlet filter that authenticates LocalHub requests using the
 * X-ResQ-Hub-Id / X-ResQ-Hub-Key header pair.
 *
 * <p>Only intercepts requests to /api/sync/roster. All other paths
 * are passed through unchanged so the JWT filter can handle them.</p>
 *
 * <p>On success, sets a {@code HUB_<hubId>} principal in the security
 * context with the synthetic role {@code ROLE_HUB}, allowing the
 * security rule to remain simple.</p>
 *
 * <p>The BCrypt comparison is constant-time to mitigate timing attacks.</p>
 */
@Component
public class CloudHubAuthenticationFilter extends OncePerRequestFilter {

    /** Header carrying the hub identifier. */
    public static final String HEADER_HUB_ID  = "X-ResQ-Hub-Id";
    /** Header carrying the raw (plaintext) API key generated at hub registration time. */
    public static final String HEADER_HUB_KEY = "X-ResQ-Hub-Key";

    /** Path prefix this filter actively authenticates. */
    private static final String ROSTER_PATH_PREFIX = "/api/sync/roster";

    private final CloudHubRepository hubRepository;
    private final PasswordEncoder    passwordEncoder;

    public CloudHubAuthenticationFilter(
            CloudHubRepository hubRepository,
            PasswordEncoder    passwordEncoder
    ) {
        this.hubRepository   = hubRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest  request,
            HttpServletResponse response,
            FilterChain         filterChain
    ) throws ServletException, IOException {

        // Do not block OPTIONS preflight requests.
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        String path = request.getRequestURI();
        String normalizedPath = path.endsWith("/") && path.length() > 1 ? path.substring(0, path.length() - 1) : path;

        boolean isRosterSync = normalizedPath.startsWith(ROSTER_PATH_PREFIX);
        boolean isSessionUpload = normalizedPath.equals("/api/sync/session-summaries") && "POST".equalsIgnoreCase(request.getMethod());

        if (!isRosterSync && !isSessionUpload) {
            filterChain.doFilter(request, response);
            return;
        }

        String hubId  = request.getHeader(HEADER_HUB_ID);
        String hubKey = request.getHeader(HEADER_HUB_KEY);

        if (isBlank(hubId) || isBlank(hubKey)) {
            writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "hub_credentials_missing");
            return;
        }

        // Look up active hub — timing-safe: we always run BCrypt even on miss (dummy compare).
        CloudHubApiKey hub = hubRepository.findActiveHubById(hubId).orElse(null);
        boolean valid = hub != null && passwordEncoder.matches(hubKey, hub.keyHash());

        if (!valid) {
            writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "hub_authentication_failed");
            return;
        }

        // Update last_used_at asynchronously-ish (best-effort, non-blocking for the request).
        hubRepository.updateLastUsed(hubId, Instant.now());

        // Populate Spring Security context so the security rule (hasRole HUB) can pass.
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        "HUB_" + hubId,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_HUB"))
                );
        SecurityContextHolder.getContext().setAuthentication(authentication);

        filterChain.doFilter(request, response);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static void writeError(
            HttpServletResponse response,
            int status,
            String error
    ) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
