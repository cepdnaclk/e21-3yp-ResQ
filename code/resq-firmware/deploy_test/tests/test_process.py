from __future__ import annotations

import sys
from pathlib import Path

import pytest

from resq_deploy_test.process import CommandError, CommandRunner


def test_command_runner_redacts_transcript(tmp_path: Path) -> None:
    transcript = tmp_path / "commands.log"
    runner = CommandRunner(transcript, ["top-secret"])
    result = runner.run([sys.executable, "-c", "print('top-secret')"])
    assert result.stdout.strip() == "***REDACTED***"
    assert "top-secret" not in transcript.read_text(encoding="utf-8")


def test_command_runner_raises_for_failure() -> None:
    with pytest.raises(CommandError):
        CommandRunner().run([sys.executable, "-c", "raise SystemExit(3)"])
