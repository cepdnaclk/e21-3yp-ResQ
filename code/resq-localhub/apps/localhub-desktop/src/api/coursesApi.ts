/**
 * coursesApi.ts — V2 courses/roster API.
 */

import { getJson } from "./localHubClient";
import type { Course, CourseStudent, CourseInstructor } from "../types/course";

/** GET /api/courses — all courses visible to the current user */
export async function fetchCourses(): Promise<Course[]> {
  return getJson<Course[]>("/api/courses");
}

/** GET /api/courses/{courseId} */
export async function fetchCourse(courseId: string): Promise<Course> {
  return getJson<Course>(`/api/courses/${encodeURIComponent(courseId)}`);
}

/** GET /api/courses/{courseId}/students */
export async function fetchCourseStudents(courseId: string): Promise<CourseStudent[]> {
  return getJson<CourseStudent[]>(`/api/courses/${encodeURIComponent(courseId)}/students`);
}

/** GET /api/courses/{courseId}/instructors */
export async function fetchCourseInstructors(courseId: string): Promise<CourseInstructor[]> {
  return getJson<CourseInstructor[]>(`/api/courses/${encodeURIComponent(courseId)}/instructors`);
}
