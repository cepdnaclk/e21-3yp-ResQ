import { describe, expect, it } from "vitest";
import { getDeviceStateLabel, getDeviceStateTone } from "./userFriendlyLabels";

describe("userFriendlyLabels", () => {
  it("renders ONLINE as Online with a positive tone", () => {
    expect(getDeviceStateLabel("ONLINE")).toBe("Online");
    expect(getDeviceStateTone("ONLINE")).toBe("success");
  });
});