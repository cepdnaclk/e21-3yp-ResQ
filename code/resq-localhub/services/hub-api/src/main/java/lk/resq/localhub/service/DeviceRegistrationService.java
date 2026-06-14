package lk.resq.localhub.service;

import lk.resq.localhub.model.DeviceRegistrationRequest;
import lk.resq.localhub.model.DeviceRegistrationResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Service
public class DeviceRegistrationService {

    private final HubServiceInfoService hubServiceInfoService;
    private final ConcurrentMap<String, String> deviceIdsByRegistrationKey = new ConcurrentHashMap<>();
    private static final Logger LOG = LoggerFactory.getLogger(DeviceRegistrationService.class);

    public DeviceRegistrationService(HubServiceInfoService hubServiceInfoService) {
        this.hubServiceInfoService = hubServiceInfoService;
    }

    public DeviceRegistrationResponse register(DeviceRegistrationRequest request) {
        String deviceId = resolveDeviceId(request == null ? new DeviceRegistrationRequest(null, null, null, null) : request);
        var serviceInfo = hubServiceInfoService.serviceInfo();
        LOG.info("Registering device {} -> advertising MQTT {}:{}", deviceId, serviceInfo.mqttHost(), serviceInfo.mqttPort());
        return new DeviceRegistrationResponse(
                true,
                deviceId,
                serviceInfo.mqttHost(),
                serviceInfo.mqttPort()
        );
    }

    private String resolveDeviceId(DeviceRegistrationRequest request) {
        String label = normalizeDeviceId(request.deviceLabel());
        if (label != null) {
            return label;
        }

        String key = registrationKey(request);
        return deviceIdsByRegistrationKey.computeIfAbsent(key, this::deviceIdForKey);
    }

    private String registrationKey(DeviceRegistrationRequest request) {
        String mac = normalizeKey(request.mac());
        if (mac != null) {
            return "mac:" + mac;
        }

        String chipId = normalizeKey(request.chipId());
        if (chipId != null) {
            return "chip:" + chipId;
        }

        return "dev:local";
    }

    private String deviceIdForKey(String key) {
        if ("dev:local".equals(key)) {
            return "M-DEV";
        }

        int bucket = Math.floorMod(key.hashCode(), 900) + 100;
        return "M" + bucket;
    }

    private static String normalizeDeviceId(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty() || !trimmed.matches("[A-Za-z0-9_-]{1,32}")) {
            return null;
        }
        return trimmed;
    }

    private static String normalizeKey(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        return normalized.isEmpty() ? null : normalized;
    }
}
