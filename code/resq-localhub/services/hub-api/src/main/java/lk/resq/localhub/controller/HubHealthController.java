package lk.resq.localhub.controller;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import lk.resq.localhub.model.HubServiceInfoResponse;
import lk.resq.localhub.service.HubServiceInfoService;
import lk.resq.localhub.service.MqttSubscriberService;

import java.time.Instant;
import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/hub")
public class HubHealthController {

    private final HubServiceInfoService hubServiceInfoService;
    private final ObjectProvider<MqttSubscriberService> mqttSubscriberServiceProvider;

    public HubHealthController(
            HubServiceInfoService hubServiceInfoService,
            ObjectProvider<MqttSubscriberService> mqttSubscriberServiceProvider
    ) {
        this.hubServiceInfoService = hubServiceInfoService;
        this.mqttSubscriberServiceProvider = mqttSubscriberServiceProvider;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        boolean mqttConnected = false;
        try {
            MqttSubscriberService sub = mqttSubscriberServiceProvider.getIfAvailable();
            if (sub != null) {
                mqttConnected = sub.isMqttConnected();
            }
        } catch (Exception ignored) {}

        Map<String, Object> result = new HashMap<>();
        result.put("ok", true);
        result.put("service", "hub-api");
        result.put("timestamp", Instant.now().toString());
        result.put("mqtt_connected", mqttConnected);
        return result;
    }

    @GetMapping("/service-info")
    public HubServiceInfoResponse serviceInfo() {
        return hubServiceInfoService.serviceInfo();
    }
}
