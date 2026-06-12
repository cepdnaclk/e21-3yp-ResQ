package lk.resq.localhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lk.resq.localhub.model.AuthBootstrapResponse;
import lk.resq.localhub.model.AuthStatusResponse;
import lk.resq.localhub.model.AuthTokenIssue;
import lk.resq.localhub.model.AuthUser;
import lk.resq.localhub.model.CreateFirstAdminRequest;
import lk.resq.localhub.model.CreateUserRequest;
import lk.resq.localhub.model.LoginRequest;

import lk.resq.localhub.model.UserRole;
import org.springframework.beans.factory.annotation.Autowired;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String COOKIE_NAME = "RESQ_LOCALHUB_AUTH";

    private final LocalAuthRepository authRepository;
    private final RosterCacheRepository rosterCacheRepository;
    private final ObjectMapper objectMapper;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final ChronoUnit sessionTtlUnit = ChronoUnit.HOURS;
    private final long sessionTtlHours;

    @Autowired
    public AuthService(
            LocalAuthRepository authRepository,
            RosterCacheRepository rosterCacheRepository,
            ObjectMapper objectMapper,
            @Value("${resq.auth.session-ttl-hours:8}") long sessionTtlHours
    ) {
        this.authRepository = authRepository;
        this.rosterCacheRepository = rosterCacheRepository;
        this.objectMapper = objectMapper;
        this.sessionTtlHours = Math.max(1L, sessionTtlHours);
    }

    public AuthService(
            LocalAuthRepository authRepository,
            ObjectMapper objectMapper,
            long sessionTtlHours
    ) {
        this.authRepository = authRepository;
        this.rosterCacheRepository = null;
        this.objectMapper = objectMapper;
        this.sessionTtlHours = Math.max(1L, sessionTtlHours);
    }


    public AuthBootstrapResponse bootstrap() {
        return new AuthBootstrapResponse(!authRepository.hasUsers());
    }

    public AuthStatusResponse status() {
        boolean hasUsers = authRepository.hasUsers();
        return new AuthStatusResponse(hasUsers, !hasUsers);
    }

    public AuthTokenIssue login(LoginRequest request) {
        String username = normalizeUsername(request.username());
        String password = request.password();

        if (!StringUtils.hasText(username) || !StringUtils.hasText(password)) {
            audit(null, "LOGIN_FAILURE", "user", username, Map.of("reason", "missing_credentials"));
            throw new IllegalArgumentException("Username and password are required.");
        }

        // 1. Try local lookup first
        Optional<LocalAuthRepository.UserRecord> localUserOpt = authRepository.findUserByUsername(username);
        if (localUserOpt.isPresent()) {
            LocalAuthRepository.UserRecord user = localUserOpt.get();
            if (user.disabledAt() != null) {
                audit(null, "LOGIN_FAILURE", "user", user.id(), Map.of("reason", "disabled_account"));
                throw new UnauthorizedException("Your account has been disabled.");
            }

            if (!passwordEncoder.matches(password, user.passwordHash())) {
                audit(null, "LOGIN_FAILURE", "user", user.id(), Map.of("reason", "bad_password"));
                throw new UnauthorizedException("Invalid username or password.");
            }

            AuthTokenIssue issue = issueSession(user);
            audit(user.id(), "LOGIN_SUCCESS", "user", user.id(), Map.of("role", user.role().name()));
            return issue;
        }

        // 2. Try cloud-synced user lookup when the roster cache is available.
        Optional<RosterCacheRepository.SyncedUserRecord> cloudUserOpt = rosterCacheRepository == null
                ? Optional.empty()
                : rosterCacheRepository.findSyncedUserByEmail(username);
        if (cloudUserOpt.isPresent()) {
            RosterCacheRepository.SyncedUserRecord cloudUser = cloudUserOpt.get();
            if (!cloudUser.active()) {
                audit(null, "LOGIN_FAILURE", "user", cloudUser.cloudUserId(), Map.of("reason", "disabled_account"));
                throw new UnauthorizedException("Your account has been disabled.");
            }

            if (cloudUser.localLoginHash() == null || cloudUser.localLoginHash().isBlank()) {
                audit(null, "LOGIN_FAILURE", "user", cloudUser.cloudUserId(), Map.of("reason", "no_local_login_hash"));
                throw new UnauthorizedException("Invalid username or password.");
            }

            if (!passwordEncoder.matches(password, cloudUser.localLoginHash())) {
                audit(null, "LOGIN_FAILURE", "user", cloudUser.cloudUserId(), Map.of("reason", "bad_password"));
                throw new UnauthorizedException("Invalid username or password.");
            }

            // Successfully authenticated cloud-synced user!
            // Upsert a local shadow user to satisfy foreign key constraints.
            Instant now = Instant.now();
            UserRole role;
            try {
                role = UserRole.valueOf(cloudUser.role());
            } catch (Exception e) {
                role = UserRole.TRAINEE;
            }

            LocalAuthRepository.UserRecord shadowUser = authRepository.upsertShadowUser(
                    cloudUser.cloudUserId(),
                    cloudUser.email() != null ? cloudUser.email() : cloudUser.displayName(),
                    cloudUser.displayName(),
                    cloudUser.localLoginHash(),
                    role,
                    now
            );

            AuthTokenIssue issue = issueSession(shadowUser);
            audit(shadowUser.id(), "LOGIN_SUCCESS", "user", shadowUser.id(), Map.of("role", shadowUser.role().name(), "auth_source", "CLOUD"));
            return issue;
        }

        audit(null, "LOGIN_FAILURE", "user", username, Map.of("reason", "unknown_user"));
        throw new UnauthorizedException("Invalid username or password.");
    }

    public AuthTokenIssue setupFirstAdmin(CreateFirstAdminRequest request) {
        if (authRepository.hasUsers()) {
            throw new ForbiddenException("First-run setup is no longer available.");
        }

        String username = normalizeUsername(request.username());
        String displayName = normalizeDisplayName(request.displayName());
        String password = request.password();

        validateNewUser(username, displayName, password);

        LocalAuthRepository.UserRecord user = authRepository.createUser(
                UUID.randomUUID().toString(),
                username,
                displayName,
                passwordEncoder.encode(password),
                UserRole.ADMIN,
                Instant.now()
        );
        audit(user.id(), "CREATE_USER", "user", user.id(), Map.of("role", user.role().name(), "bootstrap", true));

        AuthTokenIssue issue = issueSession(user);
        audit(user.id(), "LOGIN_SUCCESS", "user", user.id(), Map.of("role", user.role().name(), "bootstrap", true));
        return issue;
    }

    public List<AuthUser> listUsers(HttpServletRequest request) {
        requireRole(request, UserRole.ADMIN);
        return authRepository.listUsers().stream().map(this::toAuthUser).toList();
    }

    public AuthUser createUser(HttpServletRequest request, CreateUserRequest createUserRequest) {
        AuthUser actor = requireRole(request, UserRole.ADMIN);
        String username = normalizeUsername(createUserRequest.username());
        String displayName = normalizeDisplayName(createUserRequest.displayName());
        String password = createUserRequest.password();
        UserRole role = createUserRequest.role();

        validateNewUser(username, displayName, password);
        if (role == null) {
            throw new IllegalArgumentException("Role is required.");
        }

        authRepository.findUserByUsername(username).ifPresent(existing -> {
            throw new IllegalStateException("User " + username + " already exists.");
        });

        LocalAuthRepository.UserRecord created = authRepository.createUser(
                UUID.randomUUID().toString(),
                username,
                displayName,
                passwordEncoder.encode(password),
                role,
                Instant.now()
        );
        audit(actor.id(), "CREATE_USER", "user", created.id(), Map.of("role", created.role().name()));
        return toAuthUser(created);
    }

    public AuthUser disableUser(HttpServletRequest request, String userId) {
        AuthUser actor = requireRole(request, UserRole.ADMIN);
        LocalAuthRepository.UserRecord disabled = authRepository.disableUser(userId, Instant.now())
                .orElseThrow(() -> new IllegalArgumentException("User " + userId + " was not found."));
        audit(actor.id(), "DISABLE_USER", "user", disabled.id(), Map.of("role", disabled.role().name()));
        return toAuthUser(disabled);
    }

    public AuthUser enableUser(HttpServletRequest request, String userId) {
        AuthUser actor = requireRole(request, UserRole.ADMIN);
        LocalAuthRepository.UserRecord enabled = authRepository.enableUser(userId, Instant.now())
                .orElseThrow(() -> new IllegalArgumentException("User " + userId + " was not found."));
        audit(actor.id(), "ENABLE_USER", "user", enabled.id(), Map.of("role", enabled.role().name()));
        return toAuthUser(enabled);
    }

    public AuthUser requireAuth(HttpServletRequest request) {
        String token = extractToken(request);
        if (!StringUtils.hasText(token)) {
            throw new UnauthorizedException("Authentication is required.");
        }

        LocalAuthRepository.AuthSessionRecord session = authRepository.findSessionByTokenHash(hashToken(token))
                .orElseThrow(() -> new UnauthorizedException("Authentication is required."));

        Instant now = Instant.now();
        if (session.revokedAt() != null || session.expiresAt().isBefore(now)) {
            throw new UnauthorizedException("Authentication session expired.");
        }

        LocalAuthRepository.UserRecord user = authRepository.findUserById(session.userId())
                .orElseThrow(() -> new UnauthorizedException("Authentication is required."));

        if (user.disabledAt() != null) {
            throw new UnauthorizedException("Your account has been disabled.");
        }

        return toAuthUser(user);
    }

    public AuthUser requireRole(HttpServletRequest request, UserRole... allowedRoles) {
        AuthUser user = requireAuth(request);
        if (user.role() == UserRole.ADMIN) {
            return user;
        }

        boolean allowed = Arrays.stream(allowedRoles).anyMatch(role -> role == user.role());
        if (!allowed) {
            throw new ForbiddenException("You do not have access to this resource.");
        }

        return user;
    }

    public Optional<AuthUser> maybeAuth(HttpServletRequest request) {
        try {
            return Optional.of(requireAuth(request));
        } catch (UnauthorizedException error) {
            return Optional.empty();
        }
    }

    public void logout(HttpServletRequest request) {
        String token = extractToken(request);
        if (!StringUtils.hasText(token)) {
            return;
        }

        try {
            authRepository.revokeSessionByTokenHash(hashToken(token), Instant.now());
            maybeAuth(request).ifPresent(user -> audit(user.id(), "LOGOUT", "user", user.id(), Map.of()));
        } catch (RuntimeException error) {
            logger.warn("Failed to revoke auth session during logout", error);
        }
    }

    public String cookieName() {
        return COOKIE_NAME;
    }


    private AuthTokenIssue issueSession(LocalAuthRepository.UserRecord user) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(sessionTtlHours, sessionTtlUnit);
        String token = generateToken();
        authRepository.createAuthSession(
                UUID.randomUUID().toString(),
                user.id(),
                hashToken(token),
                now,
                expiresAt
        );
        return new AuthTokenIssue(toAuthUser(user), token, expiresAt);
    }

    private void validateNewUser(String username, String displayName, String password) {
        if (!StringUtils.hasText(username)) {
            throw new IllegalArgumentException("Username is required.");
        }
        if (!StringUtils.hasText(displayName)) {
            throw new IllegalArgumentException("Display name is required.");
        }
        if (!StringUtils.hasText(password) || password.length() < 8) {
            throw new IllegalArgumentException("Password must be at least 8 characters long.");
        }
    }

    private AuthUser toAuthUser(LocalAuthRepository.UserRecord record) {
        return new AuthUser(
                record.id(),
                record.username(),
                record.displayName(),
                record.role(),
                record.disabledAt() == null ? null : record.disabledAt().toString()
        );
    }

    private AuthUser toAuthUser(RosterCacheRepository.SyncedUserRecord record) {
        return new AuthUser(
                record.cloudUserId(),
                record.email() != null ? record.email() : record.displayName(),
                record.displayName(),
                UserRole.valueOf(record.role()),
                record.active() ? null : Instant.now().toString()
        );
    }

    public AuthUser setCloudUserPassword(HttpServletRequest request, String cloudUserId, String newPassword) {
        AuthUser actor = requireRole(request, UserRole.ADMIN);
        if (!StringUtils.hasText(newPassword) || newPassword.length() < 8) {
            throw new IllegalArgumentException("Password must be at least 8 characters long.");
        }

        RosterCacheRepository.SyncedUserRecord cloudUser = rosterCacheRepository.findSyncedUserById(cloudUserId)
                .orElseThrow(() -> new IllegalArgumentException("Synced cloud user " + cloudUserId + " was not found."));

        String hashed = passwordEncoder.encode(newPassword);
        rosterCacheRepository.updateLocalLoginHash(cloudUserId, hashed);

        if (authRepository.findUserById(cloudUserId).isPresent()) {
            UserRole role;
            try {
                role = UserRole.valueOf(cloudUser.role());
            } catch (Exception e) {
                role = UserRole.TRAINEE;
            }
            authRepository.upsertShadowUser(
                    cloudUser.cloudUserId(),
                    cloudUser.email() != null ? cloudUser.email() : cloudUser.displayName(),
                    cloudUser.displayName(),
                    hashed,
                    role,
                    Instant.now()
            );
        }

        audit(actor.id(), "RESET_CLOUD_USER_PASSWORD", "user", cloudUserId, Map.of());
        return toAuthUser(cloudUser);
    }

    public List<AuthUser> listCloudUsers(HttpServletRequest request) {
        requireRole(request, UserRole.ADMIN);
        return rosterCacheRepository.listSyncedUsers().stream()
                .map(this::toAuthUser)
                .toList();
    }

    private String normalizeUsername(String value) {
        return value == null ? null : value.trim().toLowerCase();
    }

    private String normalizeDisplayName(String value) {
        return value == null ? null : value.trim();
    }

    private String extractToken(HttpServletRequest request) {
        if (request == null) {
            return null;
        }

        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (COOKIE_NAME.equals(cookie.getName())) {
                    return cookie.getValue();
                }
            }
        }

        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (StringUtils.hasText(authorization) && authorization.startsWith("Bearer ")) {
            return authorization.substring("Bearer ".length()).trim();
        }

        return null;
    }

    private String generateToken() {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }

    private String hashToken(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte value : hashed) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("Unable to hash auth token", error);
        }
    }

    public void audit(String actorUserId, String action, String targetType, String targetId, Map<String, Object> metadata) {
        try {
            String metadataJson = metadata == null || metadata.isEmpty() ? null : objectMapper.writeValueAsString(metadata);
            authRepository.insertAuditLog(
                    UUID.randomUUID().toString(),
                    actorUserId,
                    action,
                    targetType,
                    targetId,
                    Instant.now(),
                    metadataJson
            );
        } catch (Exception error) {
            logger.warn("Failed to write audit log for action {}", action, error);
        }
    }
}
