package lk.resq.localhub.service;

import lk.resq.localhub.model.firmware.CalibrationProfileRecord;
import lk.resq.localhub.model.firmware.CalibrationProfileRequest;
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
public class CalibrationProfileRepository {

    private static final int LEGACY_DEFAULT_HALL_DELTA = 13500;

    private final Path databasePath;
    private final String jdbcUrl;

    public CalibrationProfileRepository(@Value("${resq.storage.sqlite-path:${user.home}/.resq-localhub/hub-api.sqlite}") String sqlitePath) {
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
                        CREATE TABLE IF NOT EXISTS calibration_profiles (
                          profile_id TEXT PRIMARY KEY,
                          name TEXT NOT NULL,
                          hall_delta INTEGER NOT NULL,
                          ref_pressure INTEGER NOT NULL,
                          bladder_1_pressure INTEGER NOT NULL,
                          bladder_2_pressure INTEGER NOT NULL,
                          description TEXT,
                          active INTEGER NOT NULL DEFAULT 1,
                          is_default INTEGER NOT NULL DEFAULT 0,
                          created_at TEXT NOT NULL,
                          updated_at TEXT NOT NULL
                        )
                        """);
                statement.executeUpdate("CREATE INDEX IF NOT EXISTS idx_calibration_profiles_active_default ON calibration_profiles(active, is_default)");

                if (countProfiles(connection) == 0) {
                    insertProfile(connection, new CalibrationProfileRecord(
                            "adult-basic",
                            "Adult Basic",
                            CalibrationConstraints.DEFAULT_HALL_DELTA,
                            20100,
                            15000,
                            15000,
                            "Default adult CPR calibration profile",
                            true,
                            true,
                            Instant.now().toString(),
                            Instant.now().toString()
                    ));
                }

                migrateLegacyDefaultHallDelta(connection);
            }
        } catch (IOException | SQLException error) {
            throw new IllegalStateException("Failed to initialize calibration profile store at " + databasePath, error);
        }
    }

    public synchronized List<CalibrationProfileRecord> findAll() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT profile_id, name, hall_delta, ref_pressure, bladder_1_pressure, bladder_2_pressure, description,
                       active, is_default, created_at, updated_at
                FROM calibration_profiles
                ORDER BY is_default DESC, active DESC, name ASC, profile_id ASC
                """)) {
            return readProfiles(statement);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load calibration profiles", error);
        }
    }

    public synchronized Optional<CalibrationProfileRecord> findById(String profileId) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT profile_id, name, hall_delta, ref_pressure, bladder_1_pressure, bladder_2_pressure, description,
                       active, is_default, created_at, updated_at
                FROM calibration_profiles
                WHERE profile_id = ?
                LIMIT 1
                """)) {
            statement.setString(1, profileId);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapProfile(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load calibration profile " + profileId, error);
        }
    }

    public synchronized Optional<CalibrationProfileRecord> findDefaultProfile() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                SELECT profile_id, name, hall_delta, ref_pressure, bladder_1_pressure, bladder_2_pressure, description,
                       active, is_default, created_at, updated_at
                FROM calibration_profiles
                WHERE is_default = 1
                ORDER BY active DESC, updated_at DESC, profile_id ASC
                LIMIT 1
                """)) {
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return Optional.empty();
                }
                return Optional.of(mapProfile(resultSet));
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to load default calibration profile", error);
        }
    }

    public synchronized long countActiveProfiles() {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("SELECT COUNT(*) FROM calibration_profiles WHERE active = 1")) {
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getLong(1) : 0L;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to count active calibration profiles", error);
        }
    }

    public synchronized void insertProfile(CalibrationProfileRecord profile) {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            try {
                if (profile.defaultProfile()) {
                    clearDefaultProfiles(connection, null);
                }
                insertProfile(connection, profile);
                connection.commit();
            } catch (SQLException error) {
                connection.rollback();
                throw error;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to insert calibration profile " + profile.profileId(), error);
        }
    }

    public synchronized void updateProfile(CalibrationProfileRecord profile) {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            try {
                if (profile.defaultProfile()) {
                    clearDefaultProfiles(connection, profile.profileId());
                }
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE calibration_profiles
                        SET name = ?,
                            hall_delta = ?,
                            ref_pressure = ?,
                            bladder_1_pressure = ?,
                            bladder_2_pressure = ?,
                            description = ?,
                            active = ?,
                            is_default = ?,
                            updated_at = ?
                        WHERE profile_id = ?
                        """)) {
                    bindProfileUpdate(statement, profile);
                    statement.executeUpdate();
                }
                connection.commit();
            } catch (SQLException error) {
                connection.rollback();
                throw error;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to update calibration profile " + profile.profileId(), error);
        }
    }

    public synchronized void setDefaultProfile(String profileId, String updatedAt) {
        try (Connection connection = openConnection()) {
            connection.setAutoCommit(false);
            try {
                clearDefaultProfiles(connection, profileId);
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE calibration_profiles
                        SET is_default = 1,
                            active = 1,
                            updated_at = ?
                        WHERE profile_id = ?
                        """)) {
                    statement.setString(1, updatedAt);
                    statement.setString(2, profileId);
                    statement.executeUpdate();
                }
                connection.commit();
            } catch (SQLException error) {
                connection.rollback();
                throw error;
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to set calibration profile " + profileId + " as default", error);
        }
    }

    public synchronized void deactivateProfile(String profileId, String updatedAt) {
        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement("""
                UPDATE calibration_profiles
                SET active = 0,
                    updated_at = ?
                WHERE profile_id = ?
                """)) {
            statement.setString(1, updatedAt);
            statement.setString(2, profileId);
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to deactivate calibration profile " + profileId, error);
        }
    }

    public synchronized int countProfiles() {
        try (Connection connection = openConnection()) {
            return countProfiles(connection);
        } catch (SQLException error) {
            throw new IllegalStateException("Failed to count calibration profiles", error);
        }
    }

    private int countProfiles(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT COUNT(*) FROM calibration_profiles")) {
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getInt(1) : 0;
            }
        }
    }

    private void migrateLegacyDefaultHallDelta(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                UPDATE calibration_profiles
                SET hall_delta = ?,
                    updated_at = ?
                WHERE profile_id = 'adult-basic'
                  AND hall_delta = ?
                """)) {
            statement.setInt(1, CalibrationConstraints.DEFAULT_HALL_DELTA);
            statement.setString(2, Instant.now().toString());
            statement.setInt(3, LEGACY_DEFAULT_HALL_DELTA);
            statement.executeUpdate();
        }
    }

    private void clearDefaultProfiles(Connection connection, String keepProfileId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(keepProfileId == null
                ? "UPDATE calibration_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1"
                : "UPDATE calibration_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1 AND profile_id <> ?")) {
            statement.setString(1, Instant.now().toString());
            if (keepProfileId != null) {
                statement.setString(2, keepProfileId);
            }
            statement.executeUpdate();
        }
    }

    private void insertProfile(Connection connection, CalibrationProfileRecord profile) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO calibration_profiles (
                  profile_id, name, hall_delta, ref_pressure, bladder_1_pressure, bladder_2_pressure, description,
                  active, is_default, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            bindProfile(statement, profile);
            statement.executeUpdate();
        }
    }

    private void bindProfile(PreparedStatement statement, CalibrationProfileRecord profile) throws SQLException {
        statement.setString(1, profile.profileId());
        statement.setString(2, profile.name());
        statement.setInt(3, profile.hallDelta());
        statement.setInt(4, profile.refPressure());
        statement.setInt(5, profile.bladder1Pressure());
        statement.setInt(6, profile.bladder2Pressure());
        statement.setString(7, profile.description());
        statement.setInt(8, profile.active() ? 1 : 0);
        statement.setInt(9, profile.defaultProfile() ? 1 : 0);
        statement.setString(10, profile.createdAt());
        statement.setString(11, profile.updatedAt());
    }

    private void bindProfileUpdate(PreparedStatement statement, CalibrationProfileRecord profile) throws SQLException {
        statement.setString(1, profile.name());
        statement.setInt(2, profile.hallDelta());
        statement.setInt(3, profile.refPressure());
        statement.setInt(4, profile.bladder1Pressure());
        statement.setInt(5, profile.bladder2Pressure());
        statement.setString(6, profile.description());
        statement.setInt(7, profile.active() ? 1 : 0);
        statement.setInt(8, profile.defaultProfile() ? 1 : 0);
        statement.setString(9, profile.updatedAt());
        statement.setString(10, profile.profileId());
    }

    private List<CalibrationProfileRecord> readProfiles(PreparedStatement statement) throws SQLException {
        List<CalibrationProfileRecord> profiles = new ArrayList<>();
        try (ResultSet resultSet = statement.executeQuery()) {
            while (resultSet.next()) {
                profiles.add(mapProfile(resultSet));
            }
        }
        return profiles;
    }

    private CalibrationProfileRecord mapProfile(ResultSet resultSet) throws SQLException {
        return new CalibrationProfileRecord(
                resultSet.getString("profile_id"),
                resultSet.getString("name"),
                resultSet.getInt("hall_delta"),
                resultSet.getInt("ref_pressure"),
                resultSet.getInt("bladder_1_pressure"),
                resultSet.getInt("bladder_2_pressure"),
                resultSet.getString("description"),
                resultSet.getInt("active") == 1,
                resultSet.getInt("is_default") == 1,
                resultSet.getString("created_at"),
                resultSet.getString("updated_at")
        );
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }
}
