package lk.resq.cloudapi.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "resq.cloud-auth")
public record CloudAuthProperties(
        String jwtSecret,
        String jwtIssuer,
        long tokenTtlMinutes,
        String bootstrapAdminEmail,
        String bootstrapAdminPassword,
        String bootstrapAdminName
) {
}
