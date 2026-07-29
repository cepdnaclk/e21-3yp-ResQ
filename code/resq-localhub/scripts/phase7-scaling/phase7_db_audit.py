import argparse
import hashlib
from pathlib import Path
import sqlite3
from typing import Iterable


SESSION_TABLES = ("sessions", "session_runtime")


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def placeholders(values: Iterable[str]) -> str:
    return ",".join("?" for _ in values)


def audit(
    database: Path,
    expected_device_ids: list[str],
    non_scoring_device_ids: list[str],
    expected_profile_id: str,
    expected_profile_version: int,
    expected_profile_hash: str,
) -> dict:
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        tables = [
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        columns_by_table = {
            table: {
                row["name"]
                for row in connection.execute(f"PRAGMA table_info({quote_identifier(table)})")
            }
            for table in tables
        }

        unexpected_by_table: dict[str, int] = {}
        device_rows_audited = 0
        for table, columns in columns_by_table.items():
            if "device_id" not in columns:
                continue
            device_rows_audited += int(
                connection.execute(
                    f"SELECT COUNT(*) FROM {quote_identifier(table)} "
                    "WHERE device_id IS NOT NULL AND TRIM(device_id) <> ''"
                ).fetchone()[0]
            )
            query = (
                f"SELECT COUNT(*) FROM {quote_identifier(table)} "
                "WHERE device_id IS NOT NULL AND TRIM(device_id) <> ''"
            )
            parameters: list[object] = []
            if expected_device_ids:
                query += f" AND device_id NOT IN ({placeholders(expected_device_ids)})"
                parameters.extend(expected_device_ids)
            count = int(connection.execute(query, parameters).fetchone()[0])
            if count:
                unexpected_by_table[table] = count

        profile_rows_audited = 0
        invalid_profiles_by_table: dict[str, int] = {}
        for table, columns in columns_by_table.items():
            if "profile_id" not in columns:
                continue
            where = "profile_id IS NOT NULL AND TRIM(profile_id) <> ''"
            parameters: list[object] = []
            if "device_id" in columns and expected_device_ids:
                where += f" AND device_id IN ({placeholders(expected_device_ids)})"
                parameters.extend(expected_device_ids)
            profile_rows_audited += int(
                connection.execute(
                    f"SELECT COUNT(*) FROM {quote_identifier(table)} WHERE {where}",
                    parameters,
                ).fetchone()[0]
            )
            invalid_where = f"{where} AND profile_id <> ?"
            invalid_parameters = [*parameters, expected_profile_id]
            count = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM {quote_identifier(table)} WHERE {invalid_where}",
                    invalid_parameters,
                ).fetchone()[0]
            )
            if count:
                invalid_profiles_by_table[table] = count

        profile_table_columns = columns_by_table.get("calibration_profiles", set())
        fingerprint_columns = {
            "profile_id",
            "version",
            "hall_delta",
            "ref_pressure",
            "bladder_1_pressure",
            "bladder_2_pressure",
        }
        if fingerprint_columns.issubset(profile_table_columns):
            rows = connection.execute(
                """
                SELECT profile_id, version, hall_delta, ref_pressure,
                       bladder_1_pressure, bladder_2_pressure
                FROM calibration_profiles
                WHERE profile_id = ?
                """,
                (expected_profile_id,),
            ).fetchall()
            if not rows:
                invalid_profiles_by_table["calibration_profiles"] = (
                    invalid_profiles_by_table.get("calibration_profiles", 0) + 1
                )
            for row in rows:
                canonical = (
                    f"profile_id={row['profile_id']};profile_version={row['version']};"
                    f"hall_delta={row['hall_delta']};ref_pressure={row['ref_pressure']};"
                    f"bladder_1_pressure={row['bladder_1_pressure']};"
                    f"bladder_2_pressure={row['bladder_2_pressure']}"
                )
                actual_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                if (
                    row["version"] != expected_profile_version
                    or actual_hash != expected_profile_hash
                ):
                    invalid_profiles_by_table["calibration_profiles"] = (
                        invalid_profiles_by_table.get("calibration_profiles", 0) + 1
                    )

        diagnostic_scoring_by_table: dict[str, int] = {}
        if non_scoring_device_ids:
            for table in SESSION_TABLES:
                columns = columns_by_table.get(table, set())
                if "device_id" not in columns:
                    continue
                count = int(
                    connection.execute(
                        f"SELECT COUNT(*) FROM {quote_identifier(table)} "
                        f"WHERE device_id IN ({placeholders(non_scoring_device_ids)})",
                        non_scoring_device_ids,
                    ).fetchone()[0]
                )
                if count:
                    diagnostic_scoring_by_table[table] = count

        return {
            "expectedDeviceIds": expected_device_ids,
            "nonScoringDeviceIds": non_scoring_device_ids,
            "deviceRowsAudited": device_rows_audited,
            "unexpectedDeviceRows": sum(unexpected_by_table.values()),
            "unexpectedDeviceRowsByTable": unexpected_by_table,
            "profileRowsAudited": profile_rows_audited,
            "profileColumnsByTable": {
                table: sorted(column for column in columns if "profile" in column)
                for table, columns in columns_by_table.items()
                if any("profile" in column for column in columns)
            },
            "invalidProfileIdentityRows": sum(invalid_profiles_by_table.values()),
            "invalidProfileIdentityRowsByTable": invalid_profiles_by_table,
            "diagnosticScoringRows": sum(diagnostic_scoring_by_table.values()),
            "diagnosticScoringRowsByTable": diagnostic_scoring_by_table,
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--expected-devices", required=True)
    parser.add_argument("--non-scoring-devices", default="")
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--profile-version", type=int, required=True)
    parser.add_argument("--profile-hash", required=True)
    args = parser.parse_args()
    result = audit(
        args.database,
        [value for value in args.expected_devices.split(",") if value],
        [value for value in args.non_scoring_devices.split(",") if value],
        args.profile_id,
        args.profile_version,
        args.profile_hash,
    )
    import json

    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
