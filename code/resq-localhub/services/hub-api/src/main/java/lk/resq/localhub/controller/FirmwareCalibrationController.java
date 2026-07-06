package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.FirmwareCalibrationStartRequest;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.FirmwareCalibrationService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.MqttCommandPublishException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Map;

@RestController
@RequestMapping("/api/firmware/devices/{deviceId}")
public class FirmwareCalibrationController {

    private final FirmwareCalibrationService firmwareCalibrationService;
    private final AuthService authService;

    public FirmwareCalibrationController(FirmwareCalibrationService firmwareCalibrationService, AuthService authService) {
        this.firmwareCalibrationService = firmwareCalibrationService;
        this.authService = authService;
    }

    @PostMapping("/calibration/start")
    public ResponseEntity<?> startCalibration(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestBody(required = false) FirmwareCalibrationStartRequest requestBody
    ) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            var response = firmwareCalibrationService.startCalibration(deviceId, requestBody);
            authService.audit(actor.id(), "FIRMWARE_CALIBRATION_START", "device", response.deviceId(), Map.of("requestId", response.requestId()));
            return ResponseEntity.accepted().body(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @PostMapping("/calibration/cancel")
    public ResponseEntity<?> cancelCalibration(HttpServletRequest request, @PathVariable String deviceId) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            var response = firmwareCalibrationService.cancelCalibration(deviceId);
            authService.audit(actor.id(), "FIRMWARE_CALIBRATION_CANCEL", "device", response.deviceId(), Map.of("requestId", response.requestId()));
            return ResponseEntity.accepted().body(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/calibration/latest")
    public ResponseEntity<?> latestCalibration(HttpServletRequest request, @PathVariable String deviceId) {
        return readiness(request, deviceId);
    }

    @GetMapping("/readiness")
    public ResponseEntity<?> readiness(HttpServletRequest request, @PathVariable String deviceId) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return ResponseEntity.ok(firmwareCalibrationService.getLatestReadiness(deviceId));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }
}
