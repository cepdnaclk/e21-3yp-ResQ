package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.model.CloudCourse;
import lk.resq.cloudapi.model.CloudEnrollment;
import lk.resq.cloudapi.model.CreateCloudCourseRequest;
import lk.resq.cloudapi.model.CreateCloudEnrollmentRequest;
import lk.resq.cloudapi.service.CloudManagementService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/cloud/courses")
public class CloudCourseController {

    private final CloudManagementService service;

    public CloudCourseController(CloudManagementService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<CloudCourse> create(@RequestBody CreateCloudCourseRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createCourse(request));
    }

    @GetMapping
    public List<CloudCourse> list() {
        return service.listCourses();
    }

    @GetMapping("/{courseId}")
    public CloudCourse get(@PathVariable String courseId) {
        return service.getCourse(courseId);
    }

    @PatchMapping("/{courseId}")
    public CloudCourse update(@PathVariable String courseId, @RequestBody Map<String, Object> patch) {
        return service.updateCourse(courseId, patch);
    }

    @PostMapping("/{courseId}/enrollments")
    public ResponseEntity<CloudEnrollment> enroll(
            @PathVariable String courseId,
            @RequestBody CreateCloudEnrollmentRequest request
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.enrollTrainee(courseId, request));
    }

    @GetMapping("/{courseId}/enrollments")
    public List<CloudEnrollment> listEnrollments(@PathVariable String courseId) {
        return service.listCourseEnrollments(courseId);
    }

    @DeleteMapping("/{courseId}/enrollments/{traineeId}")
    public ResponseEntity<Void> removeEnrollment(
            @PathVariable String courseId,
            @PathVariable String traineeId
    ) {
        service.removeEnrollment(courseId, traineeId);
        return ResponseEntity.noContent().build();
    }
}
