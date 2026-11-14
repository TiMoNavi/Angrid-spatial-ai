#!/usr/bin/env python3
"""Replay the existing Office 2 import stages into a separate private scan ID.

This calls the experiment 1/4/9 implementations without modifying their code or
the original office-2 dataset. The archive is kept outside the Git repository.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
REPO = EXPERIMENT.parent
SCAN_ID = "office-2-rescan"
OUTPUT = EXPERIMENT / ".private" / SCAN_ID
DEFAULT_ARCHIVE = REPO.parent / "reference" / "案例office" / "Office 2.zip"
MARKER = OUTPUT / "source-archive.json"


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_source(archive: Path) -> dict:
    if not archive.is_file():
        raise FileNotFoundError(archive)
    with zipfile.ZipFile(archive) as bundle:
        required = {
            "Room/manifest.json", "Room/rooms/room-0.json",
            "Room/mesh/room-0.ply", "Room/depth/frames.json",
            "Room/photos/photos.json",
        }
        missing = required - set(bundle.namelist())
        if missing:
            raise ValueError("Missing archive entries: " + ", ".join(sorted(missing)))
        manifest = json.loads(bundle.read("Room/manifest.json"))
        frames = json.loads(bundle.read("Room/depth/frames.json"))
        photos = json.loads(bundle.read("Room/photos/photos.json"))
        if not frames or not photos:
            raise ValueError("The archive has no depth frames or photos")
        return {
            "scanId": SCAN_ID,
            "archive": str(archive.resolve()),
            "archiveSha256": source_hash(archive),
            "createdAt": manifest.get("createdAt"),
            "depthFrames": len(frames),
            "photos": len(photos),
        }


def check_existing(source: dict) -> None:
    if MARKER.is_file():
        previous = json.loads(MARKER.read_text(encoding="utf-8"))
        if previous["archiveSha256"] != source["archiveSha256"]:
            raise ValueError("The target belongs to another archive; refusing to overwrite it")
    elif OUTPUT.exists() and any(OUTPUT.iterdir()):
        raise ValueError("The target contains unmarked data; refusing to overwrite it")


def import_upstream(directory: Path, name: str):
    path = str(directory)
    if path not in sys.path:
        sys.path.insert(0, path)
    return __import__(name)


def run_base(archive: Path, source: dict) -> None:
    if MARKER.is_file():
        required = [OUTPUT / "converted.json", OUTPUT / "raw-mesh.ply",
                    OUTPUT / "source/Room/rooms/room-0.json"]
        if not all(path.is_file() for path in required):
            raise ValueError("The base import is incomplete; inspect it before retrying")
        print("base: already imported from the same archive")
        return
    importer = import_upstream(EXPERIMENT / "tools", "prepare_data")
    summary = importer.prepare_one(SCAN_ID, archive)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "rescan-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    MARKER.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("base:", summary["fileCount"], "files,", summary["depthFrameCount"],
          "frames,", summary["objects"], "RoomPlan objects")


def require_base() -> None:
    if not MARKER.is_file() or not (OUTPUT / "converted.json").is_file():
        raise ValueError("Run --stage base first")


def run_depth(archive: Path) -> None:
    require_base()
    import_upstream(EXPERIMENT / "实验4_扫描结果的体素网格转换",
                    "prepare_voxel_evidence").prepare(SCAN_ID, archive)


def run_fusion(archive: Path) -> None:
    require_base()
    import_upstream(EXPERIMENT / "实验4_扫描结果的体素网格转换",
                    "prepare_reference").prepare(SCAN_ID, archive)


def run_classify() -> None:
    require_base()
    upstream = import_upstream(EXPERIMENT / "实验9_先切分后分类体素",
                               "prepare_classified")
    inputs = (OUTPUT / "raw-mesh.ply", OUTPUT / "converted.json",
              OUTPUT / "source/Room/rooms/room-0.json")
    if not all(path.is_file() for path in inputs):
        raise ValueError("Classification inputs are incomplete")
    destination = OUTPUT / "derived-v1"
    args = argparse.Namespace(
        scan_id=SCAN_ID, source=inputs[0], room=inputs[1], roomplan=inputs[2],
        out=destination, margin=0.045, structure_distance=0.03,
        min_component_faces=25, compute_clutter=False,
        overrides=None, clutter_overrides=None,
    )
    upstream.prepare(args)
    manifest = json.loads((destination / "layer-manifest.json").read_text())
    if manifest["scanId"] != SCAN_ID or not manifest["layers"]:
        raise ValueError("Classification manifest has the wrong scan ID or no layers")
    print("classify:", len(manifest["objectMappings"]), "object mappings,",
          len(manifest["layers"]), "layers")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--stage", choices=("base", "depth", "fusion", "classify", "all"),
                        default="all")
    args = parser.parse_args()
    source = verified_source(args.archive)
    check_existing(source)
    for stage, function in (
        ("base", lambda: run_base(args.archive, source)),
        ("depth", lambda: run_depth(args.archive)),
        ("fusion", lambda: run_fusion(args.archive)),
        ("classify", run_classify),
    ):
        if args.stage in ("all", stage):
            print("stage:", stage, flush=True)
            function()


if __name__ == "__main__":
    main()
