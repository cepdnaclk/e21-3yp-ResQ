import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DeviceReadinessBadge from "./DeviceReadinessBadge";
import type { DeviceReadinessState } from "../../types/manikin";

describe("DeviceReadinessBadge", () => {
  it("renders Ready for READY state", () => {
    const readiness: DeviceReadinessState = {
      deviceId: "M01",
      calibrationState: "READY",
      readyForSession: true,
    };
    render(<DeviceReadinessBadge readiness={readiness} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("renders Calibrating for CALIBRATING state", () => {
    const readiness: DeviceReadinessState = {
      deviceId: "M01",
      calibrationState: "CALIBRATING",
      readyForSession: false,
    };
    render(<DeviceReadinessBadge readiness={readiness} />);
    expect(screen.getByText("Calibrating")).toBeInTheDocument();
  });

  it("renders Calibration failed for FAILED state", () => {
    const readiness: DeviceReadinessState = {
      deviceId: "M01",
      calibrationState: "FAILED",
      readyForSession: false,
    };
    render(<DeviceReadinessBadge readiness={readiness} />);
    expect(screen.getByText("Calibration failed")).toBeInTheDocument();
  });

  it("renders Checking... when loading is true", () => {
    render(<DeviceReadinessBadge loading={true} />);
    expect(screen.getByText("Checking...")).toBeInTheDocument();
  });

  it("renders Readiness unavailable when error is provided", () => {
    render(<DeviceReadinessBadge error="Network error" />);
    expect(screen.getByText("Readiness unavailable")).toBeInTheDocument();
  });
});
