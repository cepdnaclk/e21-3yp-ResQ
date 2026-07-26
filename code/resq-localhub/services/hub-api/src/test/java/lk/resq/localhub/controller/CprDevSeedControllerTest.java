package lk.resq.localhub.controller;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import lk.resq.localhub.service.CprSampleDataSeeder;

class CprDevSeedControllerTest {

    @Test
    void seedEndpointInvokesSeederAndReturnsIds() {
        CprSampleDataSeeder seeder = mock(CprSampleDataSeeder.class);
        List<String> mockIds = List.of("session-1", "session-2");
        when(seeder.seed()).thenReturn(mockIds);

        CprDevSeedController controller = new CprDevSeedController(seeder);
        ResponseEntity<List<String>> response = controller.seed();

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isEqualTo(mockIds);
        verify(seeder, times(1)).seed();
    }
}
