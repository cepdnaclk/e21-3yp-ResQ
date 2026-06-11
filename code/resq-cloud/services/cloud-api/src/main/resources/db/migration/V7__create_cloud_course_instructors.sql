CREATE TABLE cloud_course_instructors (
    course_id UUID NOT NULL REFERENCES cloud_courses(course_id),
    instructor_id UUID NOT NULL REFERENCES cloud_users(user_id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (course_id, instructor_id)
);

CREATE INDEX idx_cloud_course_instructors_active ON cloud_course_instructors (instructor_id, active);
