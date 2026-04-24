package lk.resq.localhub;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class LocalHubApplication {

    public static void main(String[] args) {
        SpringApplication.run(LocalHubApplication.class, args);
    }
}
