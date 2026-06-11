package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.config.CloudHubAuthenticationFilter;
import lk.resq.cloudapi.model.CloudRosterResponse;
import lk.resq.cloudapi.service.CloudRosterSyncService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * GET /api/sync/roster
 *
 * <p>Returns the cloud-master roster for the calling LocalHub. Authentication
 * is handled by {@link CloudHubAuthenticationFilter} before this controller
 * is reached; Spring Security enforces {@code ROLE_HUB} on this path.</p>
 *
 * <p>The hub id is read from the {@code X-ResQ-Hub-Id} header — the filter
 * has already validated that it matches a real, active hub record.</p>
 *
 * <h2>Contract</h2>
 * <pre>
 * GET /api/sync/roster
 * Headers:
 *   X-ResQ-Hub-Id:  &lt;hub_id&gt;
 *   X-ResQ-Hub-Key: &lt;plaintext_api_key&gt;
 *
 * 200 OK  → CloudRosterResponse (JSON)
 * 401     → hub_credentials_missing | hub_authentication_failed
 * 403     → access_denied (should not happen if filter is wired correctly)
 * </pre>
 */
@RestController
@RequestMapping("/api/sync/roster")
public class CloudRosterSyncController {

    private final CloudRosterSyncService service;

    public CloudRosterSyncController(CloudRosterSyncService service) {
        this.service = service;
    }

    /**
     * Pull the cloud-master roster for the authenticated hub.
     *
     * @param hubId the value of the {@code X-ResQ-Hub-Id} header (validated by the filter)
     * @return a full roster snapshot
     */
    @GetMapping
    public CloudRosterResponse getRoster(
            @RequestHeader(CloudHubAuthenticationFilter.HEADER_HUB_ID) String hubId
    ) {
        if (hubId == null || hubId.isBlank()) {
            // Guard: should never happen because the filter rejects blank hub-id first.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "hub_id_missing");
        }
        return service.buildRoster(hubId);
    }
}
