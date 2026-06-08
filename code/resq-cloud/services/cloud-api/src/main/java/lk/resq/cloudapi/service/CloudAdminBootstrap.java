package lk.resq.cloudapi.service;

import lk.resq.cloudapi.config.CloudAuthProperties;
import lk.resq.cloudapi.model.CloudUser;
import lk.resq.cloudapi.model.CloudUserRole;
import lk.resq.cloudapi.repository.CloudManagementRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Component
public class CloudAdminBootstrap implements ApplicationRunner {

    private final CloudManagementRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final CloudAuthProperties properties;

    public CloudAdminBootstrap(
            CloudManagementRepository repository,
            PasswordEncoder passwordEncoder,
            CloudAuthProperties properties
    ) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        ensureBootstrapAdmin();
    }

    public CloudUser ensureBootstrapAdmin() {
        if (repository.existsAdminUser()) {
            return null;
        }
        Instant now = Instant.now();
        CloudUser admin = new CloudUser(
                UUID.randomUUID().toString(),
                properties.bootstrapAdminName(),
                properties.bootstrapAdminEmail(),
                CloudUserRole.ADMIN,
                true,
                now,
                now
        );
        return repository.insertUser(
                admin,
                passwordEncoder.encode(properties.bootstrapAdminPassword()),
                now
        );
    }
}
