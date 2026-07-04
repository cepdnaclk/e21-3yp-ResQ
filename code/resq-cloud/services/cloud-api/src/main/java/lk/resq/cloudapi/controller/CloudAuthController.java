package lk.resq.cloudapi.controller;

import lk.resq.cloudapi.model.CloudLoginRequest;
import lk.resq.cloudapi.model.CloudLoginResponse;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.service.CloudAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cloud/auth")
public class CloudAuthController {

    private final CloudAuthService authService;

    public CloudAuthController(CloudAuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public CloudLoginResponse login(@RequestBody CloudLoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/me")
    public CloudUser me(Authentication authentication) {
        return (CloudUser) authentication.getPrincipal();
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout() {
        return ResponseEntity.noContent().build();
    }
}
