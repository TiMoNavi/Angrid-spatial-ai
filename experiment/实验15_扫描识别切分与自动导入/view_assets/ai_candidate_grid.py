#!/usr/bin/env python3
"""Voxelize review-only AI photo projections into one source-bound display layer.

Cells carry candidate owners, never accepted owners. The source PLY face ledger
remains authoritative; these surface boxes are not filled furniture geometry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

import numpy as np
import trimesh

from prepare import FINE, PRIVATE, STEPS, sha256, surface_cells


PROVENANCE = "measured PLY surface selected by unreviewed AI photo/depth proposal"
KIND = "ai-candidate-voxel-review"


def transform_hash(values: list[float]) -> str:
    numbers = [int(n) if float(n).is_integer() else float(n) for n in values]
    return hashlib.sha256(json.dumps(numbers, separators=(",", ":")).encode()).hexdigest()


def _face_ids(row: dict, field: str, face_count: int) -> np.ndarray:
    raw = row.get(field)
    if not isinstance(raw, list) or any(type(value) is not int for value in raw):
        raise ValueError(field + " must be a source-face integer array")
    ids = np.asarray(raw, dtype=np.int64)
    if np.any(ids < 0) or np.any(ids >= face_count) or len(np.unique(ids)) != len(ids):
        raise ValueError(field + " contains an invalid or duplicate source face ID")
    return ids


def validated_proposals(projection: dict, source_hash: str, transform_id: str,
                        face_count: int, assignments: dict):
    if (projection.get("schemaVersion") != 1 or projection.get("frame") != "room-local-m" or
            projection.get("sourceHash") != source_hash or
            projection.get("transformHash") != transform_id or
            projection.get("sourceFaceCount") != face_count or
            projection.get("originalOwnerAssignmentsPreserved") is not True or
            not isinstance(projection.get("proposals"), list)):
        raise ValueError("Photo projection does not match this immutable source and transform")
    if assignments.get("sourceHash") != source_hash:
        raise ValueError("v1 face assignments do not match this source PLY")
    buckets = assignments.get("sourceFaceIdsByAssignment")
    if not isinstance(buckets, dict):
        raise ValueError("v1 source-face buckets are missing")
    protected = np.zeros(face_count, dtype=bool)
    for bucket in ("structure", "excluded", "rejected-noise"):
        ids = _face_ids({bucket: buckets.get(bucket, [])}, bucket, face_count)
        protected[ids] = True
    result, seen = [], set()
    for row in projection["proposals"]:
        if not isinstance(row, dict) or not isinstance(row.get("instanceId"), str):
            raise ValueError("Photo proposal needs a stable instance ID")
        identifier = row["instanceId"]
        if identifier in seen:
            raise ValueError("Photo proposal IDs must be unique")
        seen.add(identifier)
        categories = row.get("categoryCandidates")
        if (not isinstance(categories, list) or len(categories) != 1 or
                not isinstance(categories[0], str) or not categories[0]):
            raise ValueError("Photo proposal needs one stated category candidate")
        if row.get("reviewState") != "unreviewed" or row.get("ownershipState") != "unchanged-v1":
            raise ValueError("Only unreviewed proposals with untouched original owners are displayable")
        ids = _face_ids(row, "sourceFaceIds", face_count)
        conflicts = _face_ids(row, "existingOwnerConflictSourceFaceIds", face_count)
        if row.get("sourceFaceCount") != len(ids) or row.get("existingOwnerConflictFaceCount") != len(conflicts):
            raise ValueError("Photo proposal source-face counts disagree with its arrays")
        if protected[ids].any() or not np.isin(conflicts, ids).all():
            raise ValueError("Photo proposal leaks protected structure or has invalid owner conflicts")
        result.append((identifier, categories[0], row.get("photoId"), ids, conflicts))
    return result


def _merge(meta: dict, owner: str, category: str, photo_id: str | None, conflict: bool):
    meta["candidateOwners"].add(owner)
    meta["categories"].add(category)
    if isinstance(photo_id, str):
        meta["photoIds"].add(photo_id)
    meta["hasExistingOwnerConflict"] |= conflict


def candidate_grids(vertices: np.ndarray, faces: np.ndarray, proposals: list):
    fine: dict[tuple[int, int, int], dict] = {}
    for identifier, category, photo_id, ids, conflicts in proposals:
        if not len(ids):
            continue
        cells = surface_cells(vertices, faces[ids])
        for cell in cells:
            key = tuple(int(value) for value in cell)
            meta = fine.setdefault(key, {"candidateOwners": set(), "categories": set(),
                                         "photoIds": set(), "hasExistingOwnerConflict": False})
            _merge(meta, identifier, category, photo_id, False)
        if len(conflicts):
            for cell in surface_cells(vertices, faces[conflicts]):
                key = tuple(int(value) for value in cell)
                fine[key]["hasExistingOwnerConflict"] = True
    if not fine:
        raise ValueError("Photo projections have no displayable source-face surface")
    grids, coordinates = {}, {}
    for step in STEPS:
        ratio = round(step / FINE)
        coarse: dict[tuple[int, int, int], dict] = {}
        for fine_key, source in fine.items():
            key = tuple(index // ratio for index in fine_key)
            meta = coarse.setdefault(key, {"candidateOwners": set(), "categories": set(),
                                           "photoIds": set(), "hasExistingOwnerConflict": False})
            meta["candidateOwners"].update(source["candidateOwners"])
            meta["categories"].update(source["categories"])
            meta["photoIds"].update(source["photoIds"])
            meta["hasExistingOwnerConflict"] |= source["hasExistingOwnerConflict"]
        coordinates[str(step)] = set(coarse)
        cells = [{"centerM": [round((value + 0.5) * step, 7) for value in key],
                  "candidateOwners": sorted(meta["candidateOwners"]),
                  "categories": sorted(meta["categories"]),
                  "photoIds": sorted(meta["photoIds"]),
                  "hasExistingOwnerConflict": meta["hasExistingOwnerConflict"],
                  "reviewState": "unreviewed", "provenance": PROVENANCE}
                 for key, meta in sorted(coarse.items())]
        grids[str(step)] = {"stepM": step, "cellEncoding": "center-m",
                            "recordCount": len(cells), "cells": cells}
    return grids, coordinates


def raw_grid_coordinates(raw: dict, step: float):
    counts = raw["counts"]
    origin = np.rint(np.asarray(raw["origin"], dtype=float) / step).astype(np.int64)
    ny, nz = counts[1], counts[2]
    result = set()
    for key in raw["keys"]:
        z = key % nz
        rest = (key - z) // nz
        y = rest % ny
        x = (rest - y) // ny
        result.add((x + int(origin[0]), y + int(origin[1]), z + int(origin[2])))
    return result


def _write_json_atomic(path: Path, payload: dict):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".ai-grid-", delete=False) as stream:
        json.dump(payload, stream, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        staged = Path(stream.name)
    try:
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def prepare(scan_dir: Path):
    scan_dir = scan_dir.resolve(strict=True)
    private = PRIVATE.resolve(strict=True)
    if scan_dir == private or not scan_dir.is_relative_to(private):
        raise ValueError("Output must remain inside the private scan directory")
    imported = json.loads((scan_dir / "import-manifest.json").read_text(encoding="utf-8"))
    if (imported.get("kind") != "house-capture-import" or imported.get("scanId") != scan_dir.name or
            imported.get("converted", {}).get("status") != "available"):
        raise ValueError("This private scan has no validated room-local import")
    raw_relative = imported.get("assetPaths", {}).get("rawMeshPly")
    if not isinstance(raw_relative, str):
        raise ValueError("This scan has no raw PLY")
    source = (scan_dir / raw_relative).resolve(strict=True)
    if not source.is_relative_to(scan_dir / "source"):
        raise ValueError("Source PLY escapes the extracted scan")
    converted_path = scan_dir / "converted.json"
    converted = json.loads(converted_path.read_text(encoding="utf-8"))
    matrix_values = converted.get("transform", {}).get("worldToRoom")
    if not isinstance(matrix_values, list) or len(matrix_values) != 16:
        raise ValueError("Missing room-local transform")
    matrix = np.asarray(matrix_values, dtype=float).reshape(4, 4, order="F")
    if not np.isfinite(matrix).all() or not np.allclose(matrix[3], [0, 0, 0, 1]):
        raise ValueError("Invalid room-local transform")
    source_hash, transform_id = sha256(source), transform_hash(matrix_values)
    projection_path = scan_dir / "derived-v4-photo-ai-fresh" / "photo-face-proposals.json"
    projection = json.loads(projection_path.read_text(encoding="utf-8"))
    if projection.get("scanId") != scan_dir.name:
        raise ValueError("Photo proposals belong to another scan")
    v1 = json.loads((scan_dir / "derived-v1/face-assignments.json").read_text(encoding="utf-8"))
    mesh_cache_path = scan_dir / "mesh-surface-grids.json"
    mesh_cache = json.loads(mesh_cache_path.read_text(encoding="utf-8"))
    if mesh_cache.get("sources", {}).get("ply", {}).get("sourcePlySha256") != source_hash:
        raise ValueError("Room-local view grid is not derived from this source PLY")
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError("Original PLY geometry is unavailable or invalid")
    proposals = validated_proposals(projection, source_hash, transform_id, len(mesh.faces), v1)
    vertices = np.asarray(mesh.vertices) @ matrix[:3, :3].T + matrix[:3, 3]
    grids, coordinates = candidate_grids(vertices, np.asarray(mesh.faces), proposals)
    for step in STEPS:
        raw = mesh_cache["sources"]["ply"]["grids"][str(step)]
        outside = coordinates[str(step)] - raw_grid_coordinates(raw, step)
        if outside:
            raise ValueError("AI candidate grid contains cells outside the measured source surface")
    face_union = set().union(*(set(ids.tolist()) for _, _, _, ids, _ in proposals))
    payload = {"schemaVersion": 1, "kind": "ai-instance-candidate-grid",
               "scanId": scan_dir.name, "frame": "room-local-m", "sourceHash": source_hash,
               "transformHash": transform_id, "reviewState": "unreviewed",
               "provenance": PROVENANCE, "grids": grids}
    out = scan_dir / "derived-v4-photo-ai-fresh"
    grid_path = out / "ai-candidate-grid.json"
    _write_json_atomic(grid_path, payload)
    manifest = {"schemaVersion": 1, "kind": KIND, "scanId": scan_dir.name,
                "frame": "room-local-m", "sourceHash": source_hash,
                "transformHash": transform_id, "convertedHash": sha256(converted_path),
                "meshSurfaceCacheHash": sha256(mesh_cache_path),
                "projectionHash": sha256(projection_path), "gridHash": sha256(grid_path),
                "gridUri": "ai-candidate-grid.json", "reviewState": "unreviewed",
                "proposalCount": len(proposals), "uniqueSourceFaceCount": len(face_union),
                "cellCounts": {step: value["recordCount"] for step, value in grids.items()},
                "categoryCounts": {category: sum(category in row["categories"] for row in grids["0.2"]["cells"])
                                   for category in sorted({c for _, c, _, _, _ in proposals})},
                "warning": "Review-only measured surface candidates. No accepted owner or solid furniture is inferred."}
    _write_json_atomic(out / "ai-candidate-manifest.json", manifest)
    return {"scanId": scan_dir.name, "proposalCount": len(proposals),
            "uniqueSourceFaceCount": len(face_union), "cellCounts": manifest["cellCounts"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.scan_dir), separators=(",", ":")))


if __name__ == "__main__":
    main()
