#!/usr/bin/env python3
"""Read-only SQLite statistics for the Phase 7 scaling harness."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def collect(database: Path) -> dict[str, object]:
    if not database.is_file():
        return {"exists": False, "bytes": 0, "page_count": 0, "page_size": 0, "tables": {}}

    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True, timeout=5)
    try:
        page_count = int(connection.execute("PRAGMA page_count").fetchone()[0])
        page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        rows = {}
        for table in tables:
            escaped = table.replace('"', '""')
            rows[table] = int(connection.execute(f'SELECT COUNT(*) FROM "{escaped}"').fetchone()[0])
        return {
            "exists": True,
            "bytes": database.stat().st_size,
            "page_count": page_count,
            "page_size": page_size,
            "tables": rows,
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    print(json.dumps(collect(args.database.resolve()), sort_keys=True))


if __name__ == "__main__":
    main()
