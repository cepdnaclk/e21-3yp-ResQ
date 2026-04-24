package com.resq.backend.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.resq.backend.dto.HubDtos;
import com.resq.backend.service.HubService;

@RestController
@RequestMapping("/api")
public class HubController {
  private final HubService hubService;

  public HubController(HubService hubService) {
    this.hubService = hubService;
  }

  @GetMapping("/hub/health")
  public ResponseEntity<HubDtos.HubHealth> health() {
    return ResponseEntity.ok(hubService.health());
  }

  @GetMapping("/mock/live")
  public ResponseEntity<List<HubDtos.LiveTelemetry>> liveTelemetry() {
    return ResponseEntity.ok(hubService.liveTelemetry());
  }

  @GetMapping("/mock/session/active")
  public ResponseEntity<Map<String, Object>> activeSession() {
    Map<String, Object> body = new HashMap<>();
    body.put("activeSession", hubService.activeSession());
    return ResponseEntity.ok(body);
  }

  @PostMapping("/mock/session/start")
  public ResponseEntity<Map<String, Object>> startSession(@RequestBody HubDtos.StartSessionRequest request) {
    try {
      HubDtos.ActiveSession activeSession = hubService.startSession(request);
      Map<String, Object> body = new HashMap<>();
      body.put("activeSession", activeSession);
      return ResponseEntity.ok(body);
    } catch (IllegalArgumentException error) {
      Map<String, Object> body = new HashMap<>();
      body.put("error", error.getMessage());
      return ResponseEntity.badRequest().body(body);
    }
  }

  @PostMapping("/mock/session/end")
  public ResponseEntity<?> endSession(@RequestBody(required = false) HubDtos.EndSessionRequest request) {
    HubDtos.SessionEnvelope result = hubService.endSession(request);
    if (result == null) {
      return ResponseEntity.status(404).body(Map.of("error", "No active session matches the request."));
    }
    return ResponseEntity.ok(result);
  }

  @GetMapping("/mock/session/last-summary")
  public ResponseEntity<?> lastSummary() {
    return ResponseEntity.ok(hubService.lastSummary());
  }
}
