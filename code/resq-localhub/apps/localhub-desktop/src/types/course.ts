/**
 * course.ts — Course and enrollment types for V2.
 */

export type Course = {
  courseId: string;
  courseCode: string | null;
  title: string;
  name?: string;
  cloudCourseId?: string;
};

export type CourseStudent = {
  traineeId: string;
  displayName: string;
  email: string | null;
  cloudUserId?: string;
};

export type CourseInstructor = {
  instructorId: string;
  displayName: string;
  email: string | null;
  cloudUserId?: string;
};
