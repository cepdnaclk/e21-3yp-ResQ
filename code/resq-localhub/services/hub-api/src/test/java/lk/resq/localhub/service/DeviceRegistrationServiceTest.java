package lk.resq.localhub.service;

import lk.resq.localhub.model.DeviceRegistrationRequest;
import lk.resq.localhub.model.DeviceRegistrationResponse;
import lk.resq.localhub.model.HubServiceInfoResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeviceRegistrationServiceTest {

    private static final String MQTT_HOST = "192.168.8.187";
    private static final int MQTT_PORT = 1883;

    @Mock
    private HubServiceInfoService hubServiceInfoService;

    @Mock
    private ManikinRegistryService manikinRegistryService;

    @Test
    void register_whenDeviceLabelIsValid_usesLabelDirectly() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest(null, null, null, "M01");
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertSuccessfulResponse(response, "M01");
        verifySuccessfulRegistration("M01", request);
    }

    @Test
    void register_whenDeviceLabelHasSurroundingWhitespace_trimsLabel() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest(null, null, null, "  M01  ");
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertSuccessfulResponse(response, "M01");
        verifySuccessfulRegistration("M01", request);
    }

    @Test
    void register_whenDeviceLabelHasOneCharacter_acceptsLowerBoundary() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest(null, null, null, "M");
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertSuccessfulResponse(response, "M");
        verifySuccessfulRegistration("M", request);
    }

    @Test
    void register_whenDeviceLabelHasThirtyTwoCharacters_acceptsUpperBoundary() {
        String label = "M1234567890123456789012345678901";
        DeviceRegistrationRequest request = new DeviceRegistrationRequest(null, null, null, label);
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertThat(label).hasSize(32);
        assertSuccessfulResponse(response, label);
        verifySuccessfulRegistration(label, request);
    }

    @Test
    void register_whenDeviceLabelHasThirtyThreeCharacters_usesFallbackIdentity() {
        String label = "M12345678901234567890123456789012";
        DeviceRegistrationRequest request = new DeviceRegistrationRequest("a0:b1:c2:d3:e4:f5", null, null, label);
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertThat(label).hasSize(33);
        assertGeneratedDeviceResponse(response);
        assertThat(response.deviceId()).isNotEqualTo(label);
        verifySuccessfulRegistration(response.deviceId(), request);
    }

    @Test
    void register_whenDeviceLabelContainsInvalidCharacters_usesFallbackIdentity() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest("a0:b1:c2:d3:e4:f5", null, null, "M 01!");
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertGeneratedDeviceResponse(response);
        assertThat(response.deviceId()).isNotEqualTo("M 01!");
        verifySuccessfulRegistration(response.deviceId(), request);
    }

    @Test
    void register_whenRequestIsNull_usesDevelopmentDeviceId() {
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(null);

        assertSuccessfulResponse(response, "M-DEV");
        ArgumentCaptor<DeviceRegistrationRequest> requestCaptor = ArgumentCaptor.forClass(DeviceRegistrationRequest.class);
        InOrder ordered = inOrder(manikinRegistryService, hubServiceInfoService);
        ordered.verify(manikinRegistryService).seedFromRegistration(
                org.mockito.ArgumentMatchers.eq("M-DEV"),
                requestCaptor.capture()
        );
        ordered.verify(hubServiceInfoService).serviceInfo();
        ordered.verify(manikinRegistryService).registerDevice("M-DEV");
        assertThat(requestCaptor.getValue().mac()).isNull();
        assertThat(requestCaptor.getValue().chipId()).isNull();
        assertThat(requestCaptor.getValue().firmwareVersion()).isNull();
        assertThat(requestCaptor.getValue().deviceLabel()).isNull();
    }

    @Test
    void register_whenAllIdentityFieldsAreMissingOrBlank_usesDevelopmentDeviceId() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest("  ", " ", "1.0.0", " ");
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertSuccessfulResponse(response, "M-DEV");
        verifySuccessfulRegistration("M-DEV", request);
    }

    @Test
    void register_whenEquivalentMacValuesAreProvided_returnsStableDeviceId() {
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse first = service.register(new DeviceRegistrationRequest("a0:b1:c2:d3:e4:f5", null, null, null));
        DeviceRegistrationResponse second = service.register(new DeviceRegistrationRequest("A0:B1:C2:D3:E4:F5", null, null, null));
        DeviceRegistrationResponse third = service.register(new DeviceRegistrationRequest("  a0:b1:c2:d3:e4:f5  ", null, null, null));

        assertGeneratedDeviceResponse(first);
        assertThat(second.deviceId()).isEqualTo(first.deviceId());
        assertThat(third.deviceId()).isEqualTo(first.deviceId());
    }

    @Test
    void register_whenMacIsMissingAndChipIdExists_usesStableChipBasedId() {
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse first = service.register(new DeviceRegistrationRequest(null, "chip-001", null, null));
        DeviceRegistrationResponse second = service.register(new DeviceRegistrationRequest(null, "  CHIP-001  ", null, null));

        assertGeneratedDeviceResponse(first);
        assertThat(second.deviceId()).isEqualTo(first.deviceId());
    }

    @Test
    void register_whenLabelMacAndChipIdExist_prioritizesValidLabel() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest(
                "a0:b1:c2:d3:e4:f5",
                "chip-001",
                "1.0.0",
                "M01"
        );
        DeviceRegistrationService service = newService();

        DeviceRegistrationResponse response = service.register(request);

        assertSuccessfulResponse(response, "M01");
        verifySuccessfulRegistration("M01", request);
    }

    @Test
    void register_whenServiceInfoLookupFails_propagatesExceptionAndDoesNotCompleteRegistration() {
        RuntimeException serviceInfoError =
                new RuntimeException("Unable to resolve hub service information");
        when(hubServiceInfoService.serviceInfo()).thenThrow(serviceInfoError);
        DeviceRegistrationRequest request = new DeviceRegistrationRequest(null, null, null, "M01");
        DeviceRegistrationService service = new DeviceRegistrationService(hubServiceInfoService, manikinRegistryService);

        assertThatThrownBy(() -> service.register(request))
                .isSameAs(serviceInfoError)
                .hasMessage("Unable to resolve hub service information");

        InOrder ordered = inOrder(manikinRegistryService, hubServiceInfoService);
        ordered.verify(manikinRegistryService).seedFromRegistration("M01", request);
        ordered.verify(hubServiceInfoService).serviceInfo();
        verify(manikinRegistryService, never()).registerDevice(any());
    }

    private DeviceRegistrationService newService() {
        when(hubServiceInfoService.serviceInfo()).thenReturn(serviceInfo());
        return new DeviceRegistrationService(hubServiceInfoService, manikinRegistryService);
    }

    private void assertSuccessfulResponse(DeviceRegistrationResponse response, String deviceId) {
        assertThat(response).isNotNull();
        assertThat(response.ok()).isTrue();
        assertThat(response.deviceId()).isEqualTo(deviceId);
        assertThat(response.mqttHost()).isEqualTo(MQTT_HOST);
        assertThat(response.mqttPort()).isEqualTo(MQTT_PORT);
    }

    private void assertGeneratedDeviceResponse(DeviceRegistrationResponse response) {
        assertThat(response).isNotNull();
        assertThat(response.ok()).isTrue();
        assertThat(response.deviceId()).matches("M\\d{3}");
        assertThat(response.mqttHost()).isEqualTo(MQTT_HOST);
        assertThat(response.mqttPort()).isEqualTo(MQTT_PORT);
    }

    private void verifySuccessfulRegistration(String deviceId, DeviceRegistrationRequest request) {
        InOrder ordered = inOrder(manikinRegistryService, hubServiceInfoService);
        ordered.verify(manikinRegistryService).seedFromRegistration(deviceId, request);
        ordered.verify(hubServiceInfoService).serviceInfo();
        ordered.verify(manikinRegistryService).registerDevice(deviceId);
    }

    private HubServiceInfoResponse serviceInfo() {
        return new HubServiceInfoResponse(
                true,
                "http://192.168.8.187:18080",
                "tcp://localhost:1883",
                MQTT_HOST,
                MQTT_PORT,
                "http://localhost:1420",
                "192.168.8.187",
                false,
                false
        );
    }
}
