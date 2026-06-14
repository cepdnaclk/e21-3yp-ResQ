package lk.resq.cloudapi.exception;

public class BadRequestException extends RuntimeException {
    private final String error;

    public BadRequestException(String error, String message) {
        super(message);
        this.error = error;
    }

    public String getError() {
        return error;
    }
}
