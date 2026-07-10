package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LiveStateMonitorServiceTest {

    @Mock
    private ManikinRegistryService manikinRegistryService;

    @Mock
    private ActiveSessionService activeSessionService;

    @Test
    void publishStaleTransitions_whenNoDevicesBecomeStale_doesNotPublishUpdates() {
        when(manikinRegistryService.markStaleOfflineAndGetChangedDeviceIds())
                .thenReturn(List.of());

        LiveStateMonitorService service = createService();

        service.publishStaleTransitions();

        verify(manikinRegistryService)
                .markStaleOfflineAndGetChangedDeviceIds();
        verifyNoMoreInteractions(manikinRegistryService);
        verifyNoInteractions(activeSessionService);
    }

    @Test
    void publishStaleTransitions_whenOneDeviceBecomesStale_publishesThatDevice() {
        List<String> staleDeviceIds = List.of("M-001");

        when(manikinRegistryService.markStaleOfflineAndGetChangedDeviceIds())
                .thenReturn(staleDeviceIds);

        LiveStateMonitorService service = createService();

        service.publishStaleTransitions();

        verify(manikinRegistryService, times(1))
                .markStaleOfflineAndGetChangedDeviceIds();
        verify(activeSessionService, times(1))
                .publishLiveUpdatesForStaleDevices(same(staleDeviceIds));
        verifyNoMoreInteractions(activeSessionService);
    }

    @Test
    void publishStaleTransitions_whenMultipleDevicesBecomeStale_publishesCompleteList() {
        List<String> staleDeviceIds = List.of(
                "M-001",
                "M-002",
                "M-003"
        );

        when(manikinRegistryService.markStaleOfflineAndGetChangedDeviceIds())
                .thenReturn(staleDeviceIds);

        LiveStateMonitorService service = createService();

        service.publishStaleTransitions();

        verify(manikinRegistryService, times(1))
                .markStaleOfflineAndGetChangedDeviceIds();
        verify(activeSessionService, times(1))
                .publishLiveUpdatesForStaleDevices(same(staleDeviceIds));
        verifyNoMoreInteractions(activeSessionService);
    }

    @Test
    void publishStaleTransitions_whenRegistryFails_propagatesExceptionAndDoesNotPublish() {
        RuntimeException registryError =
                new RuntimeException("Unable to evaluate stale devices");

        when(manikinRegistryService.markStaleOfflineAndGetChangedDeviceIds())
                .thenThrow(registryError);

        LiveStateMonitorService service = createService();

        assertThatThrownBy(service::publishStaleTransitions)
                .isSameAs(registryError)
                .hasMessage("Unable to evaluate stale devices");

        verify(manikinRegistryService, times(1))
                .markStaleOfflineAndGetChangedDeviceIds();
        verifyNoInteractions(activeSessionService);
    }

    private LiveStateMonitorService createService() {
        return new LiveStateMonitorService(
                manikinRegistryService,
                activeSessionService
        );
    }
}
