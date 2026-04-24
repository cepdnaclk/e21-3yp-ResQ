package lk.resq.localhub.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class LiveStateMonitorService {

    private final ManikinRegistryService manikinRegistryService;
    private final ActiveSessionService activeSessionService;

    public LiveStateMonitorService(
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService
    ) {
        this.manikinRegistryService = manikinRegistryService;
        this.activeSessionService = activeSessionService;
    }

    @Scheduled(fixedDelayString = "${resq.live.stale-check-interval-ms:2000}")
    public void publishStaleTransitions() {
        List<String> staleDeviceIds = manikinRegistryService.markStaleOfflineAndGetChangedDeviceIds();
        if (staleDeviceIds.isEmpty()) {
            return;
        }

        activeSessionService.publishLiveUpdatesForStaleDevices(staleDeviceIds);
    }
}
