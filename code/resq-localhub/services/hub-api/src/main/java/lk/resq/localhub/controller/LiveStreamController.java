package lk.resq.localhub.controller;

import lk.resq.localhub.model.SessionLiveView;
import lk.resq.localhub.service.ActiveSessionService;
import lk.resq.localhub.service.LiveStreamService;
import lk.resq.localhub.service.ManikinRegistryService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/stream")
public class LiveStreamController {

    private final LiveStreamService liveStreamService;
    private final ManikinRegistryService manikinRegistryService;
    private final ActiveSessionService activeSessionService;

    public LiveStreamController(
            LiveStreamService liveStreamService,
            ManikinRegistryService manikinRegistryService,
            ActiveSessionService activeSessionService
    ) {
        this.liveStreamService = liveStreamService;
        this.manikinRegistryService = manikinRegistryService;
        this.activeSessionService = activeSessionService;
    }

    @GetMapping(path = "/manikins/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamManikinsLive() {
        return liveStreamService.subscribeInstructor(
                manikinRegistryService.getLiveSummaries().stream()
                        .map(activeSessionService::decorateLiveSummary)
                        .toList()
        );
    }

    @GetMapping(path = "/sessions/live/{sessionId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamSessionLive(@PathVariable String sessionId) {
        SessionLiveView initialPayload = activeSessionService.getSessionLiveView(sessionId).orElse(null);
        return liveStreamService.subscribeSession(sessionId, initialPayload);
    }
}
