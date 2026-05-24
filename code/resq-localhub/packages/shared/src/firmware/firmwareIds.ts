export const COMMAND_TYPE_IDS = {
  DEBUG: 100,
  CALIBRATION_START: 200,
  CALIBRATION_CANCEL: 201,
  SESSION_START: 300,
  SESSION_STOP: 301,
  SYSTEM_RETRY: 400,
  SYSTEM_RESET: 401,
  SYSTEM_FLUSH_CONFIG: 402,
} as const;

export type CommandTypeId = (typeof COMMAND_TYPE_IDS)[keyof typeof COMMAND_TYPE_IDS];

export const EVENT_IDS = {
  GENERIC_COMMAND_RESULT: 1000,
  DEVICE_IDENTITY: 1001,
  DEBUG_COMMAND_RESULT: 1002,
  SYSTEM_COMMAND_RESULT: 1003,
  SESSION_STARTED: 2000,
  SESSION_STOPPED: 2001,
  SESSION_INTERRUPTED: 2002,
  SESSION_COMMAND_RESULT: 2003,
  GENERAL_CPR_FEEDBACK: 3000,
  INCOMPLETE_RECOIL_DETECTED: 3001,
  WRONG_HAND_PLACEMENT: 3002,
  COMPRESSION_RATE_TOO_SLOW: 3003,
  COMPRESSION_RATE_TOO_FAST: 3004,
  COMPRESSION_DEPTH_TOO_SHALLOW: 3005,
  COMPRESSION_DEPTH_GOOD: 3006,
  PAUSE_DETECTED: 3007,
  CALIBRATION_COMMAND_RESULT: 4000,
  CALIBRATION_PROGRESS: 4001,
  CALIBRATION_FINAL_RESULT: 4002,
  FIRMWARE_ERROR: 5000,
  ERROR_COMMAND_RESULT: 5001,
  ERROR_RECOVERY: 5002,
} as const;

export type EventId = (typeof EVENT_IDS)[keyof typeof EVENT_IDS];

export const PROGRESS_IDS = {
  NONE: 0,
  CALIBRATION_STARTED: 1,
  WAITING_REFERENCE_PRESSURE: 2,
  REFERENCE_PRESSURE_MATCHED: 3,
  WAITING_BLADDER_1_PRESSURE: 4,
  BLADDER_1_PRESSURE_MATCHED: 5,
  WAITING_BLADDER_2_PRESSURE: 6,
  BLADDER_2_PRESSURE_MATCHED: 7,
  HALL_BASELINE_CAPTURED: 8,
  WAITING_FULL_PRESS: 9,
  FULL_PRESS_CAPTURED: 10,
  CALIBRATION_SAVED: 11,
  CALIBRATION_FAILED: 12,
  CALIBRATION_INTERRUPTED: 13,
} as const;

export type ProgressId = (typeof PROGRESS_IDS)[keyof typeof PROGRESS_IDS];

export const ACTION_IDS = {
  NO_ACTION_REQUIRED: 0,
  SEND_VALID_PAYLOAD: 1,
  WAIT_OR_CANCEL: 2,
  BUTTON_1_RETRY_BUTTON_2_IDLE: 3,
  CHECK_SENSOR_AND_RETRY: 4,
  BUTTON_1_CONTINUE_OR_RETRY_BUTTON_2_IDLE: 5,
  MOVE_TO_PAIRED_IDLE_AND_DROP_TEMPORARY_VALUES: 6,
  STAY_CURRENT_STATE: 7,
  MOVE_TO_ERROR: 8,
  CLEAR_CONFIG_AND_PROVISION: 9,
  RESTART_FIRMWARE: 10,
  STOP_SESSION_AND_RETURN_READY: 11,
  MOVE_TO_TURN_OFF: 12,
  DEVICE_IN_ERROR_USE_SYSTEM_RECOVERY: 13,
} as const;

export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];

export const COMMAND_TYPE_LABELS: Record<CommandTypeId, string> = {
  [COMMAND_TYPE_IDS.DEBUG]: "Debug",
  [COMMAND_TYPE_IDS.CALIBRATION_START]: "Calibration start",
  [COMMAND_TYPE_IDS.CALIBRATION_CANCEL]: "Calibration cancel",
  [COMMAND_TYPE_IDS.SESSION_START]: "Session start",
  [COMMAND_TYPE_IDS.SESSION_STOP]: "Session stop",
  [COMMAND_TYPE_IDS.SYSTEM_RETRY]: "System retry",
  [COMMAND_TYPE_IDS.SYSTEM_RESET]: "System reset",
  [COMMAND_TYPE_IDS.SYSTEM_FLUSH_CONFIG]: "System flush config",
};

export const EVENT_LABELS: Record<EventId, string> = {
  [EVENT_IDS.GENERIC_COMMAND_RESULT]: "Generic command result",
  [EVENT_IDS.DEVICE_IDENTITY]: "Device identity",
  [EVENT_IDS.DEBUG_COMMAND_RESULT]: "Debug command result",
  [EVENT_IDS.SYSTEM_COMMAND_RESULT]: "System command result",
  [EVENT_IDS.SESSION_STARTED]: "Session started",
  [EVENT_IDS.SESSION_STOPPED]: "Session stopped",
  [EVENT_IDS.SESSION_INTERRUPTED]: "Session interrupted",
  [EVENT_IDS.SESSION_COMMAND_RESULT]: "Session command result",
  [EVENT_IDS.GENERAL_CPR_FEEDBACK]: "General CPR feedback",
  [EVENT_IDS.INCOMPLETE_RECOIL_DETECTED]: "Incomplete recoil detected",
  [EVENT_IDS.WRONG_HAND_PLACEMENT]: "Wrong hand placement",
  [EVENT_IDS.COMPRESSION_RATE_TOO_SLOW]: "Compression rate too slow",
  [EVENT_IDS.COMPRESSION_RATE_TOO_FAST]: "Compression rate too fast",
  [EVENT_IDS.COMPRESSION_DEPTH_TOO_SHALLOW]: "Compression depth too shallow",
  [EVENT_IDS.COMPRESSION_DEPTH_GOOD]: "Compression depth good",
  [EVENT_IDS.PAUSE_DETECTED]: "Pause detected",
  [EVENT_IDS.CALIBRATION_COMMAND_RESULT]: "Calibration command result",
  [EVENT_IDS.CALIBRATION_PROGRESS]: "Calibration progress",
  [EVENT_IDS.CALIBRATION_FINAL_RESULT]: "Calibration final result",
  [EVENT_IDS.FIRMWARE_ERROR]: "Firmware error",
  [EVENT_IDS.ERROR_COMMAND_RESULT]: "Error command result",
  [EVENT_IDS.ERROR_RECOVERY]: "Error recovery",
};

export const PROGRESS_LABELS: Record<ProgressId, string> = {
  [PROGRESS_IDS.NONE]: "None",
  [PROGRESS_IDS.CALIBRATION_STARTED]: "Calibration started",
  [PROGRESS_IDS.WAITING_REFERENCE_PRESSURE]: "Waiting reference pressure",
  [PROGRESS_IDS.REFERENCE_PRESSURE_MATCHED]: "Reference pressure matched",
  [PROGRESS_IDS.WAITING_BLADDER_1_PRESSURE]: "Waiting bladder 1 pressure",
  [PROGRESS_IDS.BLADDER_1_PRESSURE_MATCHED]: "Bladder 1 pressure matched",
  [PROGRESS_IDS.WAITING_BLADDER_2_PRESSURE]: "Waiting bladder 2 pressure",
  [PROGRESS_IDS.BLADDER_2_PRESSURE_MATCHED]: "Bladder 2 pressure matched",
  [PROGRESS_IDS.HALL_BASELINE_CAPTURED]: "Hall baseline captured",
  [PROGRESS_IDS.WAITING_FULL_PRESS]: "Waiting full press",
  [PROGRESS_IDS.FULL_PRESS_CAPTURED]: "Full press captured",
  [PROGRESS_IDS.CALIBRATION_SAVED]: "Calibration saved",
  [PROGRESS_IDS.CALIBRATION_FAILED]: "Calibration failed",
  [PROGRESS_IDS.CALIBRATION_INTERRUPTED]: "Calibration interrupted",
};

export const ACTION_LABELS: Record<ActionId, string> = {
  [ACTION_IDS.NO_ACTION_REQUIRED]: "No action required",
  [ACTION_IDS.SEND_VALID_PAYLOAD]: "Send valid payload",
  [ACTION_IDS.WAIT_OR_CANCEL]: "Wait or cancel",
  [ACTION_IDS.BUTTON_1_RETRY_BUTTON_2_IDLE]: "Button 1 retry, button 2 idle",
  [ACTION_IDS.CHECK_SENSOR_AND_RETRY]: "Check sensor and retry",
  [ACTION_IDS.BUTTON_1_CONTINUE_OR_RETRY_BUTTON_2_IDLE]: "Button 1 continue/retry, button 2 idle",
  [ACTION_IDS.MOVE_TO_PAIRED_IDLE_AND_DROP_TEMPORARY_VALUES]: "Move to paired idle and drop temporary values",
  [ACTION_IDS.STAY_CURRENT_STATE]: "Stay current state",
  [ACTION_IDS.MOVE_TO_ERROR]: "Move to error",
  [ACTION_IDS.CLEAR_CONFIG_AND_PROVISION]: "Clear config and provision",
  [ACTION_IDS.RESTART_FIRMWARE]: "Restart firmware",
  [ACTION_IDS.STOP_SESSION_AND_RETURN_READY]: "Stop session and return ready",
  [ACTION_IDS.MOVE_TO_TURN_OFF]: "Move to turn off",
  [ACTION_IDS.DEVICE_IN_ERROR_USE_SYSTEM_RECOVERY]: "Device in error; use system recovery",
};

export type ReasonId = string;

export function isReasonId(value: unknown): boolean {
  return typeof value === "string" && /^\d{5}$/.test(value);
}

export function isSuccessReasonId(value: unknown): boolean {
  return value === "00000";
}