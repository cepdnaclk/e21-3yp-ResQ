package lk.resq.cloudapi.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lk.resq.cloudapi.config.CloudAuthProperties;
import lk.resq.cloudapi.model.CloudUser;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

@Service
public class CloudJwtService {

    private final CloudAuthProperties properties;
    private final SecretKey signingKey;

    public CloudJwtService(CloudAuthProperties properties) {
        this.properties = properties;
        this.signingKey = Keys.hmacShaKeyFor(sha256(properties.jwtSecret()));
    }

    public IssuedToken issue(CloudUser user) {
        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(properties.tokenTtlMinutes(), ChronoUnit.MINUTES);
        String token = Jwts.builder()
                .subject(user.userId())
                .issuer(properties.jwtIssuer())
                .claim("email", user.email())
                .claim("role", user.role().name())
                .issuedAt(Date.from(issuedAt))
                .expiration(Date.from(expiresAt))
                .signWith(signingKey)
                .compact();
        return new IssuedToken(token, expiresAt);
    }

    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(signingKey)
                .requireIssuer(properties.jwtIssuer())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    public record IssuedToken(String value, Instant expiresAt) {
    }
}
