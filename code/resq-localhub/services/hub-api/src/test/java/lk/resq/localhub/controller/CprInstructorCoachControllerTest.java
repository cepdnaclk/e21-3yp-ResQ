package lk.resq.localhub.controller;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.cpr.CprInstructorCoachQueryRequest;
import lk.resq.localhub.model.cpr.CprInstructorCoachResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CprInstructorCoachService;

class CprInstructorCoachControllerTest {

    private AuthService authService;
    private CprInstructorCoachService instructorCoachService;
    private CprInstructorCoachController controller;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        instructorCoachService = mock(CprInstructorCoachService.class);
        controller = new CprInstructorCoachController(authService, instructorCoachService);
    }

    @Test
    void deniesTraineeRole() {
        when(authService.requireRole(Mockito.any(), Mockito.eq(UserRole.INSTRUCTOR), Mockito.eq(UserRole.ADMIN)))
                .thenThrow(new lk.resq.localhub.service.ForbiddenException("You do not have access to this resource."));

        CprInstructorCoachQueryRequest req = new CprInstructorCoachQueryRequest("Which trainees need attention?", null, null, null, null);
        ResponseEntity<?> response = controller.queryInstructorCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("You do not have access to this resource.");
    }

    @Test
    void validatesEmptyQuestion() {
        AuthUser instructor = new AuthUser("u-1", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        when(authService.requireRole(Mockito.any(), Mockito.eq(UserRole.INSTRUCTOR), Mockito.eq(UserRole.ADMIN)))
                .thenReturn(instructor);

        CprInstructorCoachQueryRequest req = new CprInstructorCoachQueryRequest("", "user-123", null, null, null);
        ResponseEntity<?> response = controller.queryInstructorCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ApiErrorResponse body = (ApiErrorResponse) response.getBody();
        assertThat(body.error()).contains("question cannot be empty");
    }

    @Test
    void allowsInstructorAndReturnsSuccessfulResponse() {
        AuthUser instructor = new AuthUser("u-1", "instructor", "Instructor", UserRole.INSTRUCTOR, null);
        when(authService.requireRole(Mockito.any(), Mockito.eq(UserRole.INSTRUCTOR), Mockito.eq(UserRole.ADMIN)))
                .thenReturn(instructor);

        CprInstructorCoachResponse mockResponse = new CprInstructorCoachResponse(
                "Trainee Alice needs attention",
                List.of(new CprInstructorCoachResponse.PriorityTrainee("u-alice", "Alice", 65, "Shallow depth", "session-1")),
                List.of("Shallow compressions"),
                List.of("Instruct Alice to push deeper"),
                List.of("session-1")
        );

        when(instructorCoachService.generateResponse(Mockito.any())).thenReturn(mockResponse);

        CprInstructorCoachQueryRequest req = new CprInstructorCoachQueryRequest("Which trainees need attention today?", "u-alice", null, null, null);
        ResponseEntity<?> response = controller.queryInstructorCoach(new MockHttpServletRequest(), req);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        CprInstructorCoachResponse body = (CprInstructorCoachResponse) response.getBody();
        assertThat(body.answer()).isEqualTo("Trainee Alice needs attention");
        assertThat(body.priorityTrainees()).hasSize(1);
        assertThat(body.priorityTrainees().get(0).traineeId()).isEqualTo("u-alice");
        assertThat(body.commonIssues()).contains("Shallow compressions");
        assertThat(body.suggestedInstructorActions()).contains("Instruct Alice to push deeper");
        assertThat(body.relatedSessionIds()).contains("session-1");
    }
}
