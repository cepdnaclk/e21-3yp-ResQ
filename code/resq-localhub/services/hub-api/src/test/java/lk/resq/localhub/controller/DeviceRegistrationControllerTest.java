package lk.resq.localhub.controller;

import lk.resq.localhub.model.DeviceRegistrationRequest;
import lk.resq.localhub.model.DeviceRegistrationResponse;
import lk.resq.localhub.model.HubServiceInfoResponse;
import lk.resq.localhub.service.DeviceRegistrationService;
import lk.resq.localhub.service.HubServiceInfoService;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceRegistrationControllerTest {

    @Test
    void registerDeviceAcceptsMinimalBodyWithoutManikinId() {
        Fixture fixture = newFixture();

        ResponseEntity<DeviceRegistrationResponse> response = fixture.deviceController.registerDevice(
                new DeviceRegistrationRequest("A0:B1:C2:D3:E4:F5", null, null, null)
        );

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().ok()).isTrue();
        assertThat(response.getBody().deviceId()).startsWith("M");
        assertThat(response.getBody().mqttHost()).isEqualTo("192.168.8.187");
        assertThat(response.getBody().mqttPort()).isEqualTo(1883);
    }

    @Test
    void registerDeviceUsesStableLabelWhenProvided() {
        Fixture fixture = newFixture();

        DeviceRegistrationResponse first = fixture.deviceController.registerDevice(
                new DeviceRegistrationRequest(null, "chip-001", "1.0.0", "M01")
        ).getBody();
        DeviceRegistrationResponse second = fixture.deviceController.registerDevice(
                new DeviceRegistrationRequest(null, "chip-001", "1.0.1", "M01")
        ).getBody();

        assertThat(first).isNotNull();
        assertThat(second).isNotNull();
        assertThat(first.deviceId()).isEqualTo("M01");
        assertThat(second.deviceId()).isEqualTo("M01");
    }

    @Test
    void registerDeviceAllowsEmptyDevBody() {
        Fixture fixture = newFixture();

        ResponseEntity<DeviceRegistrationResponse> response = fixture.deviceController.registerDevice(null);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().deviceId()).isEqualTo("M-DEV");
    }

    @Test
    void serviceInfoReturnsBackendBaseUrlAndMqttInfo() {
        Fixture fixture = newFixture();

        HubServiceInfoResponse response = fixture.hubController.serviceInfo();

        assertThat(response.ok()).isTrue();
        assertThat(response.backendBaseUrl()).isEqualTo("http://192.168.8.187:18080");
        assertThat(response.mqttHost()).isEqualTo("192.168.8.187");
        assertThat(response.mqttPort()).isEqualTo(1883);
        assertThat(response.dashboardUrl()).isEqualTo("http://localhost:1420");
        assertThat(response.localIp()).isNotBlank();
    }

    private static Fixture newFixture() {
        HubServiceInfoService serviceInfoService = new HubServiceInfoService(
                18080,
                "192.168.8.187",
                "",
                "tcp://localhost:1883",
                "",
                "",
                1883,
                "http://localhost:1420",
                ""
        );
        DeviceRegistrationService registrationService = new DeviceRegistrationService(serviceInfoService);
        return new Fixture(
                new DeviceRegistrationController(registrationService),
                new HubHealthController(serviceInfoService)
        );
    }

    private record Fixture(DeviceRegistrationController deviceController, HubHealthController hubController) {
    }
}
