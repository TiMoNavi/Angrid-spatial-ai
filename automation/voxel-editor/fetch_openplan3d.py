#!/usr/bin/env python3
"""Restore only missing pinned upstream files; never overwrite local modifications."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path, PurePosixPath
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent
DEFAULT_TARGET = HERE.parent.parent / "reference" / "openPlan3D"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(target, relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError(f"Unsafe manifest path: {relative}")
    result = target.joinpath(*path.parts)
    if not result.resolve().is_relative_to(target.resolve()):
        raise ValueError(f"Path escapes destination: {relative}")
    if result.is_symlink():
        raise ValueError(f"Refusing symlink: {relative}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Download the pinned archive to restore missing files")
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    args = parser.parse_args()
    manifest = json.loads((HERE / "openplan3d-upstream-manifest.json").read_text())
    entries = manifest["files"]
    target = args.target.expanduser().resolve()
    paths = {entry["path"]: safe_path(target, entry["path"]) for entry in entries}
    missing, modified = [], []
    for entry in entries:
        path = paths[entry["path"]]
        if not path.exists():
            missing.append(entry["path"])
        elif not path.is_file() or digest(path.read_bytes()) != entry["sha256"]:
            modified.append(entry["path"])
    if modified:
        raise ValueError(f"Local upstream files differ; no files written: {modified}")
    restored = 0
    if missing and args.fetch:
        revision = manifest["revision"]
        url = f"https://codeload.github.com/laanlabs/openPlan3D/tar.gz/{revision}"
        with urlopen(url, timeout=60) as response:
            data = response.read()
        # Verify every archive file before writing anything. Never extract paths from the archive.
        content = {}
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                relative = str(PurePosixPath(*PurePosixPath(member.name).parts[1:]))
                if relative in content:
                    raise ValueError(f"Duplicate archive entry: {relative}")
                content[relative] = archive.extractfile(member).read()
        if set(content) != set(paths):
            raise ValueError("Pinned archive file list differs from manifest; no files written")
        for entry in entries:
            if digest(content[entry["path"]]) != entry["sha256"]:
                raise ValueError(f"Archive checksum mismatch: {entry['path']}; no files written")
        for relative in missing:
            path = safe_path(target, relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation also protects changes made since the initial check.
            with path.open("xb") as output:
                output.write(content[relative])
            restored += 1
        missing = []
    print(json.dumps({"ok": not missing, "revision": manifest["revision"],
                      "verifiedFiles": len(entries) - len(missing), "restoredFiles": restored,
                      "missing": missing, "target": str(target),
                      "note": "Extra local files and dependencies are outside verification; reference files were not overwritten."},
                     ensure_ascii=False, indent=2))
    return 1 if missing else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, tarfile.TarError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
