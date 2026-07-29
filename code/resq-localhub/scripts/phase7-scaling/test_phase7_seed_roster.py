from pathlib import Path
import sqlite3
import tempfile
import unittest

from phase7_seed_roster import COURSE_ID, seed


class Phase7SeedRosterTest(unittest.TestCase):
    def test_seed_creates_deterministic_authorized_roster(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            database = Path(temp_dir) / "roster.sqlite"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE local_courses (
                  cloud_course_id TEXT PRIMARY KEY, course_code TEXT, title TEXT NOT NULL,
                  description TEXT, instructor_cloud_user_id TEXT, active INTEGER NOT NULL,
                  updated_at TEXT, last_synced_at TEXT NOT NULL
                );
                CREATE TABLE local_course_instructors (
                  cloud_course_id TEXT NOT NULL, instructor_cloud_user_id TEXT NOT NULL,
                  active INTEGER NOT NULL, last_synced_at TEXT NOT NULL,
                  PRIMARY KEY (cloud_course_id, instructor_cloud_user_id)
                );
                CREATE TABLE cloud_synced_users (
                  cloud_user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, email TEXT,
                  role TEXT NOT NULL, active INTEGER NOT NULL, updated_at TEXT,
                  last_synced_at TEXT NOT NULL, local_login_hash TEXT
                );
                CREATE TABLE local_course_enrollments (
                  cloud_course_id TEXT NOT NULL, trainee_cloud_user_id TEXT NOT NULL,
                  active INTEGER NOT NULL, enrolled_at TEXT, last_synced_at TEXT NOT NULL,
                  PRIMARY KEY (cloud_course_id, trainee_cloud_user_id)
                );
                """
            )
            connection.close()

            result = seed(database, "instructor-local-id", 3)

            self.assertEqual(COURSE_ID, result["courseId"])
            self.assertEqual(
                [
                    "phase7-trainee-001",
                    "phase7-trainee-002",
                    "phase7-trainee-003",
                ],
                result["traineeIds"],
            )
            connection = sqlite3.connect(database)
            self.assertEqual(
                4,
                connection.execute("SELECT COUNT(*) FROM cloud_synced_users").fetchone()[0],
            )
            self.assertEqual(
                3,
                connection.execute("SELECT COUNT(*) FROM local_course_enrollments").fetchone()[0],
            )
            self.assertEqual(
                "instructor-local-id",
                connection.execute(
                    "SELECT instructor_cloud_user_id FROM local_course_instructors"
                ).fetchone()[0],
            )
            connection.close()


if __name__ == "__main__":
    unittest.main()
