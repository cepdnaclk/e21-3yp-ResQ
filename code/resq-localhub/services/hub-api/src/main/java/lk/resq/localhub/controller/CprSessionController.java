package lk.resq.localhub.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryRequest;
import lk.resq.localhub.service.CprSessionService;

@RestController
@RequestMapping("/api/cpr-sessions")
public class CprSessionController {

    private final CprSessionService cprSessionService;

    public CprSessionController(CprSessionService cprSessionService) {
        this.cprSessionService = cprSessionService;
    }

    @PostMapping
    public ResponseEntity<?> saveSession(@RequestBody CprSessionSummaryRequest request) {
        try {
            return ResponseEntity.status(HttpStatus.CREATED).body(cprSessionService.save(request));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listSessions(
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String traineeId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String manikinId
    ) {
        try {
            return ResponseEntity.ok(cprSessionService.list(new CprSessionSummaryQueryRequest(userId, traineeId, from, to, manikinId)));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getSession(@PathVariable String id) {
        try {
            return cprSessionService.findById(id)
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(new ApiErrorResponse("CPR session " + id + " was not found")));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        }
    }
}