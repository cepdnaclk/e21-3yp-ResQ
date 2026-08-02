import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeviceReadiness } from "../../hooks/useDeviceReadiness";
import { DeviceReadinessPanel } from "./DeviceReadinessPanel";

vi.mock("../../hooks/useDeviceReadiness", () => ({
  useDeviceReadiness: vi.fn(),
}));

describe("DeviceReadinessPanel button actions", () => {
  beforeEach(() => {
    vi.mocked(useDeviceReadiness).mockReturnValue({
      readiness: {
        deviceId: "MAN-01",
        calibrationState: "READY",
        firmwareState: "READY_FOR_SESSION",
        readyForSession: true,
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
      setReadiness: vi.fn(),
    });
  });

  it("routes calibration and continue actions through their supplied handlers", async () => {
    const onRunCalibration = vi.fn();
    const onContinue = vi.fn();

    render(
      <DeviceReadinessPanel
        deviceId="MAN-01"
        liveSummary={{
          deviceId: "MAN-01",
          online: true,
          offline: false,
          stale: false,
          calibrated: true,
          sessionActive: false,
          activeSessionId: null,
        } as any}
        onRunCalibration={onRunCalibration}
        onContinue={onContinue}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Recalibrate" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onRunCalibration).toHaveBeenCalledOnce();
    expect(onRunCalibration).toHaveBeenCalledWith("MAN-01");
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps device actions disabled for an explicitly offline device", () => {
    render(
      <DeviceReadinessPanel
        deviceId="MAN-01"
        liveSummary={{
          deviceId: "MAN-01",
          online: false,
          offline: true,
          stale: false,
          calibrated: true,
          sessionActive: false,
          activeSessionId: null,
        } as any}
        onRunCalibration={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Recalibrate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
