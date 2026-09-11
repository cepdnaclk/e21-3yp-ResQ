#!/usr/bin/env python3
"""Seed deterministic roster records into an isolated Phase 7 database."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3


COURSE_ID = "phase7-course"


def seed(database: Path, instructor_id: str, trainee_count: int) -> dict[str, object]:
    if not instructor_id.strip():
        raise ValueError("instructor_id is required")
    if trainee_count < 1 or trainee_count > 200:
        raise ValueError("trainee_count must be between 1 and 200")

    now = datetime.now(timezone.utc).isoformat()
    connection = sqlite3.connect(database, timeout=10)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            INSERT INTO cloud_synced_users (
              cloud_user_id, display_name, email, role, active,
              updated_at, last_synced_at, local_login_hash
            ) VALUES (?, 'Phase 7 Instructor', 'phase7-instructor@invalid.local',
                      'INSTRUCTOR', 1, ?, ?, NULL)
            ON CONFLICT(cloud_user_id) DO UPDATE SET
              role = 'INSTRUCTOR',
              active = 1,
              last_synced_at = excluded.last_synced_at
            """,
            (instructor_id, now, now),
        )
        connection.execute(
            """
            INSERT INTO local_courses (
              cloud_course_id, course_code, title, description,
              instructor_cloud_user_id, active, updated_at, last_synced_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(cloud_course_id) DO UPDATE SET
              instructor_cloud_user_id = excluded.instructor_cloud_user_id,
              active = 1,
              last_synced_at = excluded.last_synced_at
            """,
            (COURSE_ID, "P7-SCALE", "Phase 7 Scaling", "Isolated deterministic load roster",
             instructor_id, now, now),
        )
        connection.execute(
            """
            INSERT INTO local_course_instructors (
              cloud_course_id, instructor_cloud_user_id, active, last_synced_at
            ) VALUES (?, ?, 1, ?)
            ON CONFLICT(cloud_course_id, instructor_cloud_user_id) DO UPDATE SET
              active = 1,
              last_synced_at = excluded.last_synced_at
            """,
            (COURSE_ID, instructor_id, now),
        )

        trainees = []
        for index in range(1, trainee_count + 1):
            trainee_id = f"phase7-trainee-{index:03d}"
            trainees.append(trainee_id)
            connection.execute(
                """
                INSERT INTO cloud_synced_users (
                  cloud_user_id, display_name, email, role, active,
                  updated_at, last_synced_at, local_login_hash
                ) VALUES (?, ?, ?, 'TRAINEE', 1, ?, ?, NULL)
                ON CONFLICT(cloud_user_id) DO UPDATE SET
                  role = 'TRAINEE',
                  active = 1,
                  last_synced_at = excluded.last_synced_at
                """,
                (trainee_id, f"Phase 7 Trainee {index:03d}",
                 f"{trainee_id}@invalid.local", now, now),
            )
            connection.execute(
                """
                INSERT INTO local_course_enrollments (
                  cloud_course_id, trainee_cloud_user_id, active,
                  enrolled_at, last_synced_at
                ) VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(cloud_course_id, trainee_cloud_user_id) DO UPDATE SET
                  active = 1,
                  last_synced_at = excluded.last_synced_at
                """,
                (COURSE_ID, trainee_id, now, now),
            )
        connection.commit()
        return {"courseId": COURSE_ID, "traineeIds": trainees, "instructorId": instructor_id}
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("instructor_id")
    parser.add_argument("trainee_count", type=int)
    args = parser.parse_args()
    print(json.dumps(seed(args.database.resolve(), args.instructor_id, args.trainee_count), sort_keys=True))


if __name__ == "__main__":
    main()
