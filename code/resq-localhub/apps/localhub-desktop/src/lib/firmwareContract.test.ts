import { describe, expect, it } from "vitest";
import {
  COMMAND_TYPE_IDS,
  EVENT_IDS,
  FIRMWARE_STATES,
  buildCalibrationStartCommandTopic,
  buildFirmwareStatusTopic,
  buildSessionStartCommandTopic,
  buildSystemFlushConfigCommandTopic,
  formatRequestId,
  isFirmwareState,
  isReasonId,
  isSuccessReasonId,
  parseFirmwareTopic,
  parseRequestId,
} from "@resq/shared";

describe("firmware contract", () => {
  it("builds canonical firmware topics", () => {
    expect(buildFirmwareStatusTopic("M01")).toBe("resq/M01/status");
    expect(buildCalibrationStartCommandTopic("M01")).toBe("resq/M01/cmd/calibration/start");
    expect(buildSessionStartCommandTopic("M01")).toBe("resq/M01/cmd/session/start");
    expect(buildSystemFlushConfigCommandTopic("M01")).toBe("resq/M01/cmd/system/flush-config");
  });

  it("parses canonical firmware topics", () => {
    expect(parseFirmwareTopic("resq/M01/status")).toMatchObject({
      valid: true,
      namespace: "resq",
      deviceId: "M01",
      family: "status",
    });

    expect(parseFirmwareTopic("resq/M01/events/error")).toMatchObject({
      valid: true,
      family: "events/error",
      deviceId: "M01",
    });

    expect(parseFirmwareTopic("resq/M01/cmd/system/reset")).toMatchObject({
      valid: true,
      family: "cmd",
      command: "system/reset",
    });
  });

  it("formats and parses request IDs", () => {
    const requestId = formatRequestId(COMMAND_TYPE_IDS.SESSION_START, 1);
    expect(requestId).toBe("req-300-0001");
    expect(parseRequestId(requestId)).toMatchObject({
      valid: true,
      commandTypeId: COMMAND_TYPE_IDS.SESSION_START,
      sequenceNumber: 1,
    });
  });

  it("recognizes ids and states", () => {
    expect(isFirmwareState("READY_FOR_SESSION")).toBe(true);
    expect(isFirmwareState("NOT_A_STATE")).toBe(false);
    expect(isReasonId("00000")).toBe(true);
    expect(isSuccessReasonId("00000")).toBe(true);
    expect(EVENT_IDS.SESSION_STARTED).toBe(2000);
    expect(FIRMWARE_STATES).toContain("SESSION_ACTIVE");
  });
});