package lk.resq.localhub.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import lk.resq.localhub.service.CprSampleDataSeeder;

// This seed data is only for testing without real hardware and must not be used in production.
@RestController
@RequestMapping("/api/sessions/seed")
@Profile({"dev", "test"})
public class CprDevSeedController {

    private final CprSampleDataSeeder sampleDataSeeder;

    @Autowired
    public CprDevSeedController(CprSampleDataSeeder sampleDataSeeder) {
        this.sampleDataSeeder = sampleDataSeeder;
    }

    @PostMapping
    public ResponseEntity<List<String>> seed() {
        // This seed data is only for testing without real hardware and must not be used in production.
        List<String> seededIds = sampleDataSeeder.seed();
        return ResponseEntity.ok(seededIds);
    }
}
