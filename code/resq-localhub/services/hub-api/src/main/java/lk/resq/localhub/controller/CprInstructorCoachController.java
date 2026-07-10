package lk.resq.localhub.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cpr.CprInstructorCoachQueryRequest;
import lk.resq.localhub.model.cpr.CprInstructorCoachResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CprInstructorCoachService;
import lk.resq.localhub.service.ForbiddenException;

@RestController
@RequestMapping("/api/instructor/coach")
public class CprInstructorCoachController {

    private final AuthService authService;
    private final CprInstructorCoachService instructorCoachService;

    @Autowired
    public CprInstructorCoachController(
            AuthService authService,
            CprInstructorCoachService instructorCoachService
    ) {
        this.authService = authService;
        this.instructorCoachService = instructorCoachService;
    }

    @PostMapping("/query")
    public ResponseEntity<?> queryInstructorCoach(HttpServletRequest request, @RequestBody CprInstructorCoachQueryRequest requestBody) {
        try {
            // Require instructor or admin role
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);

            if (requestBody == null) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("Request body is required."));
            }

            if (requestBody.question() == null || requestBody.question().trim().isEmpty()) {
                return ResponseEntity.badRequest().body(new ApiErrorResponse("question cannot be empty."));
            }

            CprInstructorCoachResponse response = instructorCoachService.generateResponse(requestBody);
            return ResponseEntity.ok(response);
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (Exception error) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ApiErrorResponse("Failed to generate instructor coach response: " + error.getMessage()));
        }
    }
}
