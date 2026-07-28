import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBrowserHealth } from "./browserHealthApi";
import { fetchCourses, fetchCourseStudents } from "./browserCoursesApi";
import {
  archiveTrainee,
  createTrainee,
  fetchTraineeById,
  fetchTrainees,
  updateTrainee,
} from "./browserTraineesApi";
import {
  fetchLiveManikins,
  fetchManikinInventory,
  getLiveManikinsStreamUrl,
} from "./browserManikinsApi";
import {
  endSession,
  fetchCompletedSession,
  fetchCompletedSessions,
  fetchMyActiveSession,
  fetchMySessionHistory,
  fetchSessionLive,
  fetchSyncQueue,
  getErrorMessage,
  getSessionCsvExportUrl,
  getSessionJsonExportUrl,
  getSessionLiveStreamUrl,
  getSessionReviewExportUrl,
  startSession,
} from "./browserSessionsApi";
import {
  getCourse,
  getRosterSyncStatus,
  listCourseInstructors,
  listCourses,
  listCourseStudents,
  runRosterSync,
} from "./browserRosterSyncApi";
import { setStoredToken } from "./tokenStore";
import { emptyResponse, jsonResponse, mockFetch } from "../test/fetchMock";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("browser API clients", () => {
  it("normalizes browser health success, bad payloads, HTTP failures, and network failures", async () => {
    mockFetch(jsonResponse({ ok: true, service: "hub", timestamp: "now" }));
    await expect(fetchBrowserHealth()).resolves.toEqual({ ok: true, service: "hub", timestamp: "now" });

    mockFetch(jsonResponse({ ok: "yes" }));
    await expect(fetchBrowserHealth()).resolves.toEqual({ ok: false, service: undefined, timestamp: undefined });

    mockFetch(emptyResponse({ status: 503, statusText: "Down" }));
    await expect(fetchBrowserHealth()).resolves.toEqual({ ok: false, service: undefined, timestamp: undefined });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchBrowserHealth()).resolves.toEqual({ ok: false, service: undefined, timestamp: undefined });
  });

  it("loads courses and enrolled students while filtering malformed rows", async () => {
    const fetchMock = mockFetch(
      jsonResponse([
        { cloudCourseId: "course-1", code: "CPR101", name: "Adult CPR" },
        { title: "Missing id" },
        null,
      ]),
      jsonResponse([
        { cloudUserId: "student-1", name: "Sam", email: "sam@example.test" },
        { displayName: "Missing id" },
      ]),
    );

    await expect(fetchCourses()).resolves.toEqual([{ courseId: "course-1", courseCode: "CPR101", title: "Adult CPR" }]);
    await expect(fetchCourseStudents("course/1")).resolves.toEqual([{ traineeId: "student-1", displayName: "Sam", email: "sam@example.test" }]);

    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:18080/api/courses/course%2F1/students");

    mockFetch(jsonResponse({ error: "No courses" }, { status: 500 }));
    await expect(fetchCourses()).rejects.toThrow("No courses");
    mockFetch(jsonResponse({}, { status: 200 }));
    await expect(fetchCourses()).rejects.toThrow("Invalid courses response.");
  });

  it("adds bearer credentials to trainee CRUD helpers and maps errors", async () => {
    setStoredToken("token-1");
    const trainee = { id: "t1", traineeCode: "T1", displayName: "Trainee One" };
    const fetchMock = mockFetch(
      jsonResponse([trainee]),
      jsonResponse(trainee),
      jsonResponse(trainee),
      jsonResponse({ ...trainee, displayName: "New" }),
      emptyResponse(),
    );

    await fetchTrainees();
    await fetchTraineeById("t1");
    await createTrainee({ traineeCode: "T2", displayName: "Trainee Two" });
    await updateTrainee("t1", { displayName: "New" });
    await archiveTrainee("t1");

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer token-1" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[4][0]).toBe("http://localhost:18080/api/trainees/t1/archive");

    mockFetch(jsonResponse({}, { status: 404, statusText: "Not Found" }));
    await expect(fetchTraineeById("missing")).rejects.toThrow("Trainee not found: missing");
    mockFetch(jsonResponse({ message: "Duplicate code" }, { status: 409 }));
    await expect(createTrainee({ traineeCode: "T1", displayName: "Duplicate" })).rejects.toThrow("Duplicate code");
  });

  it("loads live manikins and inventory with normalization and 404 fallback", async () => {
    const liveRow = {
      deviceId: "m1",
      online: true,
      state: "online",
      rssi: -70,
      battery: 88,
      sessionActive: false,
      latestDepthMm: 54,
      latestRateCpm: 108,
      latestRecoilOk: true,
      pressureSkewed: false,
      status: "paired",
    };
    const fetchMock = mockFetch(jsonResponse([liveRow]), jsonResponse([liveRow]), jsonResponse([liveRow]));

    await expect(fetchLiveManikins()).resolves.toEqual([liveRow]);
    await expect(fetchManikinInventory()).resolves.toMatchObject([{ deviceId: "m1", status: "paired", rawStatus: "paired" }]);

    mockFetch(jsonResponse({ error: "not found" }, { status: 404 }), jsonResponse([{ ...liveRow, online: false, state: "offline" }]));
    await expect(fetchManikinInventory()).resolves.toMatchObject([{ deviceId: "m1", status: "offline", rawStatus: "offline" }]);

    expect(getLiveManikinsStreamUrl()).toBe("http://localhost:18080/api/stream/manikins/live");
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:18080/api/manikins");
  });

  it("covers browser session lifecycle, history, exports, and error helpers", async () => {
    const session = {
      sessionId: "s1",
      deviceId: "m1",
      traineeId: "t1",
      startedAt: "now",
      ended: true,
      endedAt: "later",
      scenario: "Adult CPR",
      notes: null,
      summary: { score: 90 },
    };
    const fetchMock = mockFetch(
      jsonResponse({ ...session, active: true }),
      jsonResponse({ sessionId: "s1", deviceId: "m1", state: "STOP_PENDING" }),
      jsonResponse({ sessionId: "s1", active: true }),
      jsonResponse(session),
      jsonResponse([session]),
      jsonResponse({ sessionId: "mine", active: true }),
      jsonResponse([session]),
      jsonResponse([{ entityId: "s1", syncStatus: "PENDING" }]),
    );

    await startSession({ deviceId: "m1", courseId: "c1", traineeId: "t1", profileId: "p1" });
    await endSession({ sessionId: "s1" });
    await fetchSessionLive("s1");
    await fetchCompletedSession("s1");
    await fetchCompletedSessions();
    await fetchMyActiveSession();
    await fetchMySessionHistory();
    await fetchSyncQueue();

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:18080/api/sessions/start");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(getSessionLiveStreamUrl("s/1")).toBe("http://localhost:18080/api/stream/sessions/live/s%2F1");
    expect(getSessionJsonExportUrl("s/1")).toBe("http://localhost:18080/api/export/sessions/s%2F1.json");
    expect(getSessionCsvExportUrl("s/1")).toBe("http://localhost:18080/api/export/sessions/s%2F1.csv");
    expect(getSessionReviewExportUrl("s/1", "csv")).toBe("http://localhost:18080/api/sessions/s%2F1/export?format=csv");
    expect(getErrorMessage("plain")).toBe("plain");
    expect(getErrorMessage({})).toBe("Unknown error");

    mockFetch(jsonResponse({ error: "no active" }, { status: 404 }));
    await expect(fetchSessionLive("missing")).resolves.toBeNull();
    mockFetch(jsonResponse({ error: "denied" }, { status: 403 }));
    await expect(fetchMyActiveSession()).rejects.toThrow("denied");
    mockFetch(jsonResponse({}, { status: 409 }));
    await expect(startSession({ deviceId: "m1", courseId: "c1", traineeId: "t1", profileId: "p1" })).rejects.toThrow("already active");
    mockFetch(jsonResponse({}, { status: 200 }));
    await expect(fetchCompletedSessions()).rejects.toThrow("Invalid sessions response");
  });

  it("covers roster sync status, run, and course detail helpers with auth headers", async () => {
    setStoredToken("token-1");
    const course = { cloudCourseId: "c1", courseCode: "CPR101", title: "Adult CPR" };
    const fetchMock = mockFetch(
      jsonResponse({ lastAttemptAt: null }),
      jsonResponse({ ok: true }),
      jsonResponse([course]),
      jsonResponse(course),
      jsonResponse([{ cloudUserId: "s1", displayName: "Student" }]),
      jsonResponse([{ cloudUserId: "i1", displayName: "Instructor" }]),
    );

    await getRosterSyncStatus();
    await runRosterSync();
    await listCourses();
    await getCourse("c/1");
    await listCourseStudents("c/1");
    await listCourseInstructors("c/1");

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer token-1" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[3][0]).toBe("http://localhost:18080/api/courses/c%2F1");

    mockFetch(emptyResponse({ status: 500, statusText: "Down" }));
    await expect(getRosterSyncStatus()).rejects.toThrow("Failed to get roster sync status: Down");
  });
});
