import json
from datetime import datetime, timezone
from pathlib import Path


def pytest_sessionfinish(session, exitstatus):
    terminal = session.config.pluginmanager.get_plugin("terminalreporter")
    stats = getattr(terminal, "stats", {}) if terminal else {}
    counts = {
        "passed": len(stats.get("passed", [])),
        "failed": len(stats.get("failed", [])),
        "skipped": len(stats.get("skipped", [])),
        "errors": len(stats.get("error", [])),
    }
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "suite": "resq_firmware_unity",
        "target": "esp32c3",
        "exit_status": int(exitstatus),
        "counts": counts,
    }
    Path("resq_firmware_unity_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
