package lk.resq.localhub.controller;

import lk.resq.localhub.model.DeviceRegistrationRequest;
import lk.resq.localhub.model.DeviceRegistrationResponse;
import lk.resq.localhub.service.DeviceRegistrationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class DeviceRegistrationController {

    private final DeviceRegistrationService deviceRegistrationService;

    public DeviceRegistrationController(DeviceRegistrationService deviceRegistrationService) {
        this.deviceRegistrationService = deviceRegistrationService;
    }

    @PostMapping("/devices/register")
    public ResponseEntity<DeviceRegistrationResponse> registerDevice(
            @RequestBody(required = false) DeviceRegistrationRequest request
    ) {
        return ResponseEntity.ok(deviceRegistrationService.register(request));
    }

    @GetMapping("/devices/register")
    public ResponseEntity<DeviceRegistrationResponse> registerDevDevice() {
        return ResponseEntity.ok(deviceRegistrationService.register(null));
    }
}
