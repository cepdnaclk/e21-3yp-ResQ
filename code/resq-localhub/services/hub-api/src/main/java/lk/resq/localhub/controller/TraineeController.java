package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.TraineeRecord;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.TraineeRecordsRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.sql.SQLException;
import java.util.Map;

@RestController
@RequestMapping("/api/trainees")
public class TraineeController {

    private final TraineeRecordsRepository traineeRecordsRepository;
    private final AuthService authService;

    public TraineeController(TraineeRecordsRepository traineeRecordsRepository, AuthService authService) {
        this.traineeRecordsRepository = traineeRecordsRepository;
        this.authService = authService;
    }

    /**
     * GET /api/trainees - List all active trainee records.
     * Only ADMIN and INSTRUCTOR can access.
     */
    @GetMapping
    public ResponseEntity<?> listTrainees(HttpServletRequest request) {
        try {
            authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
            return ResponseEntity.ok(traineeRecordsRepository.listActiveTrainees());
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(new ApiErrorResponse("Insufficient permissions to view trainees"));
        } catch (SQLException error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ApiErrorResponse("Database error: " + error.getMessage()));
        }
    }

    /**
     * GET /api/trainees/{id} - Get a specific trainee record by ID.
     * Only ADMIN and INSTRUCTOR can access.
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getTrainee(HttpServletRequest request, @PathVariable String id) {
        try {
            authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
            return traineeRecordsRepository.findTraineeById(id)
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("Trainee record not found: " + id)));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(new ApiErrorResponse("Insufficient permissions to view trainees"));
        } catch (SQLException error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ApiErrorResponse("Database error: " + error.getMessage()));
        }
    }

    /**
     * POST /api/trainees - Create a new trainee record.
     * Only ADMIN and INSTRUCTOR can access.
     */
    @PostMapping
    public ResponseEntity<?> createTrainee(HttpServletRequest request, @RequestBody CreateTraineeRequest body) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);

            // Validate input
            if (body.traineeCode() == null || body.traineeCode().isBlank()) {
                return ResponseEntity.badRequest()
                        .body(new ApiErrorResponse("traineeCode is required"));
            }
            if (body.displayName() == null || body.displayName().isBlank()) {
                return ResponseEntity.badRequest()
                        .body(new ApiErrorResponse("displayName is required"));
            }

            TraineeRecord record = traineeRecordsRepository.createTrainee(
                    body.traineeCode(),
                    body.displayName(),
                    body.groupName(),
                    body.notes()
            );

            authService.audit(actor.id(), "TRAINEE_CREATED", "trainee", record.id(), Map.of(
                    "code", record.traineeCode(),
                    "display_name", record.displayName()
            ));

            return ResponseEntity.status(HttpStatus.CREATED).body(record);
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(new ApiErrorResponse("Insufficient permissions to create trainees"));
        } catch (SQLException error) {
            if (error.getMessage().contains("UNIQUE")) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(new ApiErrorResponse("Trainee code already exists"));
            }
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ApiErrorResponse("Database error: " + error.getMessage()));
        }
    }

    /**
     * PATCH /api/trainees/{id} - Update an existing trainee record.
     * Only ADMIN and INSTRUCTOR can access.
     */
    @PatchMapping("/{id}")
    public ResponseEntity<?> updateTrainee(HttpServletRequest request, @PathVariable String id,
                                          @RequestBody UpdateTraineeRequest body) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);

            TraineeRecord record = traineeRecordsRepository.updateTrainee(
                    id,
                    body.displayName(),
                    body.groupName(),
                    body.notes()
            );

            authService.audit(actor.id(), "TRAINEE_UPDATED", "trainee", id, Map.of(
                    "display_name", body.displayName() != null ? body.displayName() : "unchanged"
            ));

            return ResponseEntity.ok(record);
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(new ApiErrorResponse("Insufficient permissions to update trainees"));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(error.getMessage()));
        } catch (SQLException error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ApiErrorResponse("Database error: " + error.getMessage()));
        }
    }

    /**
     * POST /api/trainees/{id}/archive - Archive a trainee record (soft delete).
     * Only ADMIN and INSTRUCTOR can access.
     */
    @PostMapping("/{id}/archive")
    public ResponseEntity<?> archiveTrainee(HttpServletRequest request, @PathVariable String id) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);

            traineeRecordsRepository.archiveTrainee(id);

            authService.audit(actor.id(), "TRAINEE_ARCHIVED", "trainee", id, Map.of());

            return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(new ApiErrorResponse("Insufficient permissions to archive trainees"));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(error.getMessage()));
        } catch (SQLException error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ApiErrorResponse("Database error: " + error.getMessage()));
        }
    }

    // Request DTOs
    public record CreateTraineeRequest(
            String traineeCode,
            String displayName,
            String groupName,
            String notes
    ) {
    }

    public record UpdateTraineeRequest(
            String displayName,
            String groupName,
            String notes
    ) {
    }
}
