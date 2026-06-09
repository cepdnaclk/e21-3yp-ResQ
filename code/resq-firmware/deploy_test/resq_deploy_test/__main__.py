from __future__ import annotations

import argparse
import sys

from .config import ConfigError, load_config
from .runner import QualificationRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="ResQ production firmware deployment qualification")
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run", help="run the complete production qualification")
    run.add_argument("--config", required=True, help="path to local TOML configuration")
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        return QualificationRunner(config).run()
    except (ConfigError, OSError, RuntimeError) as exc:
        print(f"configuration/startup error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
