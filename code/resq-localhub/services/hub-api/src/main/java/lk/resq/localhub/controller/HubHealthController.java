package lk.resq.localhub.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import lk.resq.localhub.model.HubServiceInfoResponse;
import lk.resq.localhub.service.HubServiceInfoService;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/hub")
public class HubHealthController {

    private final HubServiceInfoService hubServiceInfoService;

    public HubHealthController(HubServiceInfoService hubServiceInfoService) {
        this.hubServiceInfoService = hubServiceInfoService;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "ok", true,
                "service", "hub-api",
                "timestamp", Instant.now().toString()
        );
    }

    @GetMapping("/service-info")
    public HubServiceInfoResponse serviceInfo() {
        return hubServiceInfoService.serviceInfo();
    }
}
