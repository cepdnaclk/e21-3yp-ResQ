package lk.resq.localhub.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;

class ReleaseConfigurationTest {
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties({CloudSyncProperties.class, RosterSyncProperties.class})
    static class PropertiesConfiguration {}

    @Test
    void releaseOverlayRetainsClasspathCloudMappingsAndPrivateCredentials() {
        String releaseConfig = Path.of("../../apps/localhub-desktop/src-tauri/resources/config/application-release.properties")
                .toAbsolutePath().normalize().toUri().toString();
        new ApplicationContextRunner()
                .withInitializer(new ConfigDataApplicationContextInitializer())
                .withUserConfiguration(PropertiesConfiguration.class)
                .withPropertyValues("spring.config.additional-location=" + releaseConfig,
                        "RESQ_ROSTER_SYNC_HUB_ID=test-hub", "RESQ_ROSTER_SYNC_HUB_KEY=test-key",
                        "RESQ_CLOUD_SYNC_BASE_URL=https://cloud.example.test")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    CloudSyncProperties cloud = context.getBean(CloudSyncProperties.class);
                    assertThat(cloud.isEnabled()).isTrue();
                    assertThat(cloud.isReadyForUpload()).isTrue();
                    assertThat(cloud.getBaseUrl()).isEqualTo("https://cloud.example.test");
                    assertThat(cloud.getHubId()).isEqualTo("test-hub");
                    assertThat(context.getEnvironment().getProperty("server.address")).isEqualTo("0.0.0.0");
                });
    }
}
