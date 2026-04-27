#!/usr/bin/env python3
"""Generate two ResQ presentation QR files.

QR1: Wi-Fi join for ESP AP (ResQ-Setup)
QR2: One-scan auto-provision POST to ESP endpoint (/provision)

Usage example:
  python scripts/generate_resq_qr.py \
    --wifi-ssid "MyDemoWifi" \
    --wifi-password "MyDemoPass" \
    --hub-ip 192.168.8.201

Optional logo:
  python scripts/generate_resq_qr.py ... --logo assets/resq-logo.png
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw


def escape_wifi_text(value: str) -> str:
    """Escape special chars for common Wi-Fi QR format."""
    escaped = value.replace("\\", "\\\\")
    for ch in [";", ",", ":", '"']:
        escaped = escaped.replace(ch, f"\\{ch}")
    return escaped


def build_wifi_qr_text(ssid: str, password: str, security: str = "WPA") -> str:
    return f"WIFI:T:{security};S:{escape_wifi_text(ssid)};P:{escape_wifi_text(password)};;"


def build_provision_payload(
    wifi_ssid: str,
    wifi_password: str,
    hub_ip: str,
    auth_token: str,
    device_id: str,
    manikin_id: str,
) -> dict:
    return {
        "ssid": wifi_ssid,
        "password": wifi_password,
        "server_url": f"http://{hub_ip}:18080/api/register",
        "auth_token": auth_token,
        "device_id": device_id,
        "manikin_id": manikin_id,
        "mqtt_host": hub_ip,
        "mqtt_port": 1883,
    }


def build_autopost_url(payload: dict, host: str = "192.168.4.1") -> str:
    """Build Google-Lens-friendly URL QR.

    The ESP provisioning root page is expected to read #p=<base64url-json>
    and auto-POST to /provision.
    """
    payload_json = json.dumps(payload, separators=(",", ":"))
    packed = base64.urlsafe_b64encode(payload_json.encode("utf-8")).decode("ascii").rstrip("=")
    return f"http://{host}/#p={packed}"


def add_center_logo(img: Image.Image, logo_path: Path) -> Image.Image:
    base = img.convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    logo_size = int(base.size[0] * 0.18)
    logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)

    x = (base.size[0] - logo_size) // 2
    y = (base.size[1] - logo_size) // 2

    draw = ImageDraw.Draw(base)
    pad = int(logo_size * 0.18)
    draw.rounded_rectangle(
        (x - pad, y - pad, x + logo_size + pad, y + logo_size + pad),
        radius=int(logo_size * 0.2),
        fill=(255, 255, 255, 245),
    )

    base.alpha_composite(logo, (x, y))
    return base.convert("RGB")


def make_qr(
    value: str,
    out_file: Path,
    logo: Path | None = None,
    error_correction: int = qrcode.constants.ERROR_CORRECT_H,
) -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=error_correction,
        box_size=14,
        border=4,
    )
    qr.add_data(value)
    qr.make(fit=True)

    img = qr.make_image(fill_color="#0f172a", back_color="white").convert("RGB")
    if logo is not None and logo.exists():
        img = add_center_logo(img, logo)

    out_file.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_file)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate two ResQ QR files.")

    p.add_argument("--out-dir", default="scripts/qr_output", help="Output folder for PNG files")

    p.add_argument("--ap-ssid", default="ResQ-Setup", help="ESP AP SSID for QR1")
    p.add_argument("--ap-password", default="resq-setup-1", help="ESP AP password for QR1")

    p.add_argument("--wifi-ssid", required=True, help="Target Wi-Fi SSID to provision into ESP")
    p.add_argument("--wifi-password", required=True, help="Target Wi-Fi password")
    p.add_argument("--hub-ip", required=True, help="Hub/LAN IP used in server_url and mqtt_host")
    p.add_argument("--auth-token", default="resq-demo-token", help="Provisioning auth token")
    p.add_argument("--device-id", default="resq-node-01", help="Optional fixed device_id")
    p.add_argument("--manikin-id", default="manikin-01", help="Optional fixed manikin_id")

    p.add_argument(
        "--logo",
        default=None,
        help="Optional logo image path (PNG recommended) to place in QR center",
    )

    return p.parse_args()


def main() -> None:
    args = parse_args()

    out_dir = Path(args.out_dir)
    logo = Path(args.logo) if args.logo else None

    wifi_qr_text = build_wifi_qr_text(args.ap_ssid, args.ap_password)
    payload = build_provision_payload(
        wifi_ssid=args.wifi_ssid,
        wifi_password=args.wifi_password,
        hub_ip=args.hub_ip,
        auth_token=args.auth_token,
        device_id=args.device_id,
        manikin_id=args.manikin_id,
    )
    autopost_url = build_autopost_url(payload)

    qr1_path = out_dir / "01_connect_resq_setup_wifi.png"
    qr2_path = out_dir / "02_auto_provision_post.png"
    payload_path = out_dir / "02_payload_preview.json"

    make_qr(
        wifi_qr_text,
        qr1_path,
        logo=logo,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
    )
    # QR2 is a normal URL for Google Lens compatibility.
    make_qr(
        autopost_url,
        qr2_path,
        logo=logo,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
    )
    payload_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("Generated files:")
    print(f"- {qr1_path}")
    print(f"- {qr2_path}")
    print(f"- {payload_path}")
    print()
    print("Scan flow:")
    print("1) Scan QR1 to join ResQ-Setup Wi-Fi")
    print("2) Scan QR2 to auto-send provisioning POST to http://192.168.4.1/provision")
    print("   (Requires firmware provisioning page support for #p payload)")


if __name__ == "__main__":
    main()
