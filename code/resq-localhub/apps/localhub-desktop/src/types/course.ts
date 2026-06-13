/**
 * course.ts — Course and enrollment types for V2.
 */

export type Course = {
  courseId: string;
  courseCode: string | null;
  title: string;
  name?: string;
};

export type CourseStudent = {
  traineeId: string;
  displayName: string;
  email: string | null;
};

export type CourseInstructor = {
  instructorId: string;
  displayName: string;
  email: string | null;
};
