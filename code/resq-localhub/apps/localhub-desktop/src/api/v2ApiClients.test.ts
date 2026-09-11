import { afterEach, describe, expect, it, vi } from "vitest";
import * as coursesApi from "./coursesApi";
import * as exportsApi from "./exportsApi";
import * as firmwareApi from "./firmwareApi";
import * as manikinsApi from "./manikinsApi";
import * as sessionsApi from "./sessionsApi";
import * as traineesApi from "./traineesApi";
import { jsonResponse, mockFetch } from "../test/fetchMock";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("V2 API clients", () => {
  it("constructs encoded manikin and calibration endpoints", async () => {
    const fetchMock = mockFetch(
      jsonResponse([{ deviceId: "M01" }]),
      jsonResponse({ deviceId: "M/01" }),
      jsonResponse({ requestId: "req-1" }),
      jsonResponse({ requestId: "req-2" }),
      jsonResponse([{ id: 1 }]),
      jsonResponse({ id: 1 }),
    );

    await manikinsApi.fetchLiveManikins();
    await manikinsApi.fetchLiveManikin("M/01");
    await manikinsApi.startCalibration("M/01", { hall_delta: 1, ref_pressure: 2, bladder_1_pressure: 3, bladder_2_pressure: 4 });
    await manikinsApi.cancelCalibration("M/01");
    await manikinsApi.getCalibrationHistory("M/01", 5);
    await manikinsApi.getCalibrationEvidence("M/01", 9);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:18080/api/manikins/live",
      "http://localhost:18080/api/manikins/live/M%2F01",
      "http://localhost:18080/api/devices/M%2F01/calibration/start",
      "http://localhost:18080/api/devices/M%2F01/calibration/cancel",
      "http://localhost:18080/api/devices/M%2F01/calibration/history?limit=5",
      "http://localhost:18080/api/devices/M%2F01/calibration/history/9",
    ]);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
  });

  it("returns null for missing live-session snapshots but rethrows other errors", async () => {
    mockFetch(jsonResponse({ error: "missing" }, { status: 404 }));
    await expect(sessionsApi.fetchSessionLive("s1")).resolves.toBeNull();

    mockFetch(jsonResponse({ error: "denied" }, { status: 403 }));
    await expect(sessionsApi.fetchMyActiveSession()).rejects.toThrow("denied");
  });

  it("covers session, course, trainee, and export URL helpers", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ sessionId: "s1" }),
      jsonResponse({ stopped: true }),
      jsonResponse([{ sessionId: "s1" }]),
      jsonResponse({ sessionId: "s1" }),
      jsonResponse([{ courseId: "c1" }]),
      jsonResponse({ id: "c1" }),
      jsonResponse([{ traineeId: "t1" }]),
      jsonResponse([{ instructorId: "i1" }]),
      jsonResponse([{ id: "t1" }]),
      jsonResponse({ id: "t/1" }),
      jsonResponse({ id: "t2" }),
      jsonResponse({ id: "t2", displayName: "Two" }),
      jsonResponse({ ok: true }),
    );

    await sessionsApi.startSession({ courseId: "c1", traineeId: "t1", deviceId: "M01" } as any);
    await sessionsApi.endSession({ sessionId: "s1" } as any);
    await sessionsApi.fetchCompletedSessions();
    await sessionsApi.fetchCompletedSession("s/1");
    await coursesApi.fetchCourses();
    await coursesApi.fetchCourse("c/1");
    await coursesApi.fetchCourseStudents("c/1");
    await coursesApi.fetchCourseInstructors("c/1");
    await traineesApi.fetchTrainees();
    await traineesApi.fetchTrainee("t/1");
    await traineesApi.createTrainee({ traineeCode: "T2", displayName: "Two" });
    await traineesApi.updateTrainee("t/2", { displayName: "Two" });
    await traineesApi.archiveTrainee("t/2");

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:18080/api/sessions/start");
    const completedSessionUrl = new URL(String(fetchMock.mock.calls[3][0]));
    expect(completedSessionUrl.origin + completedSessionUrl.pathname).toBe(
      "http://localhost:18080/api/sessions/s%2F1",
    );
    expect(completedSessionUrl.searchParams.has("completionRead")).toBe(true);
    expect(fetchMock.mock.calls[5][0]).toBe("http://localhost:18080/api/courses/c%2F1");
    expect(fetchMock.mock.calls[9][0]).toBe("http://localhost:18080/api/trainees/t%2F1");
    expect(exportsApi.getSessionJsonExportUrl("s/1")).toBe("http://localhost:18080/api/export/sessions/s%2F1.json");
    expect(exportsApi.getSessionCsvExportUrl("s/1")).toBe("http://localhost:18080/api/export/sessions/s%2F1.csv");
  });

  it("normalizes firmware diagnostics snapshots and malformed payloads", async () => {
    mockFetch(jsonResponse({
      deviceId: "M01",
      recentDebugSnapshots: [
        { id: 1, deviceId: "M01", requestId: "req", pressure0Raw: 10, receivedAt: "now", payloadJson: "{\"state\":\"OK\"}" },
        { id: 2, deviceId: "M01", receivedAt: "later", payloadJson: "{bad" },
      ],
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await firmwareApi.fetchDeviceDiagnostics("M/01");

    expect(result.debugSnapshots[0].payload).toEqual({ state: "OK" });
    expect(result.debugSnapshots[1].payload).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it("publishes firmware commands through the expected endpoint", async () => {
    const fetchMock = mockFetch(jsonResponse([{ profileId: "adult" }]), jsonResponse(null), jsonResponse({ requestId: "req-debug" }));

    await firmwareApi.getCalibrationProfiles();
    await firmwareApi.getDefaultCalibrationProfile();
    await firmwareApi.requestDebugSnapshot("M/01");

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:18080/api/firmware/calibration-profiles");
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:18080/api/firmware/calibration-profiles/default");
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:18080/api/devices/M%2F01/firmware/debug");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
  });
});
