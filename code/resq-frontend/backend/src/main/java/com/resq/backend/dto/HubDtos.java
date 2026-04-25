package com.resq.backend.dto;

import java.time.Instant;
import java.util.List;

public final class HubDtos {
  private HubDtos() {}

  public record LoginRequest(String role, String email, String password, String studentId) {}

  public record LoginResponse(boolean success, String redirectTo, String error, StudentDto student) {}

  public record StudentDto(String studentId, String email, String name) {}

  public record HubHealth(String backendHealth, String message, Integer responseTimeMs, Instant lastCheckedAt) {}

  public record LiveTelemetry(
      String manikinId,
      String manikinName,
      Instant timestamp,
      int depthMm,
      int rateCpm,
      boolean recoilOk,
      int pauses,
      int batteryLevel,
      String connectionStatus,
      List<String> flags) {}

  public record ActiveSession(
      String sessionId,
      String manikinId,
      String traineeId,
      Instant startedAt,
      Instant endedAt,
      String status) {}

  public record SessionSummary(
      String sessionId,
      String manikinId,
      String traineeId,
      Instant startedAt,
      Instant endedAt,
      int sampleCount,
      int avgDepthMm,
      int avgRateCpm,
      int recoilOkPct,
      Integer compliancePct,
      Integer handPlacementPct,
      Integer pausesDetected,
      Double longestPauseSec) {}

  public record StartSessionRequest(String manikinId, String traineeId) {}

  public record EndSessionRequest(String sessionId) {}

  public record SessionEnvelope(ActiveSession activeSession, SessionSummary summary) {}
}
