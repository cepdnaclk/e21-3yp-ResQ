import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { getDeviceReadiness, startCalibration, cancelCalibration, getLatestCalibrationEvidence } from "../../api/manikinsApi";
import { connectCalibrationStream } from "../../api/liveEventsClient";
import type { DeviceReadinessState, CalibrationState, CalibrationStreamEvent, CalibrationEvidence } from "../../types/manikin";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import { getDeviceStateTone } from "../../utils/userFriendlyLabels";
import CalibrationTargetTracking from "../../components/cpr/CalibrationTargetTracking";
import { createSensorStreamClient, startSensorStream, stopSensorStream } from "../../lib/sensorStreamClient";
import type { SensorStreamCommandUpdate, SensorStreamUiState } from "../../lib/sensorStreamTypes";
import {
  buildCalibrationTargets,
  isUsableRaw,
  type CalibrationRawSample,
} from "../../utils/calibrationTargetTracking";

type CalibrationWizardPageProps = {
  deviceId: string;
  onBack: () => void;
};

// Form values type
type FormValues = {
  hall_delta: string;
  ref_pressure: string;
  bladder_1_pressure: string;
  bladder_2_pressure: string;
  profile_id: string;
  sample_interval_ms: string;
  calibration_window_ms: string;
};

// Stepper steps definition
const STEPS = [
  { name: "Start", ids: [1] },
  { name: "Ref Pressure", ids: [2, 3] },
  { name: "Bladder 1", ids: [4, 5] },
  { name: "Bladder 2", ids: [6, 7] },
  { name: "Baseline", ids: [8] },
  { name: "Full Compression", ids: [9, 10] },
  { name: "Save / Result", ids: [11, 12, 13] },
];

const LAST_COMPLETED_PROGRESS: Record<number, number> = {
  1: 0,
  2: 1,
  3: 3,
  4: 3,
  5: 5,
  6: 5,
  7: 7,
  8: 8,
  9: 8,
  10: 10,
  11: 11,
  12: 10,
  13: 10,
};

const REASON_DETAILS: Record<string, { title: string; action: string }> = {
  "08101": {
    title: "Invalid calibration values",
    action: "Review the raw calibration configuration values and retry.",
  },
  "08102": {
    title: "Calibration is already running",
    action: "Wait for the current calibration to finish or cancel it before retrying.",
  },
  "08401": {
    title: "Reference pressure target was not reached",
    action: "Check the reference pressure connection and hold the requested pressure steady before retrying.",
  },
  "08402": {
    title: "Bladder 1 pressure target was not reached",
    action: "Check bladder 1 tubing and pressure source, then retry calibration.",
  },
  "08403": {
    title: "Bladder 2 pressure target was not reached",
    action: "Check bladder 2 tubing and pressure source, then retry calibration.",
  },
  "08404": {
    title: "Hall baseline could not be read",
    action: "Keep the manikin fully released and verify Hall sensor wiring and magnet alignment before retrying.",
  },
  "08405": {
    title: "Full compression target was not reached",
    action: "Press to full depth and hold steady until the firmware captures the sample.",
  },
  "08406": {
    title: "Full compression pressure could not be read",
    action: "Check pressure sensor wiring and tubing, then repeat the full compression capture.",
  },
  "08407": {
    title: "Pressure imbalance is too high",
    action: "Check both bladder channels for leaks, blocked tubing, or uneven pressure before retrying.",
  },
  "08408": {
    title: "Calibration values are outside range",
    action: "Check the raw targets and sensor readings, then retry with values inside the firmware limits.",
  },
  "08409": {
    title: "Sensor readings are unstable",
    action: "Keep the manikin still, check pressure and Hall sensor wiring, and retry once readings stabilize.",
  },
  "08410": {
    title: "Pressure sample is too noisy",
    action: "Hold pressure steady and check pressure sensor tubing and wiring before retrying.",
  },
  "08411": {
    title: "Pressure sensor saturated",
    action: "Release pressure, check for over-pressure or wiring faults, and retry calibration.",
  },
  "08412": {
    title: "Hall travel is too small",
    action: "Verify the magnet position and Hall sensor mounting, then repeat the full compression capture.",
  },
  "08413": {
    title: "Hall travel is too large",
    action: "Check Hall sensor and magnet alignment and make sure the manikin mechanics move within the expected range.",
  },
  "08414": {
    title: "Hall sample is invalid",
    action: "Keep the manikin still and verify Hall sensor wiring before retrying.",
  },
  "08415": {
    title: "Pressure baseline is invalid",
    action: "Release all pressure, check pressure sensors and tubing, then retry calibration.",
  },
  "08416": {
    title: "Pressure span is invalid",
    action: "Check the pressure source and sensor wiring, then retry with stable reference pressure.",
  },
  "08417": {
    title: "Calibration save failed",
    action: "Retry calibration. If the problem persists, restart firmware and check persistent storage.",
  },
  "08418": {
    title: "Hall sensor signal is too noisy",
    action: "Keep the manikin completely still during baseline capture. Check Hall sensor and magnet mounting/alignment and verify the sensor wiring before retrying.",
  },
  "08701": {
    title: "Calibration was cancelled",
    action: "Start calibration again when the manikin is idle and connected.",
  },
};

function mapEventState(event: CalibrationStreamEvent): CalibrationState {
  const status = event.status?.toUpperCase();
  const result = event.result?.toUpperCase();
  if (event.eventId === 4000) {
    return status === "ACK" ? "RUNNING" : status === "NACK" ? "FAILED" : "STARTING";
  }
  if (event.eventId === 4002) {
    if (result === "PASS" || result === "PASS_WITH_WARNINGS") return "PASSED";
    if (result === "CANCELLED" || result === "CANCELED") return "CANCELLED";
    if (result === "FAIL") return "FAILED";
  }
  if (event.progressId === 12) return "FAILED";
  if (event.progressId === 13) return "CANCELLED";
  return event.calibrationState === "CALIBRATING" ? "RUNNING" : event.calibrationState;
}

function mergeEventIntoReadiness(
  event: CalibrationStreamEvent,
  previous: DeviceReadinessState | null,
): DeviceReadinessState {
  if (event.readiness) {
    return event.readiness;
  }
  return {
    deviceId: event.deviceId,
    calibrationState: mapEventState(event),
    firmwareState: event.firmwareState ?? previous?.firmwareState ?? null,
    currentProgressId: event.progressId ?? previous?.currentProgressId ?? null,
    lastReasonId: event.reasonId ?? previous?.lastReasonId ?? null,
    lastActionId: event.actionId ?? previous?.lastActionId ?? null,
    lastResult: event.result ?? previous?.lastResult ?? null,
    lastReplyId: event.replyId ?? previous?.lastReplyId ?? null,
    readyForSession: event.readyForSession ?? previous?.readyForSession ?? false,
    lastUpdatedAt: event.receivedAt || new Date().toISOString(),
  };
}

export default function CalibrationWizardPage({ deviceId, onBack }: CalibrationWizardPageProps) {
  // Form states with defaults
  const [form, setForm] = useState<FormValues>({
    hall_delta: "13500",
    ref_pressure: "20100",
    bladder_1_pressure: "15000",
    bladder_2_pressure: "15000",
    profile_id: "adult-basic",
    sample_interval_ms: "20",
    calibration_window_ms: "3000",
  });

  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  
  // Calibration execution states
  const [readiness, setReadiness] = useState<DeviceReadinessState | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Historical evidence states
  const [latestEvidence, setLatestEvidence] = useState<CalibrationEvidence | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(true);

  // Latest SSE Event details for the event details panel
  const [latestEvent, setLatestEvent] = useState<CalibrationStreamEvent | null>(null);
  const [commandEvent, setCommandEvent] = useState<CalibrationStreamEvent | null>(null);
  const [progressEvent, setProgressEvent] = useState<CalibrationStreamEvent | null>(null);
  const [finalEvent, setFinalEvent] = useState<CalibrationStreamEvent | null>(null);
  const [lastCompletedProgressId, setLastCompletedProgressId] = useState<number>(0);
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<import("../../types/manikin").CalibrationStartRequest | null>(null);
  const [rawSample, setRawSample] = useState<CalibrationRawSample | null>(null);
  const [hallBaselineRaw, setHallBaselineRaw] = useState<number | null>(null);
  const [fullDepthMm, setFullDepthMm] = useState<number | null>(null);
  const [maxHallDelta, setMaxHallDelta] = useState<number | null>(null);
  const [manualStreamState, setManualStreamState] = useState<SensorStreamUiState | "CALIBRATION_OWNED">("IDLE");
  const [manualStreamReasonId, setManualStreamReasonId] = useState<string | null>(null);
  const [manualStreamCommand, setManualStreamCommand] = useState<SensorStreamCommandUpdate | null>(null);
  const [sampleStale, setSampleStale] = useState(false);
  const [guidanceAnnouncement, setGuidanceAnnouncement] = useState("");
  const [lastSampleAtMs, setLastSampleAtMs] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const streamStartedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const announcementRef = useRef({ text: "", at: 0 });

  const stopManualStream = useCallback(async () => {
    if (!streamStartedRef.current || stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    setManualStreamState("STOPPING");
    try {
      const response = await stopSensorStream(deviceId);
      if (response.streamState === "IDLE") {
        setManualStreamState("IDLE");
      }
    } catch (error) {
      setManualStreamState("ERROR");
      setManualStreamReasonId(error instanceof Error ? error.message : "telemetry_stop_failed");
    } finally {
      streamStartedRef.current = false;
    }
  }, [deviceId]);

  const startManualStream = useCallback(async () => {
    if (streamStartedRef.current && (manualStreamState === "STARTING" || manualStreamState === "RUNNING")) return;
    stopRequestedRef.current = false;
    streamStartedRef.current = true;
    setManualStreamState("STARTING");
    setManualStreamReasonId(null);
    try {
      const response = await startSensorStream(deviceId, 200);
      setManualStreamState(response.streamState);
    } catch (error) {
      streamStartedRef.current = false;
      setManualStreamState("ERROR");
      setManualStreamReasonId(error instanceof Error ? error.message : "telemetry_start_failed");
    }
  }, [deviceId, manualStreamState]);

  const applyCalibrationRawSample = useCallback((event: CalibrationStreamEvent) => {
    const hasRaw = event.pressure0Raw !== undefined || event.pressure1Raw !== undefined ||
      event.pressure2Raw !== undefined || event.hallRaw !== undefined;
    if (!hasRaw) return;
    const receivedAt = event.receivedAt ?? new Date().toISOString();
    setRawSample((previous) => ({
      pressure0Raw: event.pressure0Raw !== undefined ? event.pressure0Raw : previous?.pressure0Raw ?? null,
      pressure0RawValid: event.pressure0RawValid !== undefined ? event.pressure0RawValid === true : previous?.pressure0RawValid ?? false,
      pressure1Raw: event.pressure1Raw !== undefined ? event.pressure1Raw : previous?.pressure1Raw ?? null,
      pressure1RawValid: event.pressure1RawValid !== undefined ? event.pressure1RawValid === true : previous?.pressure1RawValid ?? false,
      pressure2Raw: event.pressure2Raw !== undefined ? event.pressure2Raw : previous?.pressure2Raw ?? null,
      pressure2RawValid: event.pressure2RawValid !== undefined ? event.pressure2RawValid === true : previous?.pressure2RawValid ?? false,
      hallRaw: event.hallRaw !== undefined ? event.hallRaw : previous?.hallRaw ?? null,
      hallRawValid: event.hallRawValid !== undefined ? event.hallRawValid === true : previous?.hallRawValid ?? false,
      hallMm: event.hallMm !== undefined ? event.hallMm : previous?.hallMm ?? null,
      hallMmValid: event.hallMmValid !== undefined ? event.hallMmValid === true : previous?.hallMmValid ?? false,
      receivedAt,
    }));
    if (typeof event.fullDepthMm === "number" && Number.isFinite(event.fullDepthMm) && event.fullDepthMm > 0) {
      setFullDepthMm(event.fullDepthMm);
    }
    if (event.hallBaselineRawValid === true && isUsableRaw(event.hallBaselineRaw, true)) {
      setHallBaselineRaw(event.hallBaselineRaw);
    } else if (event.progressId === 8 && isUsableRaw(event.hallRaw, event.hallRawValid)) {
      setHallBaselineRaw(event.hallRaw);
    }
    setLastSampleAtMs(Date.now());
    setSampleStale(false);
  }, []);

  useEffect(() => {
    let disposed = false;
    streamStartedRef.current = false;
    stopRequestedRef.current = false;
    setManualStreamState("IDLE");
    setManualStreamReasonId(null);
    setManualStreamCommand(null);
    setActiveConfig(null);
    setRawSample(null);
    setHallBaselineRaw(null);
    setFullDepthMm(null);
    setMaxHallDelta(null);

    const client = createSensorStreamClient(deviceId, {
      onOpen: () => {
        if (!disposed && streamStartedRef.current) setSampleStale(false);
      },
      onSnapshot: (snapshot) => {
        if (disposed) return;
        setRawSample({
          pressure0Raw: snapshot.pressure0Raw,
          pressure0RawValid: snapshot.pressure0RawValid,
          pressure1Raw: snapshot.pressure1Raw,
          pressure1RawValid: snapshot.pressure1RawValid,
          pressure2Raw: snapshot.pressure2Raw,
          pressure2RawValid: snapshot.pressure2RawValid,
          hallRaw: snapshot.hallRaw,
          hallRawValid: snapshot.hallRawValid,
          hallMm: snapshot.hallMm,
          hallMmValid: snapshot.hallMmValid,
          receivedAt: snapshot.receivedAt,
        });
        setLastSampleAtMs(Date.now());
        setSampleStale(false);
        if (!stopRequestedRef.current) setManualStreamState("RUNNING");
      },
      onCommand: (update) => {
        if (disposed) return;
        setManualStreamCommand(update);
        setManualStreamState(update.streamState);
        setManualStreamReasonId(update.status === "NACK" || update.streamState === "ERROR" ? update.reasonId : null);
        if (update.streamState === "IDLE") {
          streamStartedRef.current = false;
          stopRequestedRef.current = false;
        }
      },
      onError: (error) => {
        if (disposed || !streamStartedRef.current) return;
        setSampleStale(true);
        setManualStreamReasonId(error.message);
      },
    });
    client.start();

    return () => {
      disposed = true;
      client.stop();
      if (streamStartedRef.current && !stopRequestedRef.current) {
        stopRequestedRef.current = true;
        void stopSensorStream(deviceId);
      }
      streamStartedRef.current = false;
    };
  }, [deviceId]);

  useEffect(() => {
    if (lastSampleAtMs === null || manualStreamState === "IDLE" || manualStreamState === "STOPPING") return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastSampleAtMs > 1500) setSampleStale(true);
    }, 500);
    return () => window.clearInterval(timer);
  }, [lastSampleAtMs, manualStreamState]);

  useEffect(() => {
    if (hallBaselineRaw === null || !isUsableRaw(rawSample?.hallRaw, rawSample?.hallRawValid)) return;
    const delta = Math.abs(rawSample!.hallRaw! - hallBaselineRaw);
    setMaxHallDelta((previous) => previous === null ? delta : Math.max(previous, delta));
  }, [hallBaselineRaw, rawSample?.hallRaw, rawSample?.hallRawValid]);

  const fetchEvidence = async () => {
    try {
      setLoadingEvidence(true);
      const res = await getLatestCalibrationEvidence(deviceId);
      setLatestEvidence(res);
    } catch (err) {
      console.warn("Failed to fetch latest calibration evidence:", err);
    } finally {
      setLoadingEvidence(false);
    }
  };

  // Fetch initial readiness and connect SSE stream
  useEffect(() => {
    let active = true;

    async function init() {
      try {
        setLoadingReadiness(true);
        setApiError(null);
        const res = await getDeviceReadiness(deviceId);
        if (active) {
          setReadiness(res);
        }
      } catch (err) {
        if (active) {
          setApiError(err instanceof Error ? err.message : "Failed to load device readiness.");
        }
      } finally {
        if (active) {
          setLoadingReadiness(false);
        }
      }
    }

    init();
    fetchEvidence();

    const applyStreamEvent = (event: CalibrationStreamEvent) => {
      setLatestEvent(event);
      setStreamError(null);
      setReadiness((prev) => mergeEventIntoReadiness(event, prev));
      applyCalibrationRawSample(event);
      if (event.progressId != null && event.progressId >= 1 && event.progressId <= 10) {
        setManualStreamState("CALIBRATION_OWNED");
      }

      if (event.eventId === 4000) {
        setCommandEvent(event);
        setIsSubmitting(false);
      } else if (event.eventId === 4001) {
        setProgressEvent(event);
        if (event.progressId !== null && event.progressId !== undefined) {
          setLastCompletedProgressId((prev) => Math.max(prev, LAST_COMPLETED_PROGRESS[event.progressId ?? 0] ?? prev));
        }
      } else if (event.eventId === 4002) {
        setFinalEvent(event);
        setIsSubmitting(false);
        setIsCancelling(false);
        if (event.progressId !== null && event.progressId !== undefined) {
          setLastCompletedProgressId((prev) => Math.max(prev, LAST_COMPLETED_PROGRESS[event.progressId ?? 0] ?? prev));
        }
        fetchEvidence();
      }
    };

    // Setup SSE connection
    try {
      eventSourceRef.current = connectCalibrationStream(deviceId, {
        onSnapshot: (event) => {
          if (!active) return;
          applyStreamEvent(event);
        },
        onUpdate: (event) => {
          if (!active) return;
          applyStreamEvent(event);
        },
        onFinal: (event) => {
          if (!active) return;
          applyStreamEvent(event);
        },
        onError: () => {
          if (!active) return;
          // Preserve latest known state, show warning only
          setStreamError("Live calibration stream disconnected. Reconnecting or refresh may be needed.");
        },
      });
    } catch (err) {
      setStreamError("Failed to establish live stream connection.");
    }

    return () => {
      active = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [deviceId, applyCalibrationRawSample]);

  // Form field change handler
  const handleInputChange = (field: keyof FormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  // Validation
  const validateForm = (): boolean => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    
    const hall = Number(form.hall_delta);
    if (isNaN(hall) || hall <= 0) {
      errors.hall_delta = "Hall Delta must be greater than 0";
    }

    const ref = Number(form.ref_pressure);
    if (isNaN(ref) || ref <= 0) {
      errors.ref_pressure = "Reference Pressure must be greater than 0";
    }

    const b1 = Number(form.bladder_1_pressure);
    if (isNaN(b1) || b1 <= 0) {
      errors.bladder_1_pressure = "Bladder 1 Pressure must be greater than 0";
    }

    const b2 = Number(form.bladder_2_pressure);
    if (isNaN(b2) || b2 <= 0) {
      errors.bladder_2_pressure = "Bladder 2 Pressure must be greater than 0";
    }

    if (form.sample_interval_ms) {
      const interval = Number(form.sample_interval_ms);
      if (isNaN(interval) || interval <= 0) {
        errors.sample_interval_ms = "Sample interval must be greater than 0";
      }
    }

    if (form.calibration_window_ms) {
      const win = Number(form.calibration_window_ms);
      if (isNaN(win) || win <= 0) {
        errors.calibration_window_ms = "Calibration window must be greater than 0";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Start calibration triggering
  const handleStartCalibration = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    setApiError(null);
    setStartNotice(null);
    setCommandEvent(null);
    setProgressEvent(null);
    setFinalEvent(null);
    setLastCompletedProgressId(0);

    if (streamStartedRef.current) {
      await stopManualStream();
    }
    setRawSample(null);
    setHallBaselineRaw(null);
    setFullDepthMm(null);
    setMaxHallDelta(null);
    setLastSampleAtMs(null);
    setSampleStale(false);

    // Transit state to STARTING locally to show immediate response
    setReadiness((prev) => ({
      deviceId,
      calibrationState: "STARTING",
      currentProgressId: 1,
      readyForSession: false,
    }));

    try {
      const reqPayload = {
        hall_delta: Number(form.hall_delta),
        ref_pressure: Number(form.ref_pressure),
        bladder_1_pressure: Number(form.bladder_1_pressure),
        bladder_2_pressure: Number(form.bladder_2_pressure),
        profile_id: form.profile_id || undefined,
        sample_interval_ms: form.sample_interval_ms ? Number(form.sample_interval_ms) : undefined,
        calibration_window_ms: form.calibration_window_ms ? Number(form.calibration_window_ms) : undefined,
      };

      setActiveConfig(reqPayload);
      await startManualStream();
      await startCalibration(deviceId, reqPayload);
      setStartNotice("Calibration started; live tracking will use calibration-owned raw samples while firmware owns the sensors.");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to start calibration.");
      setIsSubmitting(false);
      setActiveConfig(null);
      await stopManualStream();
      // Revert status
      setReadiness((prev) => (prev?.calibrationState === "STARTING" ? null : prev));
    }
  };

  // Cancel calibration triggering
  const handleCancelCalibration = async () => {
    setIsCancelling(true);
    setApiError(null);
    setReadiness((prev) => prev ? { ...prev, calibrationState: "CANCELLING" } : {
      deviceId,
      calibrationState: "CANCELLING",
      readyForSession: false,
    });

    try {
      await cancelCalibration(deviceId);
      await stopManualStream();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to cancel calibration.");
      setIsCancelling(false);
      await stopManualStream();
    }
  };

  const calState: CalibrationState = readiness?.calibrationState ?? "UNKNOWN";
  const progressId = readiness?.currentProgressId ?? 0;
  const terminalResult = finalEvent?.result?.toUpperCase() ?? readiness?.lastResult?.toUpperCase() ?? null;
  
  // Status check variables
  const isRunning = calState === "STARTING" || calState === "RUNNING" || calState === "CALIBRATING";
  const isSuccess = terminalResult === "PASS" || terminalResult === "PASS_WITH_WARNINGS" || calState === "PASSED" || calState === "READY";
  const isFailure = terminalResult === "FAIL" || calState === "FAILED" || progressId === 12;
  const isInterrupted = calState === "INTERRUPTED" || progressId === 13;
  const isCancelled = terminalResult === "CANCELLED" || terminalResult === "CANCELED" || calState === "CANCELLED";

  useEffect(() => {
    if (isSuccess || isFailure || isInterrupted || isCancelled) {
      void stopManualStream();
    }
  }, [isSuccess, isFailure, isInterrupted, isCancelled, stopManualStream]);

  const handleBack = async () => {
    await stopManualStream();
    onBack();
  };

  // Determine current active stepper step
  let activeStep = 0;
  if (isRunning || isSuccess || isFailure || isInterrupted || isCancelled) {
    if (progressId === 1) activeStep = 0;
    else if (progressId === 2 || progressId === 3) activeStep = 1;
    else if (progressId === 4 || progressId === 5) activeStep = 2;
    else if (progressId === 6 || progressId === 7) activeStep = 3;
    else if (progressId === 8) activeStep = 4;
    else if (progressId === 9 || progressId === 10) activeStep = 5;
    else if (progressId === 11) activeStep = 6;
    else if (progressId >= 12) {
      if (lastCompletedProgressId >= 9) activeStep = 5;
      else if (lastCompletedProgressId >= 8) activeStep = 4;
      else if (lastCompletedProgressId >= 6) activeStep = 3;
      else if (lastCompletedProgressId >= 4) activeStep = 2;
      else if (lastCompletedProgressId >= 2) activeStep = 1;
      else activeStep = 0;
    }
  }

  // Mapped Progress Instructions
  const getProgressInstructions = (pid: number) => {
    if (isSuccess) {
      return {
        title: "Calibration saved",
        text: "Calibration values were saved successfully.",
      };
    }
    if (isFailure) {
      return {
        title: "Calibration failed",
        text: "Calibration failed. Check the reason and follow the suggested action.",
      };
    }
    if (isInterrupted) {
      return {
        title: "Calibration interrupted",
        text: "Calibration was interrupted. Check Wi-Fi/MQTT connection and retry.",
      };
    }
    if (isCancelled) {
      return {
        title: "Calibration cancelled",
        text: "Calibration was cancelled.",
      };
    }

    if (isRunning && (pid === 0 || pid === null || pid === undefined)) {
      return {
        title: readiness?.firmwareState ? `State: ${readiness.firmwareState}` : "Calibration Running",
        text: "Waiting for firmware progress details...",
      };
    }

    switch (pid) {
      case 1:
        return {
          title: "Calibration started",
          text: "Keep the manikin stable. The firmware is preparing the calibration sequence.",
        };
      case 2:
        return {
          title: "Reference pressure",
          text: "Apply the required reference pressure to the reference chamber and hold it steady.",
        };
      case 3:
        return {
          title: "Reference pressure accepted",
          text: "Reference pressure matched. Keep the setup stable and continue.",
        };
      case 4:
        return {
          title: "Bladder 1 pressure",
          text: "Apply or adjust pressure for bladder 1 until the firmware accepts the target.",
        };
      case 5:
        return {
          title: "Bladder 1 accepted",
          text: "Bladder 1 pressure matched. Continue to the next pressure step.",
        };
      case 6:
        return {
          title: "Bladder 2 pressure",
          text: "Apply or adjust pressure for bladder 2 until the firmware accepts the target.",
        };
      case 7:
        return {
          title: "Bladder 2 accepted",
          text: "Bladder 2 pressure matched. Keep the manikin released.",
        };
      case 8:
        return {
          title: "Baseline captured",
          text: "Hall baseline captured. Ensure the chest is fully released.",
        };
      case 9:
        return {
          title: "Full compression",
          text: "Press and hold full compression until the firmware captures the full press.",
        };
      case 10:
        return {
          title: "Full press captured",
          text: "Full compression captured. Release the chest and wait.",
        };
      case 11:
        return {
          title: "Calibration saved",
          text: "Calibration values were saved successfully.",
        };
      case 12:
        return {
          title: "Calibration failed",
          text: "Calibration failed. Check the reason and follow the suggested action.",
        };
      case 13:
        return {
          title: "Calibration interrupted",
          text: "Calibration was interrupted. Check Wi-Fi/MQTT connection and retry.",
        };
      default:
        return {
          title: "Calibration not running",
          text: "Start calibration when the manikin is connected and idle.",
        };
    }
  };

  // Mapped Actions
  const getActionMessage = (aid?: number | null) => {
    if (aid === null || aid === undefined) {
      return "No suggested action received.";
    }
    switch (aid) {
      case 0: return "No action required.";
      case 1: return "Send a valid calibration payload.";
      case 2: return "Wait for the current step to complete or cancel calibration.";
      case 3: return "Retry calibration or return to idle.";
      case 4: return "Check the sensor connection and retry.";
      case 5: return "Continue or retry after checking the connection.";
      case 6: return "Return to idle and drop temporary calibration values.";
      case 7: return "Stay in the current state.";
      case 8: return "Device moved to error state.";
      case 9: return "Clear configuration and provision again.";
      case 10: return "Restart firmware.";
      case 11: return "Stop session and return ready.";
      case 12: return "Move to turn off.";
      case 13: return "Device is in error; use system recovery.";
      default: return "Unknown action code.";
    }
  };

  const instruction = getProgressInstructions(progressId);
  const reasonDetail = readiness?.lastReasonId ? REASON_DETAILS[readiness.lastReasonId] : null;
  const actionMsg = reasonDetail?.action ?? getActionMessage(readiness?.lastActionId);
  const resultEvent = finalEvent ?? commandEvent;
  const resolvedConfig = useMemo(() => {
    if (activeConfig) return activeConfig;
    if (!latestEvidence) return null;
    if ([latestEvidence.hallDelta, latestEvidence.refPressure, latestEvidence.bladder1Pressure, latestEvidence.bladder2Pressure].some((value) => typeof value !== "number")) {
      return null;
    }
    return {
      hall_delta: latestEvidence.hallDelta as number,
      ref_pressure: latestEvidence.refPressure as number,
      bladder_1_pressure: latestEvidence.bladder1Pressure as number,
      bladder_2_pressure: latestEvidence.bladder2Pressure as number,
      profile_id: latestEvidence.profileId ?? undefined,
      sample_interval_ms: latestEvidence.sampleIntervalMs ?? undefined,
      calibration_window_ms: latestEvidence.calibrationWindowMs ?? undefined,
    };
  }, [activeConfig, latestEvidence]);
  const targets = useMemo(() => buildCalibrationTargets({
    config: resolvedConfig,
    sample: rawSample,
    progressId,
    lastCompletedProgressId,
    reasonId: readiness?.lastReasonId ?? null,
    hallBaselineRaw,
    fullDepthMm,
    maxHallDelta,
  }), [resolvedConfig, rawSample, progressId, lastCompletedProgressId, readiness?.lastReasonId, hallBaselineRaw, fullDepthMm, maxHallDelta]);

  useEffect(() => {
    const next = targets.find((target) => target.active)?.guidance ?? "";
    const now = Date.now();
    if (next && next !== announcementRef.current.text && now - announcementRef.current.at >= 2000) {
      announcementRef.current = { text: next, at: now };
      setGuidanceAnnouncement(next);
    }
  }, [targets]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Warning Stream Error */}
      {streamError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-pulse">
          <span className="font-semibold">{streamError}</span>
        </div>
      )}

      {/* Warning API Error */}
      {apiError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs px-4 py-3 rounded-xl font-semibold shadow-sm">
          {apiError}
        </div>
      )}

      {startNotice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs px-4 py-3 rounded-xl font-semibold shadow-sm">
          {startNotice}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight leading-none">
              Calibration / Pre-Check
            </h1>
            <div className="flex gap-2">
              <StatusBadge tone={getDeviceStateTone(calState)} label={calState} />
              {readiness?.firmwareState && (
                <StatusBadge tone="info" label={`FW: ${readiness.firmwareState}`} />
              )}
            </div>
          </div>
          <p className="text-sm text-slate-400 font-normal">
            Device ID: <strong className="font-mono text-slate-600">{deviceId}</strong>
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void handleBack()}>
          Back to Dashboard
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Stepper */}
        <div className="lg:col-span-1 bg-white p-5 border border-slate-100 rounded-2xl shadow-sm h-fit">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-5">
            Calibration Steps
          </h3>
          <div className="relative border-l border-slate-100 ml-3 space-y-6">
            {STEPS.map((step, idx) => {
              const isStepCompleted = idx < activeStep;
              const isStepActive = idx === activeStep && isRunning;
              
              let badgeColor = "bg-slate-100 text-slate-400 border-slate-200";
              if (isStepCompleted) badgeColor = "bg-teal-50 text-teal-600 border-teal-200";
              else if (isStepActive) badgeColor = "bg-blue-50 text-blue-600 border-blue-200 animate-pulse";

              return (
                <div key={idx} className="relative pl-6">
                  {/* Step bullet dot */}
                  <span className={`absolute -left-3.5 top-0.5 w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${badgeColor}`}>
                    {isStepCompleted ? "✓" : idx + 1}
                  </span>
                  <div className="flex flex-col">
                    <span className={`text-xs font-bold ${isStepActive ? "text-blue-600" : isStepCompleted ? "text-slate-800" : "text-slate-400"}`}>
                      {step.name}
                    </span>
                    {isStepActive && (
                      <span className="text-[10px] text-blue-400 font-medium">Running...</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Interactive Form and State Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Instructions Card */}
          <Card className="border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-6">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Current Instructions
            </h4>
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                  {instruction.title}
                </h2>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  {instruction.text}
                </p>
              </div>

              {/* Action Banner */}
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                  Suggested Action
                </span>
                <span className="text-xs text-slate-600 font-semibold">{actionMsg}</span>
              </div>
            </div>
          </Card>

          <CalibrationTargetTracking
            targets={targets}
            streamState={manualStreamState}
            streamReasonId={manualStreamReasonId}
            commandUpdate={manualStreamCommand}
            stale={sampleStale}
            lastUpdatedAt={rawSample?.receivedAt ?? null}
            guidanceAnnouncement={guidanceAnnouncement}
          />

          {/* Form / Actions Panel */}
          <Card className="border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-6">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              Calibration Options & Configuration
            </h4>

            {isSuccess ? (
              <div className="py-6 text-center space-y-4">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full flex items-center justify-center mx-auto text-xl font-extrabold shadow-sm animate-bounce">
                  ✓
                </div>
                <h3 className="text-lg font-bold text-slate-800">Calibration Complete</h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">
                  Calibration complete. Device is ready for session.
                </p>
                <div className="flex gap-3 justify-center pt-4">
                  <Button type="button" variant="primary" onClick={() => void handleBack()}>
                    Start Session
                  </Button>
                </div>
              </div>
            ) : isCancelling ? (
              <div className="py-6 text-center space-y-3">
                <span className="block text-sm text-slate-500 font-medium">
                  Cancelling calibration…
                </span>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Inputs Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <details className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <summary className="cursor-pointer text-xs font-bold text-slate-700">
                      Advanced Calibration Configuration
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  <div>
                    <label htmlFor="hall_delta" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Hall Delta Raw ADC Counts
                    </label>
                    <input
                      id="hall_delta"
                      type="text"
                      disabled={isRunning}
                      value={form.hall_delta}
                      onChange={(e) => handleInputChange("hall_delta", e.target.value)}
                      className={`block w-full px-3 py-2 border rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                        formErrors.hall_delta ? "border-rose-300 ring-rose-500/10" : "border-slate-200"
                      }`}
                    />
                    {formErrors.hall_delta && (
                      <span className="text-[10px] font-semibold text-rose-500 mt-1 block">
                        {formErrors.hall_delta}
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="ref_pressure" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Reference Pressure Raw HX710 Counts
                    </label>
                    <input
                      id="ref_pressure"
                      type="text"
                      disabled={isRunning}
                      value={form.ref_pressure}
                      onChange={(e) => handleInputChange("ref_pressure", e.target.value)}
                      className={`block w-full px-3 py-2 border rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                        formErrors.ref_pressure ? "border-rose-300 ring-rose-500/10" : "border-slate-200"
                      }`}
                    />
                    {formErrors.ref_pressure && (
                      <span className="text-[10px] font-semibold text-rose-500 mt-1 block">
                        {formErrors.ref_pressure}
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="bladder_1_pressure" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Bladder 1 Pressure Raw HX710 Counts
                    </label>
                    <input
                      id="bladder_1_pressure"
                      type="text"
                      disabled={isRunning}
                      value={form.bladder_1_pressure}
                      onChange={(e) => handleInputChange("bladder_1_pressure", e.target.value)}
                      className={`block w-full px-3 py-2 border rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                        formErrors.bladder_1_pressure ? "border-rose-300 ring-rose-500/10" : "border-slate-200"
                      }`}
                    />
                    {formErrors.bladder_1_pressure && (
                      <span className="text-[10px] font-semibold text-rose-500 mt-1 block">
                        {formErrors.bladder_1_pressure}
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="bladder_2_pressure" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Bladder 2 Pressure Raw HX710 Counts
                    </label>
                    <input
                      id="bladder_2_pressure"
                      type="text"
                      disabled={isRunning}
                      value={form.bladder_2_pressure}
                      onChange={(e) => handleInputChange("bladder_2_pressure", e.target.value)}
                      className={`block w-full px-3 py-2 border rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                        formErrors.bladder_2_pressure ? "border-rose-300 ring-rose-500/10" : "border-slate-200"
                      }`}
                    />
                    {formErrors.bladder_2_pressure && (
                      <span className="text-[10px] font-semibold text-rose-500 mt-1 block">
                        {formErrors.bladder_2_pressure}
                      </span>
                    )}
                  </div>
                    </div>
                  </details>

                  <div>
                    <label htmlFor="profile_id" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Profile ID (test value)
                    </label>
                    <input
                      id="profile_id"
                      type="text"
                      disabled={isRunning}
                      value={form.profile_id}
                      onChange={(e) => handleInputChange("profile_id", e.target.value)}
                      className="block w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>

                  <div>
                    <label htmlFor="sample_interval_ms" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Sample Interval ms (test value)
                    </label>
                    <input
                      id="sample_interval_ms"
                      type="text"
                      disabled={isRunning}
                      value={form.sample_interval_ms}
                      onChange={(e) => handleInputChange("sample_interval_ms", e.target.value)}
                      className={`block w-full px-3 py-2 border rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                        formErrors.sample_interval_ms ? "border-rose-300 ring-rose-500/10" : "border-slate-200"
                      }`}
                    />
                    {formErrors.sample_interval_ms && (
                      <span className="text-[10px] font-semibold text-rose-500 mt-1 block">
                        {formErrors.sample_interval_ms}
                      </span>
                    )}
                  </div>

                  <div className="col-span-2">
                    <label htmlFor="calibration_window_ms" className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Calibration Window ms (test value)
                    </label>
                    <input
                      id="calibration_window_ms"
                      type="text"
                      disabled={isRunning}
                      value={form.calibration_window_ms}
                      onChange={(e) => handleInputChange("calibration_window_ms", e.target.value)}
                      className={`block w-full px-3 py-2 border rounded-xl text-xs text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all ${
                        formErrors.calibration_window_ms ? "border-rose-300 ring-rose-500/10" : "border-slate-200"
                      }`}
                    />
                    {formErrors.calibration_window_ms && (
                      <span className="text-[10px] font-semibold text-rose-500 mt-1 block">
                        {formErrors.calibration_window_ms}
                      </span>
                    )}
                  </div>
                </div>

                {/* Form Buttons */}
                <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
                  {isRunning ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={handleCancelCalibration}
                    >
                      Cancel Calibration
                    </Button>
                  ) : (
                    <>
                      {(isFailure || isInterrupted || isCancelled) && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleStartCalibration}
                          loading={isSubmitting}
                        >
                          Retry Calibration
                        </Button>
                      )}
                      {!isFailure && !isInterrupted && !isCancelled && (
                        <Button
                          type="button"
                          variant="primary"
                          onClick={handleStartCalibration}
                          loading={isSubmitting}
                        >
                          Start Calibration
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right: Calibration status & event details */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              Calibration Status
            </h3>
            {loadingReadiness && !readiness ? (
              <p className="text-xs text-slate-400">Loading readiness info...</p>
            ) : (
              <div className="space-y-4 text-xs font-medium text-slate-500">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Calibration State:</span>
                  <strong className="text-slate-800">{readiness?.calibrationState || "UNKNOWN"}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Firmware State:</span>
                  <strong className="text-slate-800">{readiness?.firmwareState || "N/A"}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Progress ID:</span>
                  <strong className="text-slate-800">{readiness?.currentProgressId ?? "N/A"}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Last Reason ID:</span>
                  <strong className="text-slate-800">{readiness?.lastReasonId || "N/A"}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Ready For Session:</span>
                  <strong className={readiness?.readyForSession ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                    {readiness?.readyForSession ? "TRUE" : "FALSE"}
                  </strong>
                </div>
                <div className="flex justify-between py-1.5">
                  <span>Last Reply ID:</span>
                  <strong className="text-slate-800 font-mono">{finalEvent?.replyId || commandEvent?.replyId || readiness?.lastReplyId || "N/A"}</strong>
                </div>
              </div>
            )}
          </Card>

          {/* Reason Warning Banner */}
          {readiness?.lastReasonId && readiness.lastReasonId !== "00000" && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 shadow-sm space-y-2">
              <span className="block text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                Warning / Alert
              </span>
              <p className="text-xs font-bold">
                {reasonDetail?.title ?? "Calibration warning"}
              </p>
              <p className="text-[11px] font-mono text-amber-700">Reason ID: {readiness.lastReasonId}</p>
              <p className="text-xs font-medium">
                {actionMsg}
              </p>
            </div>
          )}

          <Card className="border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              Live Stream Details
            </h3>
            {latestEvent ? (
              <div className="space-y-4 text-xs font-medium text-slate-500">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Event ID:</span>
                  <strong className="text-slate-800">{latestEvent.eventId ?? "N/A"}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Event Type:</span>
                  <strong className="text-slate-800 font-mono">{latestEvent.type}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Result status:</span>
                  <strong className="text-slate-800">{resultEvent?.result || resultEvent?.status || "N/A"}</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span>Final Reply ID:</span>
                  <strong className="text-slate-800 font-mono">{finalEvent?.replyId || "N/A"}</strong>
                </div>
                <div className="flex justify-between py-1.5">
                  <span>Received at:</span>
                  <span className="text-slate-800 font-normal">
                    {latestEvent.receivedAt ? new Date(latestEvent.receivedAt).toLocaleTimeString() : "N/A"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Waiting for live SSE events...</p>
            )}
                  </Card>
        </div>
      </div>

      {/* Historical Calibration Evidence Card */}
      <Card className="border border-slate-100 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-6 mt-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight">
              Historical Calibration Evidence
            </h3>
            <p className="text-[11px] text-slate-400">
              Audit log of the last recorded calibration attempt. This is historical evidence only — a fresh calibration must succeed before a session can start.
            </p>
          </div>
          {latestEvidence && (
            <StatusBadge
              tone={latestEvidence.finalResult === "PASS" ? "success" : latestEvidence.finalResult === "RUNNING" ? "info" : "danger"}
              label={latestEvidence.finalResult || "UNKNOWN"}
            />
          )}
        </div>
        {loadingEvidence ? (
          <p className="text-xs text-slate-400">Loading historical evidence...</p>
        ) : latestEvidence ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs text-slate-500 font-medium">
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Attempt ID:</span>
                <strong className="text-slate-800 font-mono">#{latestEvidence.id}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Request ID:</span>
                <strong className="text-slate-800 font-mono">{latestEvidence.requestId}</strong>
              </div>
              <div className="flex justify-between py-1">
                <span>Operator:</span>
                <strong className="text-slate-800">{latestEvidence.createdByUsername || "system"}</strong>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Started At:</span>
                <strong className="text-slate-800">{latestEvidence.startedAt ? new Date(latestEvidence.startedAt).toLocaleString() : "N/A"}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Completed At:</span>
                <strong className="text-slate-800">{latestEvidence.completedAt ? new Date(latestEvidence.completedAt).toLocaleString() : "N/A"}</strong>
              </div>
              <div className="flex justify-between py-1">
                <span>Last Updated:</span>
                <strong className="text-slate-800">{latestEvidence.updatedAt ? new Date(latestEvidence.updatedAt).toLocaleTimeString() : "N/A"}</strong>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Profile ID:</span>
                <strong className="text-slate-800">{latestEvidence.profileId || "default"}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Hall Delta:</span>
                <strong className="text-slate-800">{latestEvidence.hallDelta ?? "N/A"}</strong>
              </div>
              <div className="flex justify-between py-1">
                <span>Ref Pressure:</span>
                <strong className="text-slate-800">{latestEvidence.refPressure ?? "N/A"}</strong>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Bladder 1 Pressure:</span>
                <strong className="text-slate-800">{latestEvidence.bladder1Pressure ?? "N/A"}</strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span>Bladder 2 Pressure:</span>
                <strong className="text-slate-800">{latestEvidence.bladder2Pressure ?? "N/A"}</strong>
              </div>
              <div className="flex justify-between py-1">
                <span>Ready At Completion:</span>
                <strong className={latestEvidence.readyForSessionAtCompletion ? "text-emerald-600 font-bold" : "text-slate-400"}>
                  {latestEvidence.readyForSessionAtCompletion ? "YES" : "NO"}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">No historical calibration evidence found for this device.</p>
        )}
      </Card>
    </div>
  );
}
