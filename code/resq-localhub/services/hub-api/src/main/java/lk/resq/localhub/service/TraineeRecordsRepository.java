package lk.resq.localhub.service;

import lk.resq.localhub.model.TraineeRecord;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
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
import java.util.UUID;

@Component
public class TraineeRecordsRepository {
    private final String databasePath;

    public TraineeRecordsRepository() throws IOException {
        Path appDataPath = Paths.get(System.getProperty("user.home"), ".resq-localhub");
        this.databasePath = appDataPath.resolve("hub-api.sqlite").toString();
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection("jdbc:sqlite:" + databasePath);
    }

    /**
     * List all active (non-archived) trainee records.
     */
    public List<TraineeRecord> listActiveTrainees() throws SQLException {
        List<TraineeRecord> trainees = new ArrayList<>();
        String sql = "SELECT id, trainee_code, display_name, group_name, notes, created_at, updated_at, archived_at " +
                     "FROM trainee_records WHERE archived_at IS NULL ORDER BY created_at DESC";

        try (Connection connection = openConnection(); Statement statement = connection.createStatement()) {
            ResultSet rs = statement.executeQuery(sql);
            while (rs.next()) {
                trainees.add(new TraineeRecord(
                        rs.getString("id"),
                        rs.getString("trainee_code"),
                        rs.getString("display_name"),
                        rs.getString("group_name"),
                        rs.getString("notes"),
                        rs.getString("created_at"),
                        rs.getString("updated_at"),
                        rs.getString("archived_at")
                ));
            }
        }
        return trainees;
    }

    /**
     * Find a trainee record by ID.
     */
    public Optional<TraineeRecord> findTraineeById(String id) throws SQLException {
        String sql = "SELECT id, trainee_code, display_name, group_name, notes, created_at, updated_at, archived_at " +
                     "FROM trainee_records WHERE id = ?";

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, id);
            ResultSet rs = statement.executeQuery();
            if (rs.next()) {
                return Optional.of(new TraineeRecord(
                        rs.getString("id"),
                        rs.getString("trainee_code"),
                        rs.getString("display_name"),
                        rs.getString("group_name"),
                        rs.getString("notes"),
                        rs.getString("created_at"),
                        rs.getString("updated_at"),
                        rs.getString("archived_at")
                ));
            }
        }
        return Optional.empty();
    }

    /**
     * Find a trainee record by code.
     */
    public Optional<TraineeRecord> findTraineeByCode(String code) throws SQLException {
        String sql = "SELECT id, trainee_code, display_name, group_name, notes, created_at, updated_at, archived_at " +
                     "FROM trainee_records WHERE trainee_code = ? AND archived_at IS NULL";

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, code);
            ResultSet rs = statement.executeQuery();
            if (rs.next()) {
                return Optional.of(new TraineeRecord(
                        rs.getString("id"),
                        rs.getString("trainee_code"),
                        rs.getString("display_name"),
                        rs.getString("group_name"),
                        rs.getString("notes"),
                        rs.getString("created_at"),
                        rs.getString("updated_at"),
                        rs.getString("archived_at")
                ));
            }
        }
        return Optional.empty();
    }

    /**
     * Create a new trainee record.
     */
    public TraineeRecord createTrainee(String traineeCode, String displayName, String groupName, String notes) throws SQLException {
        String id = UUID.randomUUID().toString();
        String now = Instant.now().toString();

        String sql = "INSERT INTO trainee_records (id, trainee_code, display_name, group_name, notes, created_at, updated_at, archived_at) " +
                     "VALUES (?, ?, ?, ?, ?, ?, ?, NULL)";

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, id);
            statement.setString(2, traineeCode);
            statement.setString(3, displayName);
            statement.setString(4, groupName);
            statement.setString(5, notes);
            statement.setString(6, now);
            statement.setString(7, now);
            statement.executeUpdate();
        }

        return new TraineeRecord(id, traineeCode, displayName, groupName, notes, now, now, null);
    }

    /**
     * Update an existing trainee record.
     */
    public TraineeRecord updateTrainee(String id, String displayName, String groupName, String notes) throws SQLException {
        String now = Instant.now().toString();

        String sql = "UPDATE trainee_records SET display_name = ?, group_name = ?, notes = ?, updated_at = ? " +
                     "WHERE id = ? AND archived_at IS NULL";

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, displayName);
            statement.setString(2, groupName);
            statement.setString(3, notes);
            statement.setString(4, now);
            statement.setString(5, id);
            int rows = statement.executeUpdate();
            if (rows == 0) {
                throw new IllegalArgumentException("Trainee record not found or already archived: " + id);
            }
        }

        return findTraineeById(id)
                .orElseThrow(() -> new IllegalArgumentException("Trainee record not found: " + id));
    }

    /**
     * Archive a trainee record (soft delete).
     */
    public void archiveTrainee(String id) throws SQLException {
        String now = Instant.now().toString();
        String sql = "UPDATE trainee_records SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL";

        try (Connection connection = openConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, now);
            statement.setString(2, now);
            statement.setString(3, id);
            int rows = statement.executeUpdate();
            if (rows == 0) {
                throw new IllegalArgumentException("Trainee record not found or already archived: " + id);
            }
        }
    }
}
