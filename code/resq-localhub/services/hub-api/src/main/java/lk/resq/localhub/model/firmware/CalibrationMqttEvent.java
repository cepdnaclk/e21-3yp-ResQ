package lk.resq.localhub.model.firmware;

import java.time.Instant;

public record CalibrationMqttEvent(
        String deviceId,
        Integer eventId,
        String replyId,
        String status,
        Integer progressId,
        String result,
        String reasonId,
        Integer actionId,
        String firmwareState,
        Long tsMs,
        Instant receivedAt,
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
    public CalibrationMqttEvent(
            String deviceId,
            Integer eventId,
            String replyId,
            String status,
            Integer progressId,
            String result,
            String reasonId,
            Integer actionId,
            String firmwareState,
            Long tsMs,
            Instant receivedAt
    ) {
        this(
                deviceId,
                eventId,
                replyId,
                status,
                progressId,
                result,
                reasonId,
                actionId,
                firmwareState,
                tsMs,
                receivedAt,
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
