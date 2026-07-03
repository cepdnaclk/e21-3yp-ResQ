package lk.resq.localhub.service;

public class CalibrationNotReadyException extends RuntimeException {
    private final String deviceId;

    public CalibrationNotReadyException(String deviceId, String message) {
        super(message);
        this.deviceId = deviceId;
    }

    public String getDeviceId() {
        return deviceId;
    }
}
