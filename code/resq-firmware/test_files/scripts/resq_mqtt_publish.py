import argparse
import json
import subprocess
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Publish MQTT JSON command to ResQ firmware.")
    parser.add_argument("--broker", default="localhost")
    parser.add_argument("--port", default="1883")
    parser.add_argument("--device", default="resq-node-01")
    parser.add_argument("--suffix", required=True, help="Command suffix, e.g. cmd/diag/ping")

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--json", help="JSON payload string")
    group.add_argument("--json-file", help="Path to JSON payload file")

    args = parser.parse_args()

    topic = f"resq/manikins/{args.device}/{args.suffix}"

    try:
        if args.json_file:
            raw_json = Path(args.json_file).read_text(encoding="utf-8-sig")
        else:
            raw_json = args.json

        payload = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON before publish: {exc}", file=sys.stderr)
        print("Received raw JSON:")
        print(raw_json)
        sys.exit(2)

    message = json.dumps(payload, separators=(",", ":"))

    print("Publishing topic:")
    print(topic)
    print("Publishing payload:")
    print(message)

    subprocess.run([
        "mosquitto_pub",
        "-h", args.broker,
        "-p", str(args.port),
        "-q", "1",
        "-t", topic,
        "-m", message,
    ], check=True)

if __name__ == "__main__":
    main()
