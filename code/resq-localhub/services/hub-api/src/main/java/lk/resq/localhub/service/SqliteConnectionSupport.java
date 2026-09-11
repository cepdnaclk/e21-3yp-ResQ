package lk.resq.localhub.service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * Applies the same bounded, WAL-compatible policy to every short-lived SQLite connection.
 */
final class SqliteConnectionSupport {

    private static final int BUSY_TIMEOUT_MS = 5_000;

    private SqliteConnectionSupport() {
    }

    static Connection open(String jdbcUrl) throws SQLException {
        Connection connection = DriverManager.getConnection(jdbcUrl);
        try (Statement statement = connection.createStatement()) {
            statement.execute("PRAGMA busy_timeout = " + BUSY_TIMEOUT_MS);
            statement.execute("PRAGMA foreign_keys = ON");
            statement.execute("PRAGMA synchronous = NORMAL");
            return connection;
        } catch (SQLException error) {
            try {
                connection.close();
            } catch (SQLException closeError) {
                error.addSuppressed(closeError);
            }
            throw error;
        }
    }
}
