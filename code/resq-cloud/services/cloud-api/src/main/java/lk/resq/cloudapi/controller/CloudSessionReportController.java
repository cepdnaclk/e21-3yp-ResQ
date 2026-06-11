package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.model.CloudSessionRecord;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CloudUserRole;
import lk.resq.cloudapi.service.CloudSessionReportService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/cloud")
public class CloudSessionReportController {

    private final CloudSessionReportService reportService;

    public CloudSessionReportController(CloudSessionReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping("/session-summaries")
    public List<CloudSessionRecord> search(
            Authentication authentication,
            @RequestParam(required = false) String courseId,
            @RequestParam(required = false) String traineeId,
            @RequestParam(required = false) String instructorId,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        CloudUser actor = (CloudUser) authentication.getPrincipal();
        return reportService.searchSessionSummaries(
                actor, courseId, traineeId, instructorId,
                parseInstant(dateFrom), parseInstant(dateTo), limit, offset
        );
    }

    @GetMapping("/session-summaries/{cloudSessionId}")
    public CloudSessionRecord getById(
            Authentication authentication,
            @PathVariable String cloudSessionId
    ) {
        CloudUser actor = (CloudUser) authentication.getPrincipal();
        return reportService.findByCloudSessionId(actor, cloudSessionId);
    }

    @GetMapping("/courses/{courseId}/session-summaries")
    public List<CloudSessionRecord> getByCourse(
            Authentication authentication,
            @PathVariable String courseId,
            @RequestParam(required = false) String traineeId,
            @RequestParam(required = false) String instructorId,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        CloudUser actor = (CloudUser) authentication.getPrincipal();
        return reportService.searchSessionSummaries(
                actor, courseId, traineeId, instructorId,
                parseInstant(dateFrom), parseInstant(dateTo), limit, offset
        );
    }

    @GetMapping("/users/{userId}/session-summaries")
    public List<CloudSessionRecord> getByUser(
            Authentication authentication,
            @PathVariable String userId,
            @RequestParam(required = false) String courseId,
            @RequestParam(required = false) String dateFrom,
            @RequestParam(required = false) String dateTo,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        CloudUser actor = (CloudUser) authentication.getPrincipal();
        if (actor.role() == CloudUserRole.TRAINEE && !actor.userId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access denied");
        }
        return reportService.searchSessionSummaries(
                actor, courseId, userId, null,
                parseInstant(dateFrom), parseInstant(dateTo), limit, offset
        );
    }

    private Instant parseInstant(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(dateStr);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid date format: " + dateStr);
        }
    }
}
