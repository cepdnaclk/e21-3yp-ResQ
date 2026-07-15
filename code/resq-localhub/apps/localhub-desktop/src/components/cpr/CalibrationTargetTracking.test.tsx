import { render, screen } from "@testing-library/react";
import CalibrationTargetTracking from "./CalibrationTargetTracking";
import { buildCalibrationTargets } from "../../utils/calibrationTargetTracking";

it("marks last values stale instead of presenting them as current", () => {
  const targets = buildCalibrationTargets({
    config: { hall_delta: 1000, ref_pressure: 20000, bladder_1_pressure: 15000, bladder_2_pressure: 16000 },
    sample: {
      pressure0Raw: 19000, pressure0RawValid: true,
      pressure1Raw: 14000, pressure1RawValid: true,
      pressure2Raw: 15000, pressure2RawValid: true,
      hallRaw: 2600, hallRawValid: true,
      hallMm: null, hallMmValid: false,
      receivedAt: "2026-07-15T00:00:00Z",
    },
    progressId: 2,
    lastCompletedProgressId: 0,
    reasonId: null,
    hallBaselineRaw: null,
    fullDepthMm: 50,
  });

  render(<CalibrationTargetTracking
    targets={targets}
    streamState="RUNNING"
    streamReasonId={null}
    commandUpdate={null}
    stale
    lastUpdatedAt="2026-07-15T00:00:00Z"
    guidanceAnnouncement="Increase reference pressure"
  />);

  expect(screen.getByText("STALE")).toBeInTheDocument();
  expect(screen.getByText("Waiting for a fresh sensor sample")).toBeInTheDocument();
  expect(screen.getByText(/Last sample:/)).toBeInTheDocument();
});
