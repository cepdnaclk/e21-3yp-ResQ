package lk.resq.localhub.service;

import lk.resq.localhub.config.RosterSyncProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Worker that polls the Cloud API periodically to sync the local roster cache.
 */
@Service
public class RosterSyncWorker {

    private static final Logger logger = LoggerFactory.getLogger(RosterSyncWorker.class);

    private final RosterSyncProperties properties;
    private final RosterSyncService rosterSyncService;

    public RosterSyncWorker(
            RosterSyncProperties properties,
            RosterSyncService rosterSyncService
    ) {
        this.properties = properties;
        this.rosterSyncService = rosterSyncService;
    }

    /**
     * Periodic task checking and executing the roster pull.
     * Scheduled using the configured fixed delay (default 5 minutes).
     */
    @Scheduled(fixedDelayString = "${resq.roster-sync.fixed-delay-ms:300000}")
    public void syncRosterPeriodically() {
        if (!properties.isEnabled()) {
            return;
        }

        if (!properties.hasCredentials()) {
            logger.warn("Roster sync is enabled but credentials are not fully configured (base-url, hub-id, or hub-key is missing). Skipping sync.");
            return;
        }

        try {
            logger.info("Executing scheduled roster sync pull...");
            rosterSyncService.syncRoster();
        } catch (Exception error) {
            logger.warn("Scheduled roster sync pull failed: {}", concise(error));
        }
    }

    private static String concise(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank()
                ? error.getClass().getSimpleName()
                : message.replaceAll("\\s+", " ").trim();
    }
}
