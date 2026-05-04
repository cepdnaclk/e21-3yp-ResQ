package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthBootstrapResponse;
import lk.resq.localhub.model.AuthStatusResponse;
import lk.resq.localhub.model.AuthTokenIssue;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.CreateFirstAdminRequest;
import lk.resq.localhub.model.CreateUserRequest;
import lk.resq.localhub.model.LoginRequest;
import lk.resq.localhub.model.LoginResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.UnauthorizedException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final String AUTH_COOKIE_NAME = "RESQ_LOCALHUB_AUTH";

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/bootstrap")
    public AuthBootstrapResponse bootstrap() {
        return authService.bootstrap();
    }

    @GetMapping("/status")
    public AuthStatusResponse status() {
        return authService.status();
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        return issueSession(() -> authService.login(request));
    }

    @PostMapping("/setup")
    public ResponseEntity<?> setup(@RequestBody CreateFirstAdminRequest request) {
        return issueSession(() -> authService.setupFirstAdmin(request));
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletRequest request) {
        authService.logout(request);
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, clearCookie().toString())
                .build();
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(HttpServletRequest request) {
        try {
            AuthUser user = authService.requireAuth(request);
            return ResponseEntity.ok(user);
        } catch (UnauthorizedException error) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/users")
    public ResponseEntity<?> listUsers(HttpServletRequest request) {
        try {
            List<AuthUser> users = authService.listUsers(request);
            return ResponseEntity.ok(users);
        } catch (UnauthorizedException error) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @PostMapping("/users")
    public ResponseEntity<?> createUser(HttpServletRequest request, @RequestBody CreateUserRequest createUserRequest) {
        try {
            AuthUser created = authService.createUser(request, createUserRequest);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (UnauthorizedException error) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @PostMapping("/users/{userId}/disable")
    public ResponseEntity<?> disableUser(HttpServletRequest request, @PathVariable String userId) {
        try {
            AuthUser disabled = authService.disableUser(request, userId);
            return ResponseEntity.ok(disabled);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (UnauthorizedException error) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    private ResponseEntity<?> issueSession(SessionIssuer issuer) {
        try {
            AuthTokenIssue issue = issuer.issue();
            long maxAgeSeconds = Math.max(0L, Duration.between(Instant.now(), issue.expiresAt()).getSeconds());
            String token = java.util.Objects.requireNonNull(issue.token(), "Auth token must not be null");
            ResponseCookie cookie = ResponseCookie.from(AUTH_COOKIE_NAME, token)
                    .httpOnly(true)
                    .sameSite("Lax")
                    .path("/")
                    .maxAge(maxAgeSeconds)
                    .build();
            LoginResponse response = new LoginResponse(issue.user(), issue.expiresAt());
            return ResponseEntity.ok()
                    .header(HttpHeaders.SET_COOKIE, cookie.toString())
                    .body(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (UnauthorizedException error) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @FunctionalInterface
    private interface SessionIssuer {
        AuthTokenIssue issue();
    }

    private ResponseCookie clearCookie() {
        return ResponseCookie.from(AUTH_COOKIE_NAME, "")
                .httpOnly(true)
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build();
    }
}
