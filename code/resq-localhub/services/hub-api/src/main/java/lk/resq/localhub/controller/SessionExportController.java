package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.service.ActiveSessionService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/export/sessions")
public class SessionExportController {

    private final ActiveSessionService activeSessionService;

    public SessionExportController(ActiveSessionService activeSessionService) {
        this.activeSessionService = activeSessionService;
    }

    @GetMapping(value = "/{sessionId}.json", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> exportJson(@PathVariable String sessionId) {
        return activeSessionService.findCompletedSession(sessionId)
                .<ResponseEntity<?>>map(session -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_DISPOSITION, attachmentName(sessionId, "json"))
                        .body(session))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
    }

    @GetMapping(value = "/{sessionId}.csv", produces = "text/csv")
    public ResponseEntity<?> exportCsv(@PathVariable String sessionId) {
        return activeSessionService.findCompletedSession(sessionId)
                .<ResponseEntity<?>>map(session -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_DISPOSITION, attachmentName(sessionId, "csv"))
                        .body(toCsv(List.of(session))))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
    }

    private static String toCsv(List<SessionEndResponse> sessions) {
        StringBuilder builder = new StringBuilder();
        builder.append("sessionId,deviceId,traineeId,startedAt,endedAt,durationSeconds,avgDepthMm,avgRateCpm,recoilPct,pausesCount,score\n");

        for (SessionEndResponse session : sessions) {
            builder.append(csv(session.sessionId())).append(',')
                    .append(csv(session.deviceId())).append(',')
                    .append(csv(session.traineeId())).append(',')
                    .append(csv(session.startedAt().toString())).append(',')
                    .append(csv(session.endedAt().toString())).append(',')
                    .append(session.summary().durationSeconds()).append(',')
                    .append(session.summary().avgDepthMm()).append(',')
                    .append(session.summary().avgRateCpm()).append(',')
                    .append(session.summary().recoilPct()).append(',')
                    .append(session.summary().pausesCount()).append(',')
                    .append(session.summary().score())
                    .append('\n');
        }

        return builder.toString();
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }

        String escaped = value.replace("\"", "\"\"");
        return '"' + escaped + '"';
    }

    private static String attachmentName(String sessionId, String extension) {
        return "attachment; filename=\"session-" + sessionId + "." + extension + "\"";
    }
}