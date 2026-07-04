package lk.resq.cloudapi.model;

public record CreateCloudCourseRequest(
        String courseCode,
        String title,
        String description,
        String instructorId
) {
}
