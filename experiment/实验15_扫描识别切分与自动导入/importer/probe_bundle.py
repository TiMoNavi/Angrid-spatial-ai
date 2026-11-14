#!/usr/bin/env python3
"""Safely inventory a HouseCapture ZIP before any extraction or AI work."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
from zipfile import BadZipFile, ZipFile, ZipInfo


MAX_ENTRIES = 10000
MAX_TOTAL_BYTES = 4 * 1024**3
MAX_ENTRY_BYTES = 2 * 1024**3
MAX_JSON_BYTES = 8 * 1024**2
MAX_RATIO = 2000


class BundleError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024**2), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(info: ZipInfo) -> str:
    name = info.filename
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        raise BundleError("ZIP contains an unsafe member path")
    parts = PurePosixPath(name).parts
    if (any(part in (".", "..") for part in parts) or not parts or
            ":" in parts[0] or PurePosixPath(name.rstrip("/")).as_posix() != name.rstrip("/")):
        raise BundleError("ZIP contains a traversal member path")
    mode = (info.external_attr >> 16) & 0o170000
    if mode == stat.S_IFLNK or info.flag_bits & 1:
        raise BundleError("ZIP contains a link or encrypted member")
    if info.file_size > MAX_ENTRY_BYTES:
        raise BundleError("ZIP member exceeds the size limit")
    if info.file_size > 1024**2 and info.file_size / max(info.compress_size, 1) > MAX_RATIO:
        raise BundleError("ZIP member exceeds the compression-ratio limit")
    return name.rstrip("/")


def listed_members(archive: ZipFile) -> dict[str, ZipInfo]:
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES:
        raise BundleError("ZIP contains too many entries")
    result: dict[str, ZipInfo] = {}
    folded: set[str] = set()
    total = 0
    for info in infos:
        name = safe_name(info)
        folded_name = name.casefold()
        if folded_name in folded:
            raise BundleError("ZIP contains duplicate or case-colliding paths")
        folded.add(folded_name)
        total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise BundleError("ZIP uncompressed size exceeds the limit")
        if not info.is_dir():
            result[name] = info
    return result


def read_json(archive: ZipFile, info: ZipInfo) -> dict:
    if info.file_size > MAX_JSON_BYTES:
        raise BundleError("ZIP manifest exceeds the JSON limit")
    try:
        data = json.loads(archive.read(info).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise BundleError("ZIP manifest is invalid JSON") from exc
    if not isinstance(data, dict):
        raise BundleError("ZIP manifest must be an object")
    return data


def relative_asset(prefix: str, raw: object, members: dict[str, ZipInfo]) -> str | None:
    if isinstance(raw, dict):
        raw = raw.get("file")
    if not isinstance(raw, str) or not raw:
        return None
    parts = PurePosixPath(raw).parts
    if (raw.startswith("/") or "\\" in raw or any(part in (".", "..") for part in parts) or
            (parts and ":" in parts[0]) or PurePosixPath(raw).as_posix() != raw):
        raise BundleError("Manifest contains an unsafe asset path")
    path = str(PurePosixPath(prefix, raw)) if prefix else raw
    return path if path in members else None


def probe(path: Path) -> dict:
    if not path.is_file():
        raise BundleError("ZIP file does not exist")
    try:
        with ZipFile(path) as archive:
            members = listed_members(archive)
            manifests: list[tuple[str, dict]] = []
            for name, info in members.items():
                if PurePosixPath(name).name == "manifest.json":
                    data = read_json(archive, info)
                    if isinstance(data.get("rooms"), list):
                        manifests.append((name, data))
            if len(manifests) != 1:
                raise BundleError("Expected exactly one HouseCapture room manifest")
            manifest_path, manifest = manifests[0]
            prefix = str(PurePosixPath(manifest_path).parent)
            if prefix == ".":
                prefix = ""
            rooms = []
            for room in manifest["rooms"]:
                if not isinstance(room, dict) or not isinstance(room.get("index"), int):
                    raise BundleError("Manifest room index is missing")
                room_json = relative_asset(prefix, room.get("file"), members)
                mesh = relative_asset(prefix, room.get("mesh"), members)
                raw_data = relative_asset(prefix, room.get("data"), members)
                if not room_json:
                    raise BundleError("Manifest references a missing room JSON")
                rooms.append({"index": room["index"], "roomJson": room_json,
                              "rawMeshPly": mesh if mesh and mesh.lower().endswith(".ply") else None,
                              "capturedRoomData": raw_data})
            if len({row["index"] for row in rooms}) != len(rooms):
                raise BundleError("Manifest contains duplicate room indices")
            photo_index = relative_asset(prefix, manifest.get("photos"), members)
            depth_index = relative_asset(prefix, manifest.get("depthFrames"), members)
            mesh = relative_asset(prefix, manifest.get("mesh"), members)
            capability = {"roomPlan": bool(rooms),
                          "rawMeshPly": any(row["rawMeshPly"] for row in rooms) or bool(mesh and mesh.lower().endswith(".ply")),
                          "posedPhotos": bool(photo_index), "depthFrames": bool(depth_index),
                          "appleRoomBuilderData": any(row["capturedRoomData"] for row in rooms)}
            warnings = [f"Missing {name}; dependent stages must be disabled" for name, available in capability.items() if not available]
            digest = sha256(path)
            return {"schemaVersion": 1, "scanIdSuggestion": "scan-" + digest[:12],
                    "zipSha256": digest, "zipBytes": path.stat().st_size,
                    "entryCount": len(archive.infolist()), "manifestPath": manifest_path,
                    "format": manifest.get("format"), "rooms": rooms,
                    "photoIndex": photo_index, "depthIndex": depth_index,
                    "photoCountReported": manifest.get("photoCount"),
                    "depthFrameCountReported": manifest.get("depthFrameCount"),
                    "capabilities": capability, "warnings": warnings,
                    "strategy": "apple-raw-data-available" if capability["appleRoomBuilderData"] else "own-ply-photo-depth-segmentation"}
    except BadZipFile as exc:
        raise BundleError("Invalid ZIP archive") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_file", type=Path)
    args = parser.parse_args()
    print(json.dumps(probe(args.zip_file), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
