package lk.resq.localhub.controller;

import jakarta.servlet.http.HttpServletRequest;
import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.UserRole;
import lk.resq.localhub.service.AuthService;
import lk.resq.localhub.service.ForbiddenException;
import lk.resq.localhub.service.MqttCommandPublishException;
import lk.resq.localhub.service.MqttCommandPublisherService;
import lk.resq.localhub.service.SensorStreamService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/devices/{deviceId}/telemetry")
public class DeviceTelemetryController {

    private final AuthService authService;
    private final MqttCommandPublisherService mqttCommandPublisherService;
    private final SensorStreamService sensorStreamService;

    public DeviceTelemetryController(
            AuthService authService,
            MqttCommandPublisherService mqttCommandPublisherService,
            SensorStreamService sensorStreamService
    ) {
        this.authService = authService;
        this.mqttCommandPublisherService = mqttCommandPublisherService;
        this.sensorStreamService = sensorStreamService;
    }

    @PostMapping("/start")
    public ResponseEntity<?> startTelemetry(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @RequestBody(required = false) Map<String, Object> body
    ) {
        Integer intervalMs;
        try {
            intervalMs = requireInterval(body);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        }
        return publishTelemetryControl(request, deviceId, "START", intervalMs);
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopTelemetry(HttpServletRequest request, @PathVariable String deviceId) {
        return publishTelemetryControl(request, deviceId, "STOP", null);
    }

    @GetMapping("/latest")
    public ResponseEntity<?> latestTelemetry(HttpServletRequest request, @PathVariable String deviceId) {
        try {
            authService.requireRole(request, UserRole.ADMIN, UserRole.INSTRUCTOR);
            return sensorStreamService.latestSnapshot(deviceId)
                    .<ResponseEntity<?>>map(snapshot -> {
                        Map<String, Object> response = new LinkedHashMap<>();
                        response.put("device_id", deviceId);
                        response.put("stream_observed", true);
                        response.put("latest_snapshot", snapshot);
                        response.put("receivedAt", snapshot.receivedAt());
                        return ResponseEntity.ok(response);
                    })
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("No sensor stream snapshot has been observed for device " + deviceId)));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    private ResponseEntity<?> publishTelemetryControl(
            HttpServletRequest request,
            String deviceId,
            String action,
            Integer intervalMs
    ) {
        try {
            AuthUser actor = authService.requireRole(request, UserRole.INSTRUCTOR);
            MqttCommandPublisherService.FirmwareCommandPublishResult result =
                    mqttCommandPublisherService.publishTelemetryControl(deviceId, action, intervalMs);
            authService.audit(
                    actor.id(),
                    "FIRMWARE_TELEMETRY_" + action,
                    "device",
                    deviceId,
                    Map.of("requestId", result.requestId())
            );

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("deviceId", deviceId);
            response.put("device_id", deviceId);
            response.put("request_id", result.requestId());
            response.put("action", action);
            response.put("command", "telemetry/" + action.toLowerCase());
            response.put("topic", result.topic());
            if (intervalMs != null) {
                response.put("interval_ms", intervalMs);
            }
            response.put("status", "PUBLISHED");
            return ResponseEntity.accepted().body(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        } catch (ForbiddenException error) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    private static Integer requireInterval(Map<String, Object> body) {
        if (body == null || !body.containsKey("interval_ms")) {
            throw new IllegalArgumentException("interval_ms is required");
        }
        Integer value = integerValue(body.get("interval_ms"));
        SensorStreamService.validateIntervalMs(value);
        return value;
    }

    private static Integer integerValue(Object value) {
        if (value instanceof Number number) {
            double doubleValue = number.doubleValue();
            if (!Double.isFinite(doubleValue) || doubleValue % 1 != 0) {
                return null;
            }
            return number.intValue();
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return Integer.parseInt(text.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }
}
