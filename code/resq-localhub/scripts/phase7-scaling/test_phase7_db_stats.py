from pathlib import Path
import sqlite3
import tempfile
import unittest

from phase7_db_stats import collect


class Phase7DatabaseStatsTest(unittest.TestCase):
    def test_collect_counts_rows_without_mutating_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            database = Path(temp_dir) / "scale.sqlite"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE samples (id INTEGER PRIMARY KEY, value TEXT)")
            connection.executemany("INSERT INTO samples(value) VALUES (?)", [("a",), ("b",)])
            connection.commit()
            connection.close()

            before = database.stat().st_mtime_ns
            result = collect(database)

            self.assertEqual(2, result["tables"]["samples"])
            self.assertGreater(result["bytes"], 0)
            self.assertEqual(before, database.stat().st_mtime_ns)


if __name__ == "__main__":
    unittest.main()
