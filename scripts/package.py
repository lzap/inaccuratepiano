#!/usr/bin/env python3
"""Validate and create a Chrome Web Store ZIP with manifest.json at its root."""

import argparse
import json
from pathlib import Path
import struct
import zipfile


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "manifest.json", "popup.html", "popup.css", "popup.js", "content.js",
    "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
]


def validate():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        raise ValueError("manifest.json must use Manifest V3")
    for name in FILES:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)
    for size in (16, 32, 48, 128):
        data = (ROOT / f"icons/icon-{size}.png").read_bytes()
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or \
                struct.unpack(">II", data[16:24]) != (size, size):
            raise ValueError(f"Invalid {size}px PNG icon")
    print("Extension files and manifest validated.")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate without creating a ZIP")
    args = parser.parse_args()
    manifest = validate()
    if args.check:
        return
    output = ROOT / "dist" / f"inaccurate-piano-midi-{manifest['version']}.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            info = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    print(f"Created {output}")


if __name__ == "__main__":
    main()
