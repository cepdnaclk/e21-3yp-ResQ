package lk.resq.localhub.controller;

import lk.resq.localhub.model.ApiErrorResponse;
import lk.resq.localhub.model.SessionEndRequest;
import lk.resq.localhub.model.SessionEndResponse;
import lk.resq.localhub.model.SessionStartRequest;
import lk.resq.localhub.model.SessionStartResponse;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.MqttCommandPublishException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final ActiveSessionService activeSessionService;

    public SessionController(ActiveSessionService activeSessionService) {
        this.activeSessionService = activeSessionService;
    }

    @PostMapping("/start")
    public ResponseEntity<?> startSession(@RequestBody SessionStartRequest request) {
        try {
            SessionStartResponse response = activeSessionService.startSession(request);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (IllegalStateException error) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @PostMapping("/end")
    public ResponseEntity<?> endSession(@RequestBody SessionEndRequest request) {
        try {
            SessionEndResponse response = activeSessionService.endSession(request);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(new ApiErrorResponse(error.getMessage()));
        } catch (NoSuchElementException error) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiErrorResponse(error.getMessage()));
        } catch (MqttCommandPublishException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(new ApiErrorResponse(error.getMessage()));
        }
    }

    @GetMapping
    public List<SessionEndResponse> listSessions() {
        return activeSessionService.listCompletedSessions();
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<?> getSession(@PathVariable String sessionId) {
        return activeSessionService.findCompletedSession(sessionId)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(new ApiErrorResponse("Session " + sessionId + " was not found")));
    }

    @GetMapping("/live/{sessionId}")
    public ResponseEntity<?> getSessionLiveView(@PathVariable String sessionId) {
        return activeSessionService.getSessionLiveView(sessionId)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(new ApiErrorResponse("Session " + sessionId + " was not found or is not active")));
    }
}
