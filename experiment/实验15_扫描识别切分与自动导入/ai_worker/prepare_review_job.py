#!/usr/bin/env python3
"""Prepare a small, traceable photo-hint job from an extracted scan bundle.

This follows the copied scan-to-threejs prepare_photos.py orientation convention.
It never edits the bundle, converted room, original images, or source-face ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile

from PIL import Image


EXPERIMENT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = EXPERIMENT.parent / ".private"
BASELINE_SKILL = EXPERIMENT / "skill-baseline" / "scan-to-threejs"
INSTANCE_SKILL = EXPERIMENT / ".agents" / "skills" / "scan-to-instance-proposals" / "SKILL.md"
MAX_IMAGES = 12
MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
DEFAULT_CATEGORIES = ("sofa", "chair", "table", "storage", "cabinet",
                      "bed", "other_furniture", "unknown")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _inside(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("photo file must be a relative path")
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("photo file escapes extracted bundle")
    return path


def _finite_vector(value, length: int) -> bool:
    return isinstance(value, list) and len(value) == length and all(
        isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
        for x in value)


def prepare_review_job(*, bundle: Path, converted: Path, output: Path,
                       indices: list[int], scan_id: str, max_edge: int = 960,
                       private_root: Path = PRIVATE_ROOT,
                       baseline_skill: Path = BASELINE_SKILL,
                       instance_skill: Path = INSTANCE_SKILL) -> dict:
    """Return a manifest of selected upright previews and original source IDs."""
    bundle = Path(bundle).resolve(strict=True)
    converted = Path(converted).resolve(strict=True)
    private_root = Path(private_root).resolve(strict=True)
    output = Path(output)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", scan_id):
        raise ValueError("scan_id must be a safe stable identifier")
    if (not indices or len(indices) > MAX_IMAGES or
            any(not isinstance(i, int) or isinstance(i, bool) or i < 0 for i in indices) or
            len(set(indices)) != len(indices)):
        raise ValueError("select between one and twelve unique photo indices")
    if not 128 <= max_edge <= 2048:
        raise ValueError("max_edge must be between 128 and 2048")
    if not output.resolve().is_relative_to(private_root) or output.exists():
        raise ValueError("output must be a new directory under experiment/.private")
    if not bundle.is_dir() or not converted.is_file():
        raise ValueError("extracted bundle and converted room are required")

    room = json.loads(converted.read_text(encoding="utf-8"))
    photos = room.get("photos")
    if not isinstance(photos, list) or any(i >= len(photos) for i in indices):
        raise ValueError("selected index is absent from converted room")
    raw_index = _inside(bundle, "photos/photos.json")
    raw_rows = json.loads(raw_index.read_text(encoding="utf-8"))
    if not isinstance(raw_rows, list):
        raise ValueError("raw photo index must be an array")
    raw_by_file = {row["file"]: row for row in raw_rows if isinstance(row, dict)
                   and isinstance(row.get("file"), str)}
    if len(raw_by_file) != len(raw_rows):
        raise ValueError("raw photo IDs are missing or duplicated")
    if not baseline_skill.is_dir() or not instance_skill.is_file():
        raise ValueError("copied baseline and instance skills are required")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="e15-photo-job-", dir=output.parent) as temporary:
        stage = Path(temporary) / "job"
        (stage / "photo-previews").mkdir(parents=True, mode=0o700)
        stage.chmod(0o700)
        shutil.copytree(baseline_skill, stage / "skill-baseline" / "scan-to-threejs")
        new_skill = stage / ".agents" / "skills" / "scan-to-instance-proposals" / "SKILL.md"
        new_skill.parent.mkdir(parents=True)
        shutil.copy2(instance_skill, new_skill)
        entries = []
        for index in indices:
            converted_photo = photos[index]
            if not isinstance(converted_photo, dict):
                raise ValueError("converted photo entry must be an object")
            photo_id = converted_photo.get("file")
            source = _inside(bundle, photo_id)
            raw = raw_by_file.get(photo_id)
            if raw is None:
                raise ValueError("converted photo is absent from raw photo index")
            if (not _finite_vector(raw.get("intrinsics"), 9) or
                    not _finite_vector(raw.get("transform"), 16) or
                    any(not _finite_vector(converted_photo.get(k), 3)
                        for k in ("position", "forward", "up")) or
                    not isinstance(converted_photo.get("fovY"), (int, float)) or
                    not isinstance(converted_photo.get("aspect"), (int, float)) or
                    not math.isfinite(converted_photo["fovY"]) or
                    not math.isfinite(converted_photo["aspect"]) or
                    converted_photo["fovY"] <= 0 or converted_photo["aspect"] <= 0):
                raise ValueError("selected photo lacks usable calibration or pose")
            if source.stat().st_size > MAX_SOURCE_IMAGE_BYTES:
                raise ValueError("selected source photo exceeds size limit")
            preview_file = "photo-previews/%04d.jpg" % index
            with Image.open(source) as original:
                width, height = original.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise ValueError("selected source photo exceeds pixel limit")
                if raw.get("width") != width or raw.get("height") != height:
                    raise ValueError("raw photo index size disagrees with image")
                original.load()
                # Original sensor -X is upright camera up in the copied skill.
                # EXIF transpose here would rotate the image twice.
                preview = original.convert("RGB").transpose(Image.Transpose.ROTATE_270)
                preview.thumbnail((max_edge, max_edge))
                preview.save(stage / preview_file, quality=90)
                preview_size = list(preview.size)
            entries.append({
                "photoId": photo_id, "photoIndex": index,
                "previewFile": preview_file,
                "sourceSha256": _sha256(source),
                "previewSha256": _sha256(stage / preview_file),
                "sensorSize": [width, height], "previewSize": preview_size,
                "previewTransform": "sensor rotate clockwise 90 degrees, then thumbnail",
                "rawIntrinsics": raw.get("intrinsics"),
                "rawCameraTransform": raw.get("transform"),
                "convertedPose": {k: converted_photo.get(k) for k in
                                  ("position", "forward", "up", "fovY", "aspect")},
            })
        evidence = {"schemaVersion": 1, "scanId": scan_id,
                    "allowedCategories": list(DEFAULT_CATEGORIES), "photos": entries,
                    "reviewPurpose": "Unreviewed 2D furniture hints only; no PLY owners or unseen geometry"}
        (stage / "evidence.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        manifest = {"schemaVersion": 1, "scanId": scan_id,
                    "convertedSha256": _sha256(converted),
                    "rawPhotoIndexSha256": _sha256(raw_index),
                    "baselineSkillSha256": _sha256(baseline_skill / "SKILL.md"),
                    "instanceSkillSha256": _sha256(instance_skill),
                    "selectedPhotoCount": len(entries),
                    "selectedPhotoIds": [entry["photoId"] for entry in entries]}
        (stage / "job-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if output.exists():
            raise ValueError("output directory was created concurrently")
        stage.rename(output)
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--converted", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--scan-id", required=True)
    parser.add_argument("--indices", required=True, type=int, nargs="+")
    parser.add_argument("--max-edge", type=int, default=960)
    args = parser.parse_args(argv)
    try:
        result = prepare_review_job(bundle=args.bundle, converted=args.converted,
                                    output=args.output, indices=args.indices,
                                    scan_id=args.scan_id, max_edge=args.max_edge)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(json.dumps({"scanId": result["scanId"],
                      "selectedPhotoCount": result["selectedPhotoCount"]},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
