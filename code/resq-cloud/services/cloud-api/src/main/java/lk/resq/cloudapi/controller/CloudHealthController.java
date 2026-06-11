package lk.resq.cloudapi.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/cloud")
public class CloudHealthController {

    @Value("${resq.api.version:local-dev}")
    private String apiVersion;

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "UP");
        response.put("service", "resq-cloud-api");
        response.put("version", apiVersion);
        response.put("storageMode", "POSTGRESQL");
        response.put("timestamp", Instant.now());
        return response;
    }
}

