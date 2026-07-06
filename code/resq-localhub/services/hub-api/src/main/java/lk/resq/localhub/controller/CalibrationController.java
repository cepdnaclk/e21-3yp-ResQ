package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.CalibrationStartRequest;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.CalibrationEvidence;
import lk.resq.localhub.model.firmware.CalibrationEvidenceDetail;
import lk.resq.localhub.model.firmware.CalibrationEventLog;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.CalibrationCommandService;
import lk.resq.localhub.service.DeviceReadinessService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.MqttCommandPublishException;
import lk.resq.localhub.service.CalibrationPersistenceRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/devices/{deviceId}")
public class CalibrationController {

    private final CalibrationCommandService calibrationCommandService;
    private final DeviceReadinessService deviceReadinessService;
    private final AuthService authService;
    private final CalibrationPersistenceRepository calibrationPersistenceRepository;

    public CalibrationController(
            CalibrationCommandService calibrationCommandService,
            DeviceReadinessService deviceReadinessService,
            AuthService authService,
            CalibrationPersistenceRepository calibrationPersistenceRepository
    ) {
        this.calibrationCommandService = calibrationCommandService;
        this.deviceReadinessService = deviceReadinessService;
        this.authService = authService;
        this.calibrationPersistenceRepository = calibrationPersistenceRepository;
    }

    @PostMapping("/calibration/start")
    public ResponseEntity<?> startCalibration(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestBody(required = false) CalibrationStartRequest requestBody
    ) {
        try {
            // Allow INSTRUCTOR and ADMIN roles
            // TODO: Add TECHNICIAN role when supported
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);
            var response = calibrationCommandService.startCalibration(deviceId, requestBody, actor.username());
            authService.audit(actor.id(), "CALIBRATION_START", "device", deviceId, Map.of("requestId", response.requestId()));
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
    public ResponseEntity<?> cancelCalibration(
            HttpServletRequest request,
            @PathVariable String deviceId
    ) {
        try {
            // Allow INSTRUCTOR and ADMIN roles
            // TODO: Add TECHNICIAN role when supported
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);
            var response = calibrationCommandService.cancelCalibration(deviceId);
            authService.audit(actor.id(), "CALIBRATION_CANCEL", "device", deviceId, Map.of("requestId", response.requestId()));
            return ResponseEntity.accepted().body(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/readiness")
    public ResponseEntity<?> readiness(
            HttpServletRequest request,
            @PathVariable String deviceId
    ) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);
            DeviceReadinessState state = deviceReadinessService.getReadiness(deviceId);
            return ResponseEntity.ok(state);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/calibration/history")
    public ResponseEntity<?> calibrationHistory(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestParam(required = false) Integer limit
    ) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);
            int resolvedLimit = limit == null ? 20 : Math.min(100, Math.max(1, limit));
            List<CalibrationEvidence> history = calibrationPersistenceRepository.findEvidenceHistory(deviceId, resolvedLimit);
            return ResponseEntity.ok(history);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/calibration/latest")
    public ResponseEntity<?> latestCalibrationEvidence(
            HttpServletRequest request,
            @PathVariable String deviceId
    ) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);
            CalibrationEvidence latest = calibrationPersistenceRepository.findLatestEvidence(deviceId).orElse(null);
            return ResponseEntity.ok(latest);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/calibration/history/{evidenceId}")
    public ResponseEntity<?> calibrationHistoryDetail(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @PathVariable Long evidenceId
    ) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR, UserRole.ADMIN);
            Optional<CalibrationEvidence> evidenceOpt = calibrationPersistenceRepository.findEvidenceById(deviceId, evidenceId);
            if (evidenceOpt.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            CalibrationEvidence evidence = evidenceOpt.get();
            List<CalibrationEventLog> logs = calibrationPersistenceRepository.findEventLogsForRequest(deviceId, evidence.requestId());
            return ResponseEntity.ok(new CalibrationEvidenceDetail(evidence, logs));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }
}
