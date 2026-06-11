CREATE TABLE cloud_users (
    user_id UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NULL,
    role TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_cloud_users_email UNIQUE (email),
    CONSTRAINT ck_cloud_users_role CHECK (role IN ('ADMIN', 'INSTRUCTOR', 'TRAINEE'))
);

CREATE TABLE cloud_courses (
    course_id UUID PRIMARY KEY,
    course_code TEXT NULL,
    title TEXT NOT NULL,
    description TEXT NULL,
    instructor_id UUID NULL REFERENCES cloud_users(user_id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_cloud_courses_code UNIQUE (course_code)
);

CREATE TABLE cloud_enrollments (
    enrollment_id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES cloud_courses(course_id),
    trainee_id UUID NOT NULL REFERENCES cloud_users(user_id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    enrolled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_cloud_enrollments_course_trainee UNIQUE (course_id, trainee_id)
);

CREATE INDEX idx_cloud_users_role_active ON cloud_users (role, active);
CREATE INDEX idx_cloud_courses_instructor_id ON cloud_courses (instructor_id);
CREATE INDEX idx_cloud_courses_active ON cloud_courses (active);
CREATE INDEX idx_cloud_enrollments_course_active ON cloud_enrollments (course_id, active);
CREATE INDEX idx_cloud_enrollments_trainee_id ON cloud_enrollments (trainee_id);
