package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.model.CloudSessionRecord;
import lk.resq.cloudapi.model.CloudSessionSummarySyncPayload;
import lk.resq.cloudapi.model.CloudSessionSyncResponse;
import lk.resq.cloudapi.service.CloudSessionSyncService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sync/session-summaries")
public class CloudSessionSyncController {

    private final CloudSessionSyncService service;

    public CloudSessionSyncController(CloudSessionSyncService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<CloudSessionSyncResponse> accept(@RequestBody CloudSessionSummarySyncPayload payload) {
        CloudSessionSyncResponse response = service.accept(payload);
        HttpStatus status = "CREATED".equals(response.result()) ? HttpStatus.CREATED : HttpStatus.OK;
        return ResponseEntity.status(status).body(response);
    }

    @GetMapping("/{localHubId}/{localSessionId}")
    public CloudSessionRecord findByLocalIdentity(
            @PathVariable String localHubId,
            @PathVariable String localSessionId
    ) {
        return service.findByLocalIdentity(localHubId, localSessionId);
    }
}
