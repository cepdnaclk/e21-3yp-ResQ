package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.model.CloudSessionRecord;
import lk.resq.cloudapi.service.CloudSessionSyncService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/cloud/sessions")
public class CloudSessionQueryController {

    private final CloudSessionSyncService service;

    public CloudSessionQueryController(CloudSessionSyncService service) {
        this.service = service;
    }

    @GetMapping
    public List<CloudSessionRecord> findAll() {
        return service.findAll();
    }

    @GetMapping("/{cloudSessionId}")
    public CloudSessionRecord findByCloudSessionId(@PathVariable String cloudSessionId) {
        return service.findByCloudSessionId(cloudSessionId);
    }
}
