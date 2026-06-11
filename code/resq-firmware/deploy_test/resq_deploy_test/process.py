from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


class CommandError(RuntimeError):
    def __init__(self, result: CommandResult):
        super().__init__(f"command failed ({result.returncode}): {' '.join(result.command)}")
        self.result = result


class CommandRunner:
    def __init__(self, transcript: Path | None = None, secrets: Iterable[str] = ()):
        self.transcript = transcript
        self.secrets = tuple(secret for secret in secrets if secret)

    def redact(self, text: str) -> str:
        for secret in self.secrets:
            text = text.replace(secret, "***REDACTED***")
        return text

    def run(
        self,
        command: list[str],
        *,
        cwd: Path | None = None,
        timeout: float = 120,
        check: bool = True,
        env: dict[str, str] | None = None,
    ) -> CommandResult:
        if not command or not all(isinstance(part, str) and part for part in command):
            raise ValueError("command must be a non-empty argument list")
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=merged_env,
            timeout=timeout,
            text=True,
            capture_output=True,
            shell=False,
        )
        result = CommandResult(
            command=list(command),
            returncode=completed.returncode,
            stdout=self.redact(completed.stdout),
            stderr=self.redact(completed.stderr),
        )
        if self.transcript:
            self.transcript.parent.mkdir(parents=True, exist_ok=True)
            with self.transcript.open("a", encoding="utf-8") as handle:
                handle.write(f"$ {self.redact(' '.join(command))}\n")
                handle.write(result.stdout)
                handle.write(result.stderr)
                handle.write(f"\n[exit {result.returncode}]\n")
        if check and result.returncode:
            raise CommandError(result)
        return result
