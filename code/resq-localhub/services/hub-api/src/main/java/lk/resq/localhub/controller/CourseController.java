package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CourseAccessService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/courses")
public class CourseController {

    private final CourseAccessService courseAccessService;
    private final AuthService authService;

    public CourseController(CourseAccessService courseAccessService, AuthService authService) {
        this.courseAccessService = courseAccessService;
        this.authService = authService;
    }

    @GetMapping
    public ResponseEntity<?> listCourses(HttpServletRequest request) {
        AuthUser user = authService.requireAuth(request);
        return ResponseEntity.ok(courseAccessService.getVisibleCourses(user));
    }

    @GetMapping("/{courseId}")
    public ResponseEntity<?> getCourse(HttpServletRequest request, @PathVariable String courseId) {
        AuthUser user = authService.requireAuth(request);
        try {
            return ResponseEntity.ok(courseAccessService.getVisibleCourse(courseId, user));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(e.getMessage()));
        }
    }

    @GetMapping("/{courseId}/students")
    public ResponseEntity<?> getCourseStudents(HttpServletRequest request, @PathVariable String courseId) {
        AuthUser user = authService.requireAuth(request);
        try {
            return ResponseEntity.ok(courseAccessService.getCourseStudents(courseId, user));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(e.getMessage()));
        }
    }

    @GetMapping("/{courseId}/instructors")
    public ResponseEntity<?> getCourseInstructors(HttpServletRequest request, @PathVariable String courseId) {
        AuthUser user = authService.requireAuth(request);
        try {
            return ResponseEntity.ok(courseAccessService.getCourseInstructors(courseId, user));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(e.getMessage()));
        }
    }
}
