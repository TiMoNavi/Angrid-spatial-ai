#!/usr/bin/env python3
"""Prepare a small, traceable private photo set for furniture ownership review."""

import hashlib
import io
import json
from pathlib import Path
import zipfile

from PIL import Image, ImageOps


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ARCHIVE = ROOT.parent / "reference/案例office/Office 2.zip"
OUTPUT = ROOT / "experiment/.private/office-2-rescan/review"
INDICES = (62, 63, 65, 79, 88, 97)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    if not ARCHIVE.is_file():
        raise FileNotFoundError(ARCHIVE)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    rows = []
    with zipfile.ZipFile(ARCHIVE) as zf:
        photos = json.loads(zf.read("Room/photos/photos.json"))
        for index in INDICES:
            source = photos[index]["file"]
            if source.startswith("/") or ".." in Path(source).parts:
                raise ValueError("Unsafe photo path")
            raw = zf.read("Room/" + source)
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
            image.thumbnail((1280, 960))
            name = f"photo-{index:03d}.jpg"
            target = OUTPUT / name
            image.save(target, quality=86, optimize=True)
            rows.append({"photoIndex": index, "sourceFile": source,
                         "sourceSha256": sha256(raw), "previewFile": name,
                         "previewSha256": sha256(target.read_bytes()),
                         "purpose": "blue seating / office chair visual review"})
    (OUTPUT / "photo-index.json").write_text(
        json.dumps({"scanId": "office-2-rescan", "entries": rows},
                   ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("review photos:", len(rows), OUTPUT)


if __name__ == "__main__":
    main()
