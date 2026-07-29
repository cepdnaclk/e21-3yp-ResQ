from pathlib import Path
import sqlite3
import tempfile
import unittest

from phase7_db_audit import audit


class Phase7DatabaseAuditTest(unittest.TestCase):
    def test_audit_measures_identity_and_diagnostic_scoring_violations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            database = Path(temp_dir) / "audit.sqlite"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE calibration_profiles (
                  profile_id TEXT, profile_version INTEGER, profile_hash TEXT
                );
                CREATE TABLE firmware_events (
                  device_id TEXT, profile_id TEXT, profile_version INTEGER, profile_hash TEXT
                );
                CREATE TABLE sessions (
                  session_id TEXT, device_id TEXT
                );
                CREATE TABLE session_runtime (
                  session_id TEXT, device_id TEXT
                );
                """
            )
            good_hash = "good-profile-hash"
            connection.execute(
                "INSERT INTO calibration_profiles VALUES (?, ?, ?)",
                ("adult-basic", 1, good_hash),
            )
            connection.execute(
                "INSERT INTO firmware_events VALUES (?, ?, ?, ?)",
                ("SCALE-001", "adult-basic", 1, good_hash),
            )
            connection.execute(
                "INSERT INTO firmware_events VALUES (?, ?, ?, ?)",
                ("UNEXPECTED", "adult-basic", 2, "wrong"),
            )
            connection.execute("INSERT INTO sessions VALUES (?, ?)", ("bad-session", "SCALE-002"))
            connection.commit()
            connection.close()

            result = audit(
                database,
                ["SCALE-001", "SCALE-002"],
                ["SCALE-002"],
                "adult-basic",
                1,
                good_hash,
            )

            self.assertEqual(1, result["unexpectedDeviceRows"])
            self.assertEqual(3, result["deviceRowsAudited"])
            self.assertEqual(2, result["profileRowsAudited"])
            self.assertEqual(0, result["invalidProfileIdentityRows"])
            self.assertEqual(1, result["diagnosticScoringRows"])


if __name__ == "__main__":
    unittest.main()
