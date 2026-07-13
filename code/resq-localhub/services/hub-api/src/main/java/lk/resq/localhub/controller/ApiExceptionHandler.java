package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.UnauthorizedException;
import lk.resq.localhub.service.CalibrationNotReadyException;
import lk.resq.localhub.service.CalibrationProfileValidationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ApiErrorResponse> handleUnauthorized(UnauthorizedException error) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApiErrorResponse(error.getMessage()));
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<ApiErrorResponse> handleForbidden(ForbiddenException error) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
    }

    @ExceptionHandler(CalibrationNotReadyException.class)
    public ResponseEntity<?> handleCalibrationNotReady(CalibrationNotReadyException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                "error", "CALIBRATION_NOT_READY",
                "message", error.getMessage(),
                "deviceId", error.getDeviceId()
        ));
    }

    @ExceptionHandler(CalibrationProfileValidationException.class)
    public ResponseEntity<?> handleCalibrationProfileValidation(CalibrationProfileValidationException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                "error", error.getCode(),
                "message", error.getMessage(),
                "deviceId", error.getDeviceId(),
                "requestedProfileId", error.getRequestedProfileId() != null ? error.getRequestedProfileId() : "",
                "calibratedProfileId", error.getCalibratedProfileId() != null ? error.getCalibratedProfileId() : ""
        ));
    }
}
