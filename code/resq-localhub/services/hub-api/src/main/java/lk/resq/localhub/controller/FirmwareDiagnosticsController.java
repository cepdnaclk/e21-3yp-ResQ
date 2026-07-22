package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.model.firmware.DeviceReadinessState;
import lk.resq.localhub.model.firmware.FirmwareCommandPublishResponse;
import lk.resq.localhub.model.firmware.FirmwareDeviceDiagnosticsResponse;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.DeviceReadinessService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.FirmwarePersistenceRepository;
import lk.resq.localhub.service.MqttCommandPublishException;
import lk.resq.localhub.service.MqttCommandPublisherService;
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/devices/{deviceId}/firmware")
public class FirmwareDiagnosticsController {

    private final AuthService authService;
    private final DeviceReadinessService deviceReadinessService;
    private final FirmwarePersistenceRepository firmwarePersistenceRepository;
    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final ManikinRegistryService manikinRegistryService;

    public FirmwareDiagnosticsController(
            AuthService authService,
            DeviceReadinessService deviceReadinessService,
            FirmwarePersistenceRepository firmwarePersistenceRepository,
            MqttCommandPublisherService mqttCommandPublisherService,
            ManikinRegistryService manikinRegistryService
    ) {
        this.authService = authService;
        this.deviceReadinessService = deviceReadinessService;
        this.firmwarePersistenceRepository = firmwarePersistenceRepository;
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.manikinRegistryService = manikinRegistryService;
    }

    @GetMapping("/commands")
    public ResponseEntity<?> recentCommands(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestParam(required = false) Integer limit
    ) {
        return runWithAuth(request, () -> ResponseEntity.ok(firmwarePersistenceRepository.findRecentCommands(deviceId, clampLimit(limit, 20, 100))));
    }

    @GetMapping("/events")
    public ResponseEntity<?> recentEvents(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestParam(required = false) Integer limit
    ) {
        return runWithAuth(request, () -> ResponseEntity.ok(firmwarePersistenceRepository.findRecentEvents(deviceId, clampLimit(limit, 50, 200))));
    }

    @GetMapping("/debug-snapshots")
    public ResponseEntity<?> recentDebugSnapshots(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestParam(required = false) Integer limit
    ) {
        return runWithAuth(request, () -> ResponseEntity.ok(firmwarePersistenceRepository.findDebugSnapshots(deviceId, clampLimit(limit, 20, 100))));
    }

    @GetMapping("/diagnostics")
    public ResponseEntity<?> diagnostics(HttpServletRequest request, @PathVariable String deviceId) {
        return runWithAuth(request, () -> {
            DeviceReadinessState readiness = deviceReadinessService.getReadiness(deviceId);
            return ResponseEntity.ok(new FirmwareDeviceDiagnosticsResponse(
                    deviceId,
                    readiness,
                    firmwarePersistenceRepository.findLatestCalibrationResult(deviceId).orElse(null),
                    manikinRegistryService.getLiveSummary(deviceId).orElse(null),
                    firmwarePersistenceRepository.findRecentCommands(deviceId, 20),
                    firmwarePersistenceRepository.findRecentEvents(deviceId, 50),
                    firmwarePersistenceRepository.findDebugSnapshots(deviceId, 20)
            ));
        });
    }

    @PostMapping("/debug")
    public ResponseEntity<?> requestDebugSnapshot(HttpServletRequest request, @PathVariable String deviceId) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            MqttCommandPublisherService.FirmwareCommandPublishResult result = mqttCommandPublisherService.publishDebugCommand(deviceId);
            authService.audit(actor.id(), "FIRMWARE_DEBUG_REQUEST", "device", deviceId, Map.of("requestId", result.requestId()));
            return ResponseEntity.ok(new FirmwareCommandPublishResponse(deviceId, result.requestId(), result.topic(), "PUBLISHED", null));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    private ResponseEntity<?> runWithAuth(HttpServletRequest request, ControllerAction action) {
        try {
            authService.requireRole(request, UserRole.INSTRUCTOR);
            return action.run();
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    private static int clampLimit(Integer requestedLimit, int defaultLimit, int maxLimit) {
        if (requestedLimit == null) {
            return defaultLimit;
        }
        return Math.max(1, Math.min(maxLimit, requestedLimit));
    }

    @FunctionalInterface
    private interface ControllerAction {
        ResponseEntity<?> run();
    }
}
