#!/usr/bin/env python3
"""Safely import HouseCapture ZIPs; preserve source bytes and source-face identity."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from zipfile import BadZipFile, ZipFile

from probe_bundle import (
    BundleError, MAX_ENTRY_BYTES, MAX_JSON_BYTES, MAX_TOTAL_BYTES, listed_members, probe,
    relative_asset, sha256,
)


PRIVATE_ROOT = Path(__file__).resolve().parents[2] / ".private"
CONVERTER = (Path(__file__).resolve().parents[1] / "skill-baseline" /
             "scan-to-threejs" / "scripts" / "bundle_to_room.py")
SCAN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")


def read_json(path: Path, label: str):
    if path.is_file() and path.stat().st_size > MAX_JSON_BYTES:
        raise BundleError(f"{label} exceeds the JSON size limit")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise BundleError(f"{label} is invalid JSON") from exc


def posed_entry(row: dict) -> bool:
    def finite_number(value):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return False
        try:
            return math.isfinite(value)
        except (OverflowError, ValueError):
            return False
    def finite_numbers(values, count):
        return (isinstance(values, list) and len(values) == count and
                all(finite_number(n) for n in values))
    return (finite_numbers(row.get("transform"), 16) and
            finite_numbers(row.get("intrinsics"), 9) and
            all(isinstance(row.get(key), int) and not isinstance(row[key], bool)
                and row[key] > 0 for key in ("width", "height")))


def index_status(index_path: str | None, prefix: str, members: dict,
                 source_root: Path, room_index: int, kind: str) -> dict:
    if not index_path:
        return {"indexPath": None, "entries": 0, "selectedRoomEntries": 0,
                "availableEntries": 0, "missingAssetCount": 0,
                "invalidMetadataCount": 0}
    data = read_json(source_root / index_path, kind + " index")
    if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
        raise BundleError(f"{kind} index must be an array of objects")
    selected = [row for row in data if row.get("room") == room_index]
    available = missing = invalid = 0
    for row in selected:
        asset = relative_asset(prefix, row.get("file"), members)
        if not asset:
            missing += 1
        elif posed_entry(row):
            available += 1
        else:
            invalid += 1
        if kind == "depth":
            for key in ("confidence", "rgb"):
                if row.get(key) and relative_asset(prefix, row[key], members) is None:
                    missing += 1
    return {"indexPath": "source/" + index_path, "entries": len(data),
            "selectedRoomEntries": len(selected), "availableEntries": available,
            "missingAssetCount": missing, "invalidMetadataCount": invalid}


def extract(archive: ZipFile, members: dict, source_root: Path) -> dict:
    assets = {}
    total = 0
    for name, info in sorted(members.items()):
        target = source_root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        actual = 0
        try:
            with archive.open(info) as incoming, target.open("xb") as outgoing:
                while chunk := incoming.read(1024 * 1024):
                    actual += len(chunk)
                    total += len(chunk)
                    if actual > MAX_ENTRY_BYTES or total > MAX_TOTAL_BYTES:
                        raise BundleError("ZIP extraction exceeded size limits")
                    outgoing.write(chunk)
                    digest.update(chunk)
        except (BadZipFile, EOFError) as exc:
            raise BundleError("ZIP member failed integrity check") from exc
        if actual != info.file_size:
            raise BundleError("ZIP member length changed during extraction")
        assets[name] = {"path": "source/" + name, "bytes": actual,
                        "sha256": digest.hexdigest()}
    return assets


def convert_room(source_root: Path, room_path: str, photo_path: str | None,
                 room_index: int, raw_room: dict, stage: Path) -> dict:
    if not isinstance(raw_room.get("walls"), list) or not raw_room["walls"]:
        return {"status": "unavailable", "reason": "roomplan-has-no-walls"}
    # Upstream script expects standard filenames; use a temporary normalized
    # view and leave original ZIP members untouched.
    view = stage / ".converter-view"
    (view / "rooms").mkdir(parents=True)
    shutil.copyfile(source_root / room_path, view / "rooms" / f"room-{room_index}.json")
    if photo_path:
        (view / "photos").mkdir()
        shutil.copyfile(source_root / photo_path, view / "photos" / "photos.json")
    output = stage / "converted.json"
    success = False
    try:
        result = subprocess.run(
            [sys.executable, str(CONVERTER), str(view), "--room", str(room_index),
             "-o", str(output)], capture_output=True, text=True, timeout=90, check=False)
        if result.returncode != 0 or not output.is_file():
            return {"status": "unavailable", "reason": "skill-converter-failed"}
        converted = read_json(output, "converted room")
        if not isinstance(converted, dict):
            return {"status": "unavailable", "reason": "invalid-room-transform"}
        matrix = converted.get("transform", {}).get("worldToRoom")
        if (not isinstance(matrix, list) or len(matrix) != 16 or
                any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in matrix)):
            return {"status": "unavailable", "reason": "invalid-room-transform"}
        success = True
        return {"status": "available", "path": "converted.json", "frame": "room-local-m",
                "sha256": sha256(output), "wallCount": len(converted.get("walls", [])),
                "objectCount": len(converted.get("objects", [])),
                "photoCount": len(converted.get("photos", []))}
    except (OSError, subprocess.TimeoutExpired, BundleError):
        return {"status": "unavailable", "reason": "skill-converter-failed"}
    finally:
        shutil.rmtree(view, ignore_errors=True)
        if not success:
            output.unlink(missing_ok=True)


def verify_existing(final: Path, expected_sha: str, room_index: int | None) -> dict:
    data = read_json(final / "import-manifest.json", "existing import manifest")
    archive = data.get("sourceArchive") or {}
    if (data.get("schemaVersion") != 1 or data.get("kind") != "house-capture-import" or
            archive.get("sha256") != expected_sha or
            (room_index is not None and data.get("roomIndex") != room_index)):
        raise BundleError("scanId already belongs to a different import")
    if not (final / "source-archive.zip").is_file() or sha256(final / "source-archive.zip") != expected_sha:
        raise BundleError("existing archive no longer matches its manifest")
    root = final.resolve()
    for descriptor in data.get("sourceFiles", {}).values():
        relative = descriptor.get("path")
        if not isinstance(relative, str) or not relative.startswith("source/"):
            raise BundleError("existing import manifest contains an unsafe asset path")
        path = (final / relative).resolve()
        if (not path.is_relative_to(root) or not path.is_file() or
                path.stat().st_size != descriptor.get("bytes") or
                sha256(path) != descriptor.get("sha256")):
            raise BundleError("existing import has missing or altered source assets")
    converted = data.get("converted", {})
    if converted.get("status") == "available":
        output = (final / converted.get("path", "")).resolve()
        if (not output.is_relative_to(root) or not output.is_file() or
                sha256(output) != converted.get("sha256")):
            raise BundleError("existing import has an altered converted room")
    return data


def import_bundle(zip_file: Path, scan_id: str, room_index: int | None = None,
                  private_root: Path = PRIVATE_ROOT) -> dict:
    if not SCAN_ID.fullmatch(scan_id):
        raise BundleError("scanId must be 1-64 safe ASCII letters, digits, hyphens or underscores")
    private_root = Path(private_root)
    if private_root.name != ".private" or private_root.is_symlink():
        raise BundleError("imports must stay inside a non-symlink .private directory")
    private_root.mkdir(parents=True, exist_ok=True)
    report = probe(Path(zip_file))
    rooms = report["rooms"]
    if room_index is None:
        if len(rooms) != 1:
            raise BundleError("multi-room ZIP requires --room-index")
        room_index = rooms[0]["index"]
    selected = next((row for row in rooms if row["index"] == room_index), None)
    if selected is None:
        raise BundleError("selected room index is absent from manifest")
    mesh_path = selected["rawMeshPly"] or report["globalRawMeshPly"]
    final = private_root / scan_id
    if final.is_symlink():
        raise BundleError("scanId destination must not be a symlink")
    if final.exists():
        return verify_existing(final, report["zipSha256"], room_index)
    lock = private_root / f".{scan_id}.import.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise BundleError("another import job is using this scanId") from exc
    try:
        os.close(fd)
        with tempfile.TemporaryDirectory(prefix=f".{scan_id}.staging-", dir=private_root) as tmp:
            stage = Path(tmp)
            archive_copy = stage / "source-archive.zip"
            shutil.copyfile(zip_file, archive_copy)
            if sha256(archive_copy) != report["zipSha256"]:
                raise BundleError("source ZIP changed after preflight")
            with ZipFile(archive_copy) as archive:
                members = listed_members(archive)
                assets = extract(archive, members, stage / "source")
            raw_room = read_json(stage / "source" / selected["roomJson"], "RoomPlan room")
            if (not isinstance(raw_room, dict) or
                    not isinstance(raw_room.get("walls"), list) or
                    not isinstance(raw_room.get("objects"), list)):
                raise BundleError("RoomPlan room must contain walls and objects arrays")
            prefix = str(Path(report["manifestPath"]).parent)
            if prefix == ".":
                prefix = ""
            photos = index_status(report["photoIndex"], prefix, members,
                                  stage / "source", room_index, "photo")
            depth = index_status(report["depthIndex"], prefix, members,
                                 stage / "source", room_index, "depth")
            converted = convert_room(stage / "source", selected["roomJson"],
                                     report["photoIndex"], room_index, raw_room, stage)
            warnings = list(report["warnings"])
            if photos["availableEntries"] == 0:
                warnings.append("No usable posed photos; AI photo hints disabled")
            if depth["availableEntries"] == 0:
                warnings.append("No usable depth frames; depth projection disabled")
            if photos["missingAssetCount"] or depth["missingAssetCount"]:
                warnings.append("Some indexed photo/depth assets are missing")
            if photos["invalidMetadataCount"] or depth["invalidMetadataCount"]:
                warnings.append("Some indexed photo/depth frames lack valid pose or intrinsics")
            if converted["status"] != "available":
                warnings.append("Room-local conversion unavailable: " + converted["reason"])
            manifest = {
                "schemaVersion": 1, "kind": "house-capture-import", "scanId": scan_id,
                "sourceArchive": {"path": "source-archive.zip", "name": Path(zip_file).name,
                                  "sha256": report["zipSha256"], "bytes": report["zipBytes"]},
                "sourceFormat": report["format"], "manifestPath": "source/" + report["manifestPath"],
                "roomIndex": room_index, "rooms": rooms,
                "assetPaths": {
                    "roomPlanJson": "source/" + selected["roomJson"],
                    "rawMeshPly": "source/" + mesh_path if mesh_path else None,
                    "photoIndex": "source/" + report["photoIndex"] if report["photoIndex"] else None,
                    "depthIndex": "source/" + report["depthIndex"] if report["depthIndex"] else None,
                    "capturedRoomData": "source/" + selected["capturedRoomData"] if selected["capturedRoomData"] else None,
                },
                "sourceMeshFrame": "capture-session-world-m", "sourceFiles": assets,
                "photoIndex": photos, "depthIndex": depth,
                "roomPlanObjectCount": len(raw_room.get("objects", [])),
                "roomPlanWallCount": len(raw_room.get("walls", [])), "converted": converted,
                "capabilities": {
                    "roomPlan": True, "roomPlanGeometry": bool(raw_room.get("walls")),
                    "rawMeshPly": bool(mesh_path),
                    "posedPhotos": photos["availableEntries"] > 0,
                    "depthFrames": depth["availableEntries"] > 0,
                    "appleRoomBuilderData": bool(selected["capturedRoomData"]),
                    "roomLocalCoordinates": converted["status"] == "available",
                }, "warnings": warnings,
            }
            (stage / "import-manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
                encoding="utf-8")
            if final.exists():
                raise BundleError("scanId appeared during import; choose another ID")
            os.replace(stage, final)
            return manifest
    finally:
        lock.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_file", type=Path)
    parser.add_argument("--scan-id", required=True)
    parser.add_argument("--room-index", type=int)
    args = parser.parse_args()
    try:
        data = import_bundle(args.zip_file, args.scan_id, args.room_index)
    except BundleError as exc:
        parser.error(str(exc))
    print(json.dumps({"scanId": data["scanId"], "roomIndex": data["roomIndex"],
                      "sourceArchiveSha256": data["sourceArchive"]["sha256"],
                      "sourceFileCount": len(data["sourceFiles"]),
                      "photoCount": data["photoIndex"]["availableEntries"],
                      "depthCount": data["depthIndex"]["availableEntries"],
                      "converted": data["converted"]["status"],
                      "importManifest": str(PRIVATE_ROOT / args.scan_id / "import-manifest.json")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
