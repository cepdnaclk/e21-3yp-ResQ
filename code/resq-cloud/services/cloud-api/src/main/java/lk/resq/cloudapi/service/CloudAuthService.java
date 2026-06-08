package lk.resq.cloudapi.service;

import lk.resq.cloudapi.model.CloudLoginRequest;
import lk.resq.cloudapi.model.CloudLoginResponse;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CloudUserCredentials;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

@Service
public class CloudAuthService {

    private final CloudManagementRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final CloudJwtService jwtService;

    public CloudAuthService(
            CloudManagementRepository repository,
            PasswordEncoder passwordEncoder,
            CloudJwtService jwtService
    ) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @Transactional
    public CloudLoginResponse login(CloudLoginRequest request) {
        if (request == null || request.email() == null || request.email().isBlank()
                || request.password() == null) {
            throw unauthorized();
        }
        CloudUserCredentials credentials = repository
                .findUserCredentialsByEmail(request.email().trim())
                .orElseThrow(CloudAuthService::unauthorized);
        CloudUser user = credentials.user();
        if (!user.active() || credentials.passwordHash() == null
                || !passwordEncoder.matches(request.password(), credentials.passwordHash())) {
            throw unauthorized();
        }

        Instant loginAt = Instant.now();
        repository.updateLastLogin(user.userId(), loginAt);
        CloudJwtService.IssuedToken token = jwtService.issue(user);
        return new CloudLoginResponse(token.value(), "Bearer", token.expiresAt(), user);
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
    }
}
