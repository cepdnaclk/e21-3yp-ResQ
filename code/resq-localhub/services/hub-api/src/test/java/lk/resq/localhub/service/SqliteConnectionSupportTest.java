package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;

class SqliteConnectionSupportTest {

    @TempDir
    Path tempDir;

    @Test
    void opensConnectionsWithBoundedWalCompatiblePolicy() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("policy.sqlite").toString().replace("\\", "/");

        try (Connection connection = SqliteConnectionSupport.open(jdbcUrl);
             Statement statement = connection.createStatement()) {
            assertThat(pragmaInt(statement, "busy_timeout")).isEqualTo(5_000);
            assertThat(pragmaInt(statement, "foreign_keys")).isEqualTo(1);
            assertThat(pragmaInt(statement, "synchronous")).isEqualTo(1);
        }
    }

    private static int pragmaInt(Statement statement, String pragma) throws Exception {
        try (ResultSet resultSet = statement.executeQuery("PRAGMA " + pragma)) {
            assertThat(resultSet.next()).isTrue();
            return resultSet.getInt(1);
        }
    }
}
