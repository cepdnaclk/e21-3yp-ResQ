import { describe, expect, it } from "vitest";
import { isEndedSessionPayload } from "./liveEventsClient";

describe("isEndedSessionPayload", () => {
  it("accepts both null and the backend empty-object completion marker", () => {
    expect(isEndedSessionPayload(null)).toBe(true);
    expect(isEndedSessionPayload(undefined)).toBe(true);
    expect(isEndedSessionPayload({})).toBe(true);
  });

  it("does not end a populated live session update", () => {
    expect(
      isEndedSessionPayload({
        sessionId: "session-1",
        active: false,
        lifecycleState: "COMPLETED",
      }),
    ).toBe(false);
  });
});
