package lk.resq.localhub.service;

import lk.resq.localhub.model.UserRole;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import jakarta.annotation.PostConstruct;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class LocalAuthRepository {

    private final Path databasePath;
    private final String jdbcUrl;

    public LocalAuthRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
        this.databasePath = Path.of(sqlitePath).toAbsolutePath();
        this.jdbcUrl = "jdbc:sqlite:" + this.databasePath.toString().replace("\\", "/");
    }

    @PostConstruct
    public void initialize() {
        try {
            Path parent = databasePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }

            try (Connection connection = openConnection(); Statement statement = connection.createStatement()) {
                statement.executeUpdate("PRAGMA foreign_keys = ON");
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS users (
                          id TEXT PRIMARY KEY,
                          username TEXT UNIQUE NOT NULL,
                          display_name TEXT NOT NULL,
                          password_hash TEXT NOT NULL,
                          role TEXT NOT NULL,
                          created_at TEXT NOT NULL,
                          updated_at TEXT NOT NULL,
                          disabled_at TEXT NULL
                        )
                        """);
                ensureColumn(connection, "users", "auth_source", "TEXT DEFAULT 'LOCAL'");
                ensureColumn(connection, "users", "cloud_user_id", "TEXT NULL");
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS auth_sessions (
                          id TEXT PRIMARY KEY,
                          user_id TEXT NOT NULL,
                          token_hash TEXT NOT NULL UNIQUE,
                          created_at TEXT NOT NULL,
                          expires_at TEXT NOT NULL,
                          revoked_at TEXT NULL,
                          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS audit_logs (
                          id TEXT PRIMARY KEY,
                          actor_user_id TEXT NULL,
                          action TEXT NOT NULL,
                          target_type TEXT NULL,
                          target_id TEXT NULL,
                          created_at TEXT NOT NULL,
                          metadata_json TEXT NULL,
                          FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
                        )
                        """);
                statement.executeUpdate("""
                        CREATE TABLE IF NOT EXISTS trainee_records (
                          id TEXT PRIMARY KEY,
                          trainee_code TEXT UNIQUE NOT NULL,
                          display_name TEXT NOT NULL,
                          group_name TEXT NULL,
                          notes TEXT NULL,
                          created_at TEXT NOT NULL,
                          updated_at TEXT NOT NULL,
                          archived_at TEXT NULL
                        )
                        """);
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize auth store at " + databasePath, error);
        }
    }

    public synchronized boolean hasUsers() {
        try (Connection connection = openConnection(); Statement statement = connection.createStatement(); ResultSet resultSet = statement.executeQuery("SELECT COUNT(*) AS count FROM users")) {
            return resultSet.next() && resultSet.getInt("count") > 0;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to read auth user count", error);
        }
    }

    public synchronized Optional<UserRecord> findUserByUsername(String username) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, username, display_name, password_hash, role, created_at, updated_at, disabled_at
                FROM users
                WHERE lower(username) = lower(?) AND (auth_source IS NULL OR auth_source = 'LOCAL')
                LIMIT 1
                """)) {
            statement.setString(1, username);

            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }

                return Optional.of(mapUser(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to look up user " + username, error);
        }
    }

    public synchronized Optional<UserRecord> findUserById(String userId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, username, display_name, password_hash, role, created_at, updated_at, disabled_at
                FROM users
                WHERE id = ?
                LIMIT 1
                """)) {
            statement.setString(1, userId);

            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }

                return Optional.of(mapUser(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to look up user " + userId, error);
        }
    }

    public synchronized List<UserRecord> listUsers() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, username, display_name, password_hash, role, created_at, updated_at, disabled_at
                FROM users
                ORDER BY created_at ASC
                """)) {
            List<UserRecord> users = new ArrayList<>();
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    users.add(mapUser(resultSet));
                }
            }
            return users;
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to list users", error);
        }
    }

    public synchronized UserRecord createUser(
            String id,
            String username,
            String displayName,
            String passwordHash,
            UserRole role,
            Instant now
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at, disabled_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
                """)) {
            statement.setString(1, id);
            statement.setString(2, username);
            statement.setString(3, displayName);
            statement.setString(4, passwordHash);
            statement.setString(5, role.name());
            statement.setString(6, now.toString());
            statement.setString(7, now.toString());
            statement.executeUpdate();
            return new UserRecord(id, username, displayName, passwordHash, role, now, now, null);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to create user " + username, error);
        }
    }

    public synchronized UserRecord upsertShadowUser(
            String id,
            String username,
            String displayName,
            String passwordHash,
            UserRole role,
            Instant now
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at, disabled_at, auth_source, cloud_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'CLOUD', ?)
                ON CONFLICT(id) DO UPDATE SET
                  username = excluded.username,
                  display_name = excluded.display_name,
                  password_hash = excluded.password_hash,
                  role = excluded.role,
                  updated_at = excluded.updated_at,
                  auth_source = 'CLOUD',
                  cloud_user_id = excluded.cloud_user_id
                """)) {
            statement.setString(1, id);
            statement.setString(2, username);
            statement.setString(3, displayName);
            statement.setString(4, passwordHash);
            statement.setString(5, role.name());
            statement.setString(6, now.toString());
            statement.setString(7, now.toString());
            statement.setString(8, id);
            statement.executeUpdate();
            return new UserRecord(id, username, displayName, passwordHash, role, now, now, null);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to upsert shadow user " + username, error);
        }
    }

    public synchronized Optional<UserRecord> disableUser(String userId, Instant disabledAt) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE users
                SET disabled_at = ?, updated_at = ?
                WHERE id = ?
                """)) {
            statement.setString(1, disabledAt.toString());
            statement.setString(2, disabledAt.toString());
            statement.setString(3, userId);
            int updated = statement.executeUpdate();
            if (updated == 0) {
                return Optional.empty();
            }
            return findUserById(userId);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to disable user " + userId, error);
        }
    }

    public synchronized Optional<UserRecord> enableUser(String userId, Instant updatedAt) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE users
                SET disabled_at = NULL, updated_at = ?
                WHERE id = ?
                """)) {
            statement.setString(1, updatedAt.toString());
            statement.setString(2, userId);
            int updated = statement.executeUpdate();
            if (updated == 0) {
                return Optional.empty();
            }
            return findUserById(userId);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to enable user " + userId, error);
        }
    }

    public synchronized AuthSessionRecord createAuthSession(
            String id,
            String userId,
            String tokenHash,
            Instant createdAt,
            Instant expiresAt
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, NULL)
                """)) {
            statement.setString(1, id);
            statement.setString(2, userId);
            statement.setString(3, tokenHash);
            statement.setString(4, createdAt.toString());
            statement.setString(5, expiresAt.toString());
            statement.executeUpdate();
            return new AuthSessionRecord(id, userId, tokenHash, createdAt, expiresAt, null);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to create auth session", error);
        }
    }

    public synchronized Optional<AuthSessionRecord> findSessionByTokenHash(String tokenHash) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT id, user_id, token_hash, created_at, expires_at, revoked_at
                FROM auth_sessions
                WHERE token_hash = ?
                LIMIT 1
                """)) {
            statement.setString(1, tokenHash);

            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }

                return Optional.of(mapSession(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to look up auth session", error);
        }
    }

    public synchronized void revokeSessionByTokenHash(String tokenHash, Instant revokedAt) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE auth_sessions
                SET revoked_at = ?
                WHERE token_hash = ?
                """)) {
            statement.setString(1, revokedAt.toString());
            statement.setString(2, tokenHash);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to revoke auth session", error);
        }
    }

    public synchronized void insertAuditLog(
            String id,
            String actorUserId,
            String action,
            String targetType,
            String targetId,
            Instant createdAt,
            String metadataJson
    ) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, created_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """)) {
            statement.setString(1, id);
            statement.setString(2, actorUserId);
            statement.setString(3, action);
            statement.setString(4, targetType);
            statement.setString(5, targetId);
            statement.setString(6, createdAt.toString());
            statement.setString(7, metadataJson);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to write audit log entry", error);
        }
    }

    private Connection openConnection() throws SQLException {
        Connection connection = DriverManager.getConnection(jdbcUrl);
        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("PRAGMA foreign_keys = ON");
        }
        return connection;
    }

    private static void ensureColumn(Connection connection, String tableName, String columnName, String definition) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("PRAGMA table_info(" + tableName + ")")) {
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    if (columnName.equalsIgnoreCase(resultSet.getString("name"))) {
                        return;
                    }
                }
            }
        }

        try (Statement statement = connection.createStatement()) {
            statement.executeUpdate("ALTER TABLE " + tableName + " ADD COLUMN " + columnName + " " + definition);
        }
    }

    private UserRecord mapUser(ResultSet resultSet) throws SQLException {
        String disabledAtValue = resultSet.getString("disabled_at");
        return new UserRecord(
                resultSet.getString("id"),
                resultSet.getString("username"),
                resultSet.getString("display_name"),
                resultSet.getString("password_hash"),
                UserRole.valueOf(resultSet.getString("role")),
                Instant.parse(resultSet.getString("created_at")),
                Instant.parse(resultSet.getString("updated_at")),
                disabledAtValue == null ? null : Instant.parse(disabledAtValue)
        );
    }

    private AuthSessionRecord mapSession(ResultSet resultSet) throws SQLException {
        String revokedAtValue = resultSet.getString("revoked_at");
        return new AuthSessionRecord(
                resultSet.getString("id"),
                resultSet.getString("user_id"),
                resultSet.getString("token_hash"),
                Instant.parse(resultSet.getString("created_at")),
                Instant.parse(resultSet.getString("expires_at")),
                revokedAtValue == null ? null : Instant.parse(revokedAtValue)
        );
    }

    record UserRecord(
            String id,
            String username,
            String displayName,
            String passwordHash,
            UserRole role,
            Instant createdAt,
            Instant updatedAt,
            Instant disabledAt
    ) {
    }

    record AuthSessionRecord(
            String id,
            String userId,
            String tokenHash,
            Instant createdAt,
            Instant expiresAt,
            Instant revokedAt
    ) {
    }
}
