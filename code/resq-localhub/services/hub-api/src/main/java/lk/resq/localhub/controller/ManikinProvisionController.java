package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/manikins")
public class ManikinProvisionController {

    private final AuthService authService;

    // Spring Boot automatically provides the AuthService here.
    // This is called Dependency Injection — you ask for what you
    // need in the constructor and Spring hands it to you.
    public ManikinProvisionController(AuthService authService) {
        this.authService = authService;
    }

    // The JSON body the frontend sends: { "deviceId": "M01" }
    public record PairRequestBody(String deviceId) {}

    // The JSON response we send back to the frontend
    public record PairingTokenResponse(
        String deviceId,
        String token,
        String expiresAt
    ) {}

    @PostMapping("/pair-request")
    public ResponseEntity<?> createPairRequest(
            HttpServletRequest request,
            @RequestBody PairRequestBody body
    ) {
        try {
            // Check the logged-in user is INSTRUCTOR or ADMIN.
            // This throws ForbiddenException if they're not.
            var actor = authService.requireRole(
                request, UserRole.INSTRUCTOR, UserRole.ADMIN
            );

            // Reject empty device IDs before doing any real work
            if (body.deviceId() == null || body.deviceId().isBlank()) {
                return ResponseEntity
                    .badRequest()
                    .body(new ApiErrorResponse("deviceId is required"));
            }

            // Generate a random one-time token. UUID gives us something
            // like "a3f8c2d1-..." which is unpredictable enough for a
            // short-lived local training token.
            String token = UUID.randomUUID().toString();

            // Token expires 15 minutes from now
            String expiresAt = Instant.now()
                .plus(15, ChronoUnit.MINUTES)
                .toString();

            // Write an audit record so admins can see who requested
            // pairing for which device
            authService.audit(
                actor.id(),
                "PAIR_REQUEST_CREATED",
                "manikin",
                body.deviceId(),
                Map.of("expiresAt", expiresAt)
            );

            return ResponseEntity.ok(
                new PairingTokenResponse(body.deviceId(), token, expiresAt)
            );

        } catch (ForbiddenException e) {
            // Log the denied attempt then return 403
            authService.maybeAuth(request).ifPresentOrElse(
                user -> authService.audit(user.id(), "ACCESS_DENIED",
                    "manikin", "pair-request", Map.of()),
                () -> authService.audit(null, "ACCESS_DENIED",
                    "manikin", "pair-request", Map.of())
            );
            return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(new ApiErrorResponse(
                    "Insufficient permissions to create pairing request"
                ));
        }
    }
}