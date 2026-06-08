from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

Status = Literal["PASS", "FAIL", "SKIP"]


@dataclass
class Check:
    phase: str
    name: str
    status: Status
    detail: str
    required: bool = True
    duration_seconds: float = 0.0


class QualificationReport:
    def __init__(self, output_dir: Path, metadata: dict[str, object] | None = None):
        self.output_dir = output_dir
        self.metadata = metadata or {}
        self.started_at = datetime.now(timezone.utc)
        self.finished_at: datetime | None = None
        self.checks: list[Check] = []

    def add(self, phase: str, name: str, status: Status, detail: str, *, required: bool = True, duration: float = 0) -> Check:
        check = Check(phase, name, status, detail, required, duration)
        self.checks.append(check)
        return check

    @property
    def outcome(self) -> str:
        if any(check.status == "FAIL" for check in self.checks):
            return "FAIL"
        if any(check.required and check.status == "SKIP" for check in self.checks):
            return "INCOMPLETE"
        return "PASS"

    def write(self) -> dict[str, Path]:
        self.finished_at = datetime.now(timezone.utc)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        stem = self.started_at.strftime("resq-deploy-%Y%m%dT%H%M%SZ")
        paths = {
            "json": self.output_dir / f"{stem}.json",
            "junit": self.output_dir / f"{stem}.xml",
            "markdown": self.output_dir / f"{stem}.md",
        }
        payload = {
            "outcome": self.outcome,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat(),
            "metadata": self.metadata,
            "checks": [asdict(check) for check in self.checks],
        }
        paths["json"].write_text(json.dumps(payload, indent=2), encoding="utf-8")

        suite = ET.Element("testsuite", {
            "name": "resq-firmware-deployment",
            "tests": str(len(self.checks)),
            "failures": str(sum(c.status == "FAIL" for c in self.checks)),
            "skipped": str(sum(c.status == "SKIP" for c in self.checks)),
        })
        for check in self.checks:
            case = ET.SubElement(suite, "testcase", {
                "classname": check.phase,
                "name": check.name,
                "time": f"{check.duration_seconds:.3f}",
            })
            if check.status == "FAIL":
                ET.SubElement(case, "failure", {"message": check.detail}).text = check.detail
            elif check.status == "SKIP":
                ET.SubElement(case, "skipped", {"message": check.detail})
            ET.SubElement(case, "system-out").text = check.detail
        ET.ElementTree(suite).write(paths["junit"], encoding="utf-8", xml_declaration=True)

        lines = [
            "# ResQ Firmware Deployment Qualification",
            "",
            f"**Outcome:** {self.outcome}",
            f"**Started:** {self.started_at.isoformat()}",
            f"**Finished:** {self.finished_at.isoformat()}",
            "",
            "| Phase | Check | Result | Required | Detail |",
            "|---|---|---:|---:|---|",
        ]
        for check in self.checks:
            detail = check.detail.replace("|", "\\|").replace("\n", " ")
            lines.append(f"| {check.phase} | {check.name} | {check.status} | {'yes' if check.required else 'no'} | {detail} |")
        paths["markdown"].write_text("\n".join(lines) + "\n", encoding="utf-8")
        return paths
