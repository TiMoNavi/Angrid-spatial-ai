#!/usr/bin/env python3
"""Derive a room-local PLY and honest surface cells from an immutable scan PLY.

This is viewer evidence only. Original PLY face IDs remain in the source file
and are never replaced by the reindexed, in-room display mesh.
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


HERE = Path(__file__).resolve().parent
PRIVATE = HERE.parents[1] / ".private"
STEPS = (0.2, 0.1, 0.05, 0.025)
FINE = STEPS[-1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def triangle_box_intersects(triangles: np.ndarray, centers: np.ndarray, half: float):
    """Separating-axis test after candidate boxes pass triangle bounds."""
    tri = triangles - centers[:, None, :]
    edges = np.roll(tri, -1, axis=1) - tri
    axes = [np.cross(edges[:, 0], edges[:, 1])]
    for edge in range(3):
        for basis in np.eye(3):
            axes.append(np.cross(edges[:, edge], basis))
    keep = np.ones(len(tri), dtype=bool)
    for axis in axes:
        projections = np.einsum("nvc,nc->nv", tri, axis)
        radius = half * np.sum(np.abs(axis), axis=1)
        keep &= (projections.min(axis=1) <= radius + 1e-12) & (
            projections.max(axis=1) >= -radius - 1e-12)
    return keep


def surface_cells(vertices: np.ndarray, faces: np.ndarray, step: float = FINE):
    """Find exact triangle/box intersections on a zero-origin meter lattice."""
    if len(faces) == 0:
        return np.empty((0, 3), dtype=np.int64)
    pieces = []
    for start in range(0, len(faces), 256):
        triangles = vertices[faces[start:start + 256]]
        lower = np.floor(triangles.min(axis=1) / step).astype(np.int64)
        upper = np.floor(triangles.max(axis=1) / step).astype(np.int64)
        cell_batches, triangle_ids = [], []
        batch_count = 0
        for index, (lo, hi) in enumerate(zip(lower, upper)):
            spans = hi - lo + 1
            cell_count = int(spans[0]) * int(spans[1]) * int(spans[2])
            if cell_count <= 0 or cell_count > 200000 or batch_count + cell_count > 2000000:
                raise ValueError("A triangle spans too many grid cells; check units")
            cells = np.stack(np.meshgrid(*(np.arange(lo[k], hi[k] + 1)
                                            for k in range(3)), indexing="ij"), axis=-1).reshape(-1, 3)
            cell_batches.append(cells)
            triangle_ids.extend([index] * len(cells))
            batch_count += cell_count
        boxes = np.concatenate(cell_batches)
        centers = (boxes + 0.5) * step
        hit = triangle_box_intersects(triangles[np.asarray(triangle_ids)], centers, step / 2)
        pieces.append(boxes[hit])
    return np.unique(np.concatenate(pieces), axis=0)


def pack_grid(fine_cells: np.ndarray, step: float):
    ratio = round(step / FINE)
    if not np.isclose(ratio * FINE, step) or ratio < 1:
        raise ValueError("Grid steps must be nested multiples of the fine lattice")
    cells = np.unique(np.floor_divide(fine_cells, ratio), axis=0)
    if not len(cells):
        raise ValueError("The room-local source mesh has no surface cells")
    lower, upper = cells.min(axis=0), cells.max(axis=0)
    counts = upper - lower + 1
    local = cells - lower
    keys = (local[:, 0] * counts[1] + local[:, 1]) * counts[2] + local[:, 2]
    return {"step": step, "origin": (lower * step).tolist(), "counts": counts.tolist(),
            "surfaceCells": len(keys), "keys": np.sort(keys).tolist()}


def derive(scan_dir: Path, source_ply: Path):
    scan_dir = scan_dir.resolve(strict=True)
    private = PRIVATE.resolve(strict=True)
    if not scan_dir.is_relative_to(private) or scan_dir == private:
        raise ValueError("Output must be a private scan directory")
    source_ply = source_ply.resolve(strict=True)
    if not source_ply.is_relative_to(scan_dir / "source"):
        raise ValueError("Source PLY must be an extracted, immutable scan member")
    room = json.loads((scan_dir / "converted.json").read_text(encoding="utf-8"))
    matrix_values = room.get("transform", {}).get("worldToRoom")
    if not isinstance(matrix_values, list) or len(matrix_values) != 16:
        raise ValueError("Converted room lacks a worldToRoom matrix")
    matrix = np.asarray(matrix_values, dtype=float).reshape(4, 4, order="F")
    if not np.isfinite(matrix).all() or not np.allclose(matrix[3], [0, 0, 0, 1]):
        raise ValueError("Invalid meter-space affine transform")
    source = trimesh.load(source_ply, process=False)
    if not isinstance(source, trimesh.Trimesh) or not len(source.faces):
        raise ValueError("Source PLY has no triangle mesh")
    if not np.isfinite(source.vertices).all():
        raise ValueError("Source PLY has non-finite vertex coordinates")
    try:
        vertex = source.metadata["_ply_raw"]["vertex"]["data"]
        inroom = np.asarray(vertex["inroom"] == 1)
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Source PLY lacks the inroom vertex flag") from error
    if len(inroom) != len(source.vertices):
        raise ValueError("Source PLY inroom flag count differs from vertices")
    source_face_ids = np.flatnonzero(np.all(inroom[source.faces], axis=1))
    if len(source_face_ids) == 0:
        raise ValueError("Source PLY has no in-room triangles")
    display = source.submesh([source_face_ids], append=True, repair=False)
    display.apply_transform(matrix)
    if len(display.faces) != len(source_face_ids):
        raise AssertionError("Display mesh lost in-room source faces")
    fine = surface_cells(np.asarray(display.vertices), np.asarray(display.faces))
    cache = {"schemaVersion": 1,
             "method": "triangle/AABB intersections; measured surface only, not solid fill",
             "coordinates": "room-local-m, +Y up; worldToRoom applied once",
             "sources": {"ply": {"geometry": "mesh-voxels/raw-room.ply",
                                  "sourcePlySha256": sha256(source_ply),
                                  "sourceFaceCount": int(len(source.faces)),
                                  "inroomSourceFaceCount": int(len(source_face_ids)),
                                  "viewTriangles": int(len(display.faces)),
                                  "grids": {str(step): pack_grid(fine, step) for step in STEPS}}}}
    output_mesh = scan_dir / "mesh-voxels" / "raw-room.ply"
    output_mesh.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output_mesh.parent, suffix=".ply", delete=False) as temp:
        temp_mesh = Path(temp.name)
    try:
        display.export(temp_mesh, file_type="ply")
        os.replace(temp_mesh, output_mesh)
    finally:
        temp_mesh.unlink(missing_ok=True)
    output_grid = scan_dir / "mesh-surface-grids.json"
    with tempfile.NamedTemporaryFile(dir=scan_dir, mode="w", encoding="utf-8", delete=False) as temp:
        json.dump(cache, temp, separators=(",", ":"), allow_nan=False)
        temp_grid = Path(temp.name)
    try:
        os.replace(temp_grid, output_grid)
    finally:
        temp_grid.unlink(missing_ok=True)
    return {"sourceFaceCount": int(len(source.faces)),
            "inroomSourceFaceCount": int(len(source_face_ids)),
            "viewTriangles": int(len(display.faces)),
            "surfaceCells": {str(step): cache["sources"]["ply"]["grids"][str(step)]["surfaceCells"]
                             for step in STEPS}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-dir", type=Path, required=True)
    parser.add_argument("--source-ply", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(derive(args.scan_dir, args.source_ply), separators=(",", ":")))


if __name__ == "__main__":
    main()
