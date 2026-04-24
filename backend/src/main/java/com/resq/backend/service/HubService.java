package com.resq.backend.service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.resq.backend.dto.HubDtos;

@Service
public class HubService {
  private final JdbcTemplate jdbcTemplate;

  public HubService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public HubDtos.LoginResponse login(HubDtos.LoginRequest request) {
    String role = "instructor".equalsIgnoreCase(nullSafe(request.role())) ? "instructor" : "student";
    String email = trim(request.email());
    String password = trim(request.password());
    String studentId = trim(request.studentId());

    if (email.isBlank() || password.isBlank()) {
      return new HubDtos.LoginResponse(false, null, "Please enter both email and password", null);
    }

    if (!email.contains("@")) {
      return new HubDtos.LoginResponse(false, null, "Please enter a valid email address", null);
    }

    if (password.length() < 6) {
      return new HubDtos.LoginResponse(false, null, "Password must be at least 6 characters", null);
    }

    if ("instructor".equals(role)) {
      return new HubDtos.LoginResponse(true, "/dashboard/instructor", null, null);
    }

    if (studentId.isBlank()) {
      return new HubDtos.LoginResponse(false, null, "Please enter your student ID", null);
    }

    HubDtos.StudentDto student = jdbcTemplate.query(
        "SELECT student_id, email, full_name FROM authorized_students WHERE LOWER(email) = LOWER(?) AND UPPER(TRIM(student_id)) = UPPER(TRIM(?)) AND is_active = 1 LIMIT 1",
        rs -> rs.next() ? new HubDtos.StudentDto(rs.getString("student_id"), rs.getString("email"), rs.getString("full_name")) : null,
        email,
        studentId
    );

    if (student == null) {
      return new HubDtos.LoginResponse(false, null, "Access denied. This email and student ID are not authorized.", null);
    }

    return new HubDtos.LoginResponse(true, "/student/dashboard", null, student);
  }

  public HubDtos.HubHealth health() {
    Integer[] counts = jdbcTemplate.query(
        "SELECT COUNT(*) AS active_manikins, SUM(CASE WHEN connection_status = 'online' THEN 1 ELSE 0 END) AS online_manikins FROM manikins WHERE is_active = 1",
        rs -> {
          if (!rs.next()) {
            return new Integer[] {0, 0};
          }
          return new Integer[] {rs.getInt("active_manikins"), rs.getInt("online_manikins")};
        }
    );

    Timestamp lastSampleAt = jdbcTemplate.query(
        "SELECT MAX(recorded_at) AS last_sample_at FROM manikin_telemetry_samples",
        rs -> rs.next() ? rs.getTimestamp("last_sample_at") : null
    );

    if (lastSampleAt == null) {
      return new HubDtos.HubHealth("offline", "Database is connected, but no telemetry samples are available yet.", 0, Instant.now());
    }

    int online = 0;
    int active = 0;
    if (counts != null) {
      if (counts.length > 1 && counts[1] != null) {
        online = counts[1];
      }
      if (counts.length > 0 && counts[0] != null) {
        active = counts[0];
      }
    }
    return new HubDtos.HubHealth(
        online > 0 ? "online" : "offline",
        online + "/" + active + " manikins reporting telemetry from PostgreSQL/SQLite.",
        0,
        Instant.now()
    );
  }

  public List<HubDtos.LiveTelemetry> liveTelemetry() {
    HubDtos.ActiveSession activeSession = activeSession();

    return jdbcTemplate.query(
        "SELECT m.manikin_id, m.manikin_name, COALESCE(s.recorded_at, CURRENT_TIMESTAMP) AS timestamp, COALESCE(s.depth_mm, 0) AS depth_mm, COALESCE(s.rate_cpm, 0) AS rate_cpm, COALESCE(s.recoil_ok, 0) AS recoil_ok, COALESCE(s.pauses, 0) AS pauses, COALESCE(s.battery_level, m.battery_level, 0) AS battery_level, COALESCE(s.connection_status, m.connection_status, 'offline') AS connection_status, COALESCE(s.flags, '') AS flags FROM manikins m LEFT JOIN manikin_telemetry_samples s ON s.id = (SELECT id FROM manikin_telemetry_samples WHERE manikin_id = m.manikin_id ORDER BY recorded_at DESC LIMIT 1) WHERE m.is_active = 1 ORDER BY m.manikin_id",
        (rs, rowNum) -> mapTelemetry(rs, activeSession)
    );
  }

  public HubDtos.ActiveSession activeSession() {
    return jdbcTemplate.query(
        "SELECT session_id, manikin_id, trainee_id, started_at, ended_at, status FROM training_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1",
        rs -> rs.next() ? mapActiveSession(rs) : null
    );
  }

  public HubDtos.ActiveSession startSession(HubDtos.StartSessionRequest request) {
    String manikinId = trim(request.manikinId());
    String traineeId = trim(request.traineeId());

    if (manikinId.isBlank()) {
      throw new IllegalArgumentException("A manikin must be selected before starting a session.");
    }

    Integer exists = jdbcTemplate.query(
        "SELECT COUNT(*) AS count FROM manikins WHERE manikin_id = ? AND is_active = 1",
        rs -> rs.next() ? rs.getInt("count") : 0,
        manikinId
    );
    if (exists == null || exists == 0) {
      throw new IllegalArgumentException("Selected manikin was not found in the backend database.");
    }

    HubDtos.ActiveSession current = activeSession();
    if (current != null) {
      return current;
    }

    String sessionId = UUID.randomUUID().toString();
    jdbcTemplate.update(
        "INSERT INTO training_sessions (session_id, manikin_id, trainee_id, started_at, status) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'active')",
        sessionId,
        manikinId,
        traineeId.isBlank() ? "trainee-local" : traineeId
    );

    return activeSession();
  }

  public HubDtos.SessionEnvelope endSession(HubDtos.EndSessionRequest request) {
    HubDtos.ActiveSession active = activeSession();
    if (active == null) {
      return null;
    }

    if (request != null && request.sessionId() != null && !request.sessionId().isBlank() && !request.sessionId().equals(active.sessionId())) {
      return null;
    }

    jdbcTemplate.update("UPDATE training_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE session_id = ?", active.sessionId());
    HubDtos.ActiveSession ended = activeSessionById(active.sessionId());
    if (ended == null) {
      ended = new HubDtos.ActiveSession(active.sessionId(), active.manikinId(), active.traineeId(), active.startedAt(), Instant.now(), "ended");
    }

    HubDtos.SessionSummary summary = buildSummary(ended);
    upsertSummary(summary);
    return new HubDtos.SessionEnvelope(ended, summary);
  }

  public HubDtos.SessionSummary lastSummary() {
    List<HubDtos.SessionSummary> summaries = jdbcTemplate.query(
        "SELECT session_id, manikin_id, trainee_id, started_at, ended_at, sample_count, avg_depth_mm, avg_rate_cpm, recoil_ok_pct, compliance_pct, hand_placement_pct, pauses_detected, longest_pause_sec FROM session_summaries ORDER BY ended_at DESC LIMIT 1",
        (rs, rowNum) -> new HubDtos.SessionSummary(
            rs.getString("session_id"),
            rs.getString("manikin_id"),
            rs.getString("trainee_id"),
            toInstant(rs, "started_at"),
            toInstant(rs, "ended_at"),
            rs.getInt("sample_count"),
            rs.getInt("avg_depth_mm"),
            rs.getInt("avg_rate_cpm"),
            rs.getInt("recoil_ok_pct"),
            getInteger(rs, "compliance_pct"),
            getInteger(rs, "hand_placement_pct"),
            getInteger(rs, "pauses_detected"),
            getDouble(rs, "longest_pause_sec")
        )
    );

    return summaries.isEmpty() ? null : summaries.get(0);
  }

  private HubDtos.SessionSummary buildSummary(HubDtos.ActiveSession session) {
    List<SampleRow> samples = jdbcTemplate.query(
        "SELECT depth_mm, rate_cpm, recoil_ok, pauses FROM manikin_telemetry_samples WHERE manikin_id = ? AND recorded_at >= ? AND recorded_at <= ?",
        (rs, rowNum) -> new SampleRow(rs.getInt("depth_mm"), rs.getInt("rate_cpm"), rs.getBoolean("recoil_ok"), rs.getInt("pauses")),
        session.manikinId(),
        Timestamp.from(session.startedAt()),
        session.endedAt() == null ? Timestamp.from(Instant.now()) : Timestamp.from(session.endedAt())
    );

    if (samples.isEmpty()) {
      samples = jdbcTemplate.query(
          "SELECT depth_mm, rate_cpm, recoil_ok, pauses FROM manikin_telemetry_samples WHERE manikin_id = ? ORDER BY recorded_at DESC LIMIT 1",
          (rs, rowNum) -> new SampleRow(rs.getInt("depth_mm"), rs.getInt("rate_cpm"), rs.getBoolean("recoil_ok"), rs.getInt("pauses")),
          session.manikinId()
      );
    }

    SampleRow row = samples.isEmpty() ? new SampleRow(0, 0, false, 0) : samples.get(0);
    int sampleCount = samples.isEmpty() ? 0 : samples.size();
    int recoilOkPct = row.recoilOk ? 100 : 0;
    int compliancePct = row.recoilOk && row.depthMm >= 50 && row.depthMm <= 60 && row.rateCpm >= 100 && row.rateCpm <= 120 ? 100 : 0;
    int pausesDetected = row.pauses;
    double longestPauseSec = NumberUtil.roundOneDecimal(pausesDetected * 0.9 + 1);

    return new HubDtos.SessionSummary(
        session.sessionId(),
        session.manikinId(),
        session.traineeId(),
        session.startedAt(),
        session.endedAt() == null ? Instant.now() : session.endedAt(),
        sampleCount,
        row.depthMm,
        row.rateCpm,
        recoilOkPct,
        compliancePct,
        null,
        pausesDetected,
        longestPauseSec
    );
  }

  private void upsertSummary(HubDtos.SessionSummary summary) {
    jdbcTemplate.update(
        "INSERT INTO session_summaries (session_id, manikin_id, trainee_id, started_at, ended_at, sample_count, avg_depth_mm, avg_rate_cpm, recoil_ok_pct, compliance_pct, hand_placement_pct, pauses_detected, longest_pause_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET ended_at = excluded.ended_at, sample_count = excluded.sample_count, avg_depth_mm = excluded.avg_depth_mm, avg_rate_cpm = excluded.avg_rate_cpm, recoil_ok_pct = excluded.recoil_ok_pct, compliance_pct = excluded.compliance_pct, hand_placement_pct = excluded.hand_placement_pct, pauses_detected = excluded.pauses_detected, longest_pause_sec = excluded.longest_pause_sec",
        summary.sessionId(),
        summary.manikinId(),
        summary.traineeId(),
        Timestamp.from(summary.startedAt()),
        Timestamp.from(summary.endedAt()),
        summary.sampleCount(),
        summary.avgDepthMm(),
        summary.avgRateCpm(),
        summary.recoilOkPct(),
        summary.compliancePct(),
        summary.handPlacementPct(),
        summary.pausesDetected(),
        summary.longestPauseSec()
    );
  }

  private HubDtos.ActiveSession activeSessionById(String sessionId) {
    return jdbcTemplate.query(
        "SELECT session_id, manikin_id, trainee_id, started_at, ended_at, status FROM training_sessions WHERE session_id = ? LIMIT 1",
        rs -> rs.next() ? mapActiveSession(rs) : null,
        sessionId
    );
  }

  private HubDtos.ActiveSession mapActiveSession(ResultSet rs) throws SQLException {
    return new HubDtos.ActiveSession(
        rs.getString("session_id"),
        rs.getString("manikin_id"),
        rs.getString("trainee_id"),
        toInstant(rs, "started_at"),
        rs.getTimestamp("ended_at") == null ? null : rs.getTimestamp("ended_at").toInstant(),
        rs.getString("status")
    );
  }

  private HubDtos.LiveTelemetry mapTelemetry(ResultSet rs, HubDtos.ActiveSession activeSession) throws SQLException {
    List<String> flags = parseFlags(rs.getString("flags"));
    if (activeSession != null && activeSession.manikinId().equals(rs.getString("manikin_id"))) {
      flags.add(0, "Active session");
    }

    return new HubDtos.LiveTelemetry(
        rs.getString("manikin_id"),
        rs.getString("manikin_name"),
        toInstant(rs, "timestamp"),
        rs.getInt("depth_mm"),
        rs.getInt("rate_cpm"),
        rs.getBoolean("recoil_ok"),
        rs.getInt("pauses"),
        rs.getInt("battery_level"),
        rs.getString("connection_status"),
        flags
    );
  }

  private List<String> parseFlags(String rawFlags) {
    if (rawFlags == null || rawFlags.isBlank()) {
      return new ArrayList<>();
    }
    return Arrays.stream(rawFlags.split(","))
        .map(String::trim)
        .filter(flag -> !flag.isBlank())
        .collect(Collectors.toCollection(ArrayList::new));
  }

  private String trim(String value) {
    return value == null ? "" : value.trim();
  }

  private String nullSafe(String value) {
    return value == null ? "" : value;
  }

  private Instant toInstant(ResultSet rs, String column) throws SQLException {
    Timestamp timestamp = rs.getTimestamp(column);
    return timestamp == null ? Instant.now() : timestamp.toInstant();
  }

  private Integer getInteger(ResultSet rs, String column) throws SQLException {
    int value = rs.getInt(column);
    return rs.wasNull() ? null : value;
  }

  private Double getDouble(ResultSet rs, String column) throws SQLException {
    double value = rs.getDouble(column);
    return rs.wasNull() ? null : value;
  }

  private record SampleRow(int depthMm, int rateCpm, boolean recoilOk, int pauses) {}

  private static final class NumberUtil {
    private static double roundOneDecimal(double value) {
      return Math.round(value * 10.0) / 10.0;
    }
  }
}
