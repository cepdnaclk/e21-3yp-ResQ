from __future__ import annotations

import json
from pathlib import Path

from resq_deploy_test.report import QualificationReport


def test_required_skip_is_incomplete_and_reports_are_written(tmp_path: Path) -> None:
    report = QualificationReport(tmp_path)
    report.add("hardware", "button", "SKIP", "not performed", required=True)
    assert report.outcome == "INCOMPLETE"
    paths = report.write()
    assert set(paths) == {"json", "junit", "markdown"}
    assert json.loads(paths["json"].read_text(encoding="utf-8"))["outcome"] == "INCOMPLETE"


def test_failure_takes_precedence_over_incomplete(tmp_path: Path) -> None:
    report = QualificationReport(tmp_path)
    report.add("hardware", "button", "SKIP", "skipped")
    report.add("protocol", "heartbeat", "FAIL", "missing")
    assert report.outcome == "FAIL"
