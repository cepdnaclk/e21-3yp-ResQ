package lk.resq.localhub.controller;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import lk.resq.localhub.model.HubServiceInfoResponse;
import lk.resq.localhub.service.HubServiceInfoService;
import lk.resq.localhub.service.MqttSubscriberService;
import lk.resq.localhub.service.ManikinRegistryService;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.CalibrationStreamService;
import lk.resq.localhub.service.SensorStreamService;

import java.time.Instant;
import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/hub")
public class HubHealthController {

    private final HubServiceInfoService hubServiceInfoService;
    private final ObjectProvider<MqttSubscriberService> mqttSubscriberServiceProvider;
    private final ManikinRegistryService manikinRegistryService;
    private final LiveStreamService liveStreamService;
    private final CalibrationStreamService calibrationStreamService;
    private final SensorStreamService sensorStreamService;

    public HubHealthController(
            HubServiceInfoService hubServiceInfoService,
            ObjectProvider<MqttSubscriberService> mqttSubscriberServiceProvider,
            ManikinRegistryService manikinRegistryService,
            LiveStreamService liveStreamService,
            CalibrationStreamService calibrationStreamService,
            SensorStreamService sensorStreamService
    ) {
        this.hubServiceInfoService = hubServiceInfoService;
        this.mqttSubscriberServiceProvider = mqttSubscriberServiceProvider;
        this.manikinRegistryService = manikinRegistryService;
        this.liveStreamService = liveStreamService;
        this.calibrationStreamService = calibrationStreamService;
        this.sensorStreamService = sensorStreamService;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        boolean mqttConnected = false;
        String mqttBrokerUrl = null;
        String mqttAdvertisedHost = null;
        int mqttAdvertisedPort = 1883;
        String backendBaseUrl = null;
        String hubServiceInfoError = null;
        int liveManikinCount = 0;

        try {
            MqttSubscriberService sub = mqttSubscriberServiceProvider.getIfAvailable();
            if (sub != null) {
                mqttConnected = sub.isMqttConnected();
            }
        } catch (Exception ignored) {
        }

        try {
            HubServiceInfoResponse serviceInfo = hubServiceInfoService.serviceInfo();
            mqttBrokerUrl = serviceInfo.mqttBrokerUrl();
            mqttAdvertisedHost = serviceInfo.mqttHost();
            mqttAdvertisedPort = serviceInfo.mqttPort();
            backendBaseUrl = serviceInfo.backendBaseUrl();
        } catch (Exception error) {
            hubServiceInfoError = error.getMessage();
        }

        try {
            if (manikinRegistryService != null) {
                liveManikinCount = manikinRegistryService.getLiveSummaries().size();
            }
        } catch (Exception ignored) {
        }

        Map<String, Object> result = new HashMap<>();
        result.put("ok", hubServiceInfoError == null);
        result.put("service", "hub-api");
        result.put("timestamp", Instant.now().toString());
        result.put("mqtt_connected", mqttConnected);
        result.put("mqtt_broker_url", mqttBrokerUrl);
        result.put("mqtt_advertised_host", mqttAdvertisedHost);
        result.put("mqtt_advertised_port", mqttAdvertisedPort);
        result.put("backend_base_url", backendBaseUrl);
        result.put("live_manikin_count", liveManikinCount);
        int instructorEmitters = liveStreamService.instructorEmitterCount();
        int sessionEmitters = liveStreamService.sessionEmitterCount();
        int calibrationEmitters = calibrationStreamService.totalEmitterCount();
        int sensorStreamEmitters = sensorStreamService.totalSubscriberCount();
        result.put("active_sse_emitters", instructorEmitters + sessionEmitters + calibrationEmitters + sensorStreamEmitters);
        result.put("sse_instructor_emitters", instructorEmitters);
        result.put("sse_session_emitters", sessionEmitters);
        result.put("sse_calibration_emitters", calibrationEmitters);
        result.put("sse_sensor_stream_emitters", sensorStreamEmitters);
        result.put("sse_fanout_queue_depth", liveStreamService.queuedFanoutTaskCount());
        result.put("sse_fanout_dropped_tasks", liveStreamService.droppedFanoutTaskCount());
        if (hubServiceInfoError != null) {
            result.put("hub_service_info_error", hubServiceInfoError);
        }

        return result;
    }

    @GetMapping("/service-info")
    public HubServiceInfoResponse serviceInfo() {
        return hubServiceInfoService.serviceInfo();
    }
}
