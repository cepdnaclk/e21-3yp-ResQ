package lk.resq.localhub.service;

public class MqttCommandPublishException extends RuntimeException {

    public MqttCommandPublishException(String message, Throwable cause) {
        super(message, cause);
    }
}