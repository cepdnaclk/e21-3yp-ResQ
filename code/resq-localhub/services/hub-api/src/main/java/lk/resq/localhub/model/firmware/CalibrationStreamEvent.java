package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record CalibrationStreamEvent(
        String type,
        String deviceId,
        Integer eventId,
        String replyId,
        String status,
        Integer progressId,
        String result,
        String reasonId,
        Integer actionId,
        String firmwareState,
        CalibrationState calibrationState,
        boolean readyForSession,
        Long tsMs,
        Instant receivedAt,
        DeviceReadinessState readiness,
        Instant ts,
        Double pressure0Kpa,
        Boolean pressure0KpaValid,
        Double pressure1Kpa,
        Boolean pressure1KpaValid,
        Double pressure2Kpa,
        Boolean pressure2KpaValid,
        Boolean pressureKpaValid,
        Double hallMm,
        Double hallProgress,
        Boolean hallMmValid,
        Boolean samplePressureKpaValid,
        Boolean sampleHallMmValid,
        Integer pressureSaturationMask,
        Double fullDepthMm
) {

    public static CalibrationStreamEvent snapshot(String deviceId, DeviceReadinessState readiness) {
        Integer progressId = readiness != null ? readiness.currentProgressId() : null;
        String reasonId = readiness != null ? readiness.lastReasonId() : "00000";
        if (reasonId == null) {
            reasonId = "00000";
        }
        Integer actionId = readiness != null ? readiness.lastActionId() : Integer.valueOf(0);
        if (actionId == null) {
            actionId = Integer.valueOf(0);
        }

        return new CalibrationStreamEvent(
                "calibration_snapshot",
                deviceId,
                null,
                readiness != null ? readiness.lastReplyId() : null,
                null,
                progressId,
                readiness != null ? readiness.lastResult() : null,
                reasonId,
                actionId,
                readiness != null ? readiness.firmwareState() : null,
                readiness != null ? readiness.calibrationState() : CalibrationState.UNKNOWN,
                readiness != null && readiness.readyForSession(),
                null,
                readiness != null ? readiness.lastUpdatedAt() : Instant.now(),
                readiness,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }

    public static CalibrationStreamEvent update(String deviceId, CalibrationMqttEvent event, DeviceReadinessState readiness) {
        String eventType = event.eventId() != null && event.eventId() == 4002 ? "calibration_final" : "calibration_update";

        Integer progressId = event.progressId();
        if (progressId == null && readiness != null) {
            progressId = readiness.currentProgressId();
        }

        String reasonId = event.reasonId();
        if (reasonId == null && readiness != null) {
            reasonId = readiness.lastReasonId();
        }
        if (reasonId == null) {
            reasonId = "00000";
        }

        Integer actionId = event.actionId();
        if (actionId == null && readiness != null) {
            actionId = readiness.lastActionId();
        }
        if (actionId == null) {
            actionId = Integer.valueOf(0);
        }

        String firmwareState = event.firmwareState();
        if (firmwareState == null && readiness != null) {
            firmwareState = readiness.firmwareState();
        }

        CalibrationState calibrationState = readiness != null ? readiness.calibrationState() : CalibrationState.UNKNOWN;
        boolean readyForSession = readiness != null && readiness.readyForSession();

        return new CalibrationStreamEvent(
                eventType,
                deviceId,
                event.eventId(),
                event.replyId(),
                event.status(),
                progressId,
                event.result(),
                reasonId,
                actionId,
                firmwareState,
                calibrationState,
                readyForSession,
                event.tsMs(),
                event.receivedAt(),
                null,
                null,
                event.pressure0Kpa(),
                event.pressure0KpaValid(),
                event.pressure1Kpa(),
                event.pressure1KpaValid(),
                event.pressure2Kpa(),
                event.pressure2KpaValid(),
                event.pressureKpaValid(),
                event.hallMm(),
                event.hallProgress(),
                event.hallMmValid(),
                event.samplePressureKpaValid(),
                event.sampleHallMmValid(),
                event.pressureSaturationMask(),
                event.fullDepthMm()
        );
    }

    public static CalibrationStreamEvent keepalive(String deviceId) {
        return new CalibrationStreamEvent(
                "calibration_keepalive",
                deviceId,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                false,
                null,
                null,
                null,
                Instant.now(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }
}
