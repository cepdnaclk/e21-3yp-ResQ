from __future__ import annotations

import threading
import time
from pathlib import Path


class SerialCapture:
    def __init__(self, port: str, baud_rate: int, output: Path):
        self.port = port
        self.baud_rate = baud_rate
        self.output = output
        self.lines: list[tuple[float, str]] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._serial = None

    def start(self) -> None:
        try:
            import serial
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("pyserial is required") from exc
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self._serial = serial.Serial(self.port, self.baud_rate, timeout=0.2)
        self._thread = threading.Thread(target=self._read_loop, name="resq-serial", daemon=True)
        self._thread.start()

    def _read_loop(self) -> None:
        with self.output.open("a", encoding="utf-8") as handle:
            while not self._stop.is_set():
                raw = self._serial.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").rstrip()
                timestamp = time.time()
                self.lines.append((timestamp, line))
                handle.write(f"{timestamp:.3f} {line}\n")
                handle.flush()

    def wait_for(self, text: str, timeout: float, *, after: float = 0) -> str | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for timestamp, line in self.lines:
                if timestamp >= after and text in line:
                    return line
            time.sleep(0.1)
        return None

    def close(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if self._serial:
            self._serial.close()
