package lk.resq.localhub.service;

public class CalibrationProfileValidationException extends RuntimeException {
    private final String code;
    private final String deviceId;
    private final String requestedProfileId;
    private final String calibratedProfileId;

    public CalibrationProfileValidationException(
            String code,
            String deviceId,
            String requestedProfileId,
            String calibratedProfileId,
            String message
    ) {
        super(message);
        this.code = code;
        this.deviceId = deviceId;
        this.requestedProfileId = requestedProfileId;
        this.calibratedProfileId = calibratedProfileId;
    }

    public String getCode() {
        return code;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public String getRequestedProfileId() {
        return requestedProfileId;
    }

    public String getCalibratedProfileId() {
        return calibratedProfileId;
    }
}
