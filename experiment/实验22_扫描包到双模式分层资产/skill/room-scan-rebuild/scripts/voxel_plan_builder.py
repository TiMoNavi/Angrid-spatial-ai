#!/usr/bin/env python3
"""Build named GLB parts and review-only occupancy from an integer voxel plan.

This builder does not infer object identity or assign original scan ownership.
Both deliverables come from the same half-open integer cells; no floating-point
surface sampling is used to decide model occupancy.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
from typing import Any

import numpy as np
import trimesh


MAX_TOTAL_CELL_CLAIMS = 100_000
MAX_PART_CELLS = 50_000
MAX_PARTS = 512
MAX_INSTANCES = 128
MAX_INDEX_ABS = 10_000_000
MAX_WORLD_GRID_STEPS = 2 ** 20
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
BLOCKED_GEOMETRY_STATES = {"accepted", "confirmed", "measured"}
OWNERSHIP_CONTROL_FIELDS = {"acceptedOwner", "acceptedOwners", "ownerId", "ownerIds",
                            "sourceFaceIds", "reviewState", "ownershipState",
                            "ownerAcceptanceBlocked"}
Cell = tuple[int, int, int]

# Corner order is counter-clockwise as viewed from outside the occupied cell.
SIDES = (
    ((-1, 0, 0), ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0))),
    ((1, 0, 0), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),
    ((0, -1, 0), ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1))),
    ((0, 1, 0), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0))),
    ((0, 0, -1), ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0))),
    ((0, 0, 1), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))),
)


class PlanError(ValueError):
    """A plan is not safe or well-defined enough to build."""


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def text_field(value: Any, label: str, limit: int = 240) -> str:
    if (not isinstance(value, str) or not value.strip() or len(value) > limit or
            any(ord(char) < 32 for char in value)):
        raise PlanError(f"{label} must be a nonempty bounded string")
    return value


def identifier(value: Any, label: str) -> str:
    result = text_field(value, label)
    if "::" in result:
        raise PlanError(f"{label} cannot contain the GLB node separator '::'")
    return result


def forbid_owner_controls(value: dict, label: str) -> None:
    if OWNERSHIP_CONTROL_FIELDS.intersection(value):
        raise PlanError(f"{label} cannot declare scan ownership or acceptance controls")


def index_vector(value: Any, label: str, positive: bool = False) -> Cell:
    if (not isinstance(value, list) or len(value) != 3 or
            not all(integer(axis) and abs(axis) <= MAX_INDEX_ABS for axis in value) or
            (positive and not all(axis > 0 for axis in value))):
        raise PlanError(f"{label} must contain three bounded {'positive ' if positive else ''}integers")
    return tuple(value)


def photo_evidence(value: Any, label: str) -> list[dict]:
    if not isinstance(value, list) or len(value) > 256:
        raise PlanError(f"{label} must be a bounded photo evidence array")
    for row in value:
        if (not isinstance(row, dict) or not integer(row.get("photoIndex")) or
                row["photoIndex"] < 0):
            raise PlanError(f"{label} entries need a nonnegative integer photoIndex")
        if "reason" in row:
            text_field(row["reason"], label + ".reason", 4000)
    try:
        serialized = canonical_bytes(value)
    except (TypeError, ValueError) as exc:
        raise PlanError(f"{label} must contain finite JSON values") from exc
    if len(serialized) > 200_000:
        raise PlanError(f"{label} is too large")
    return copy.deepcopy(value)


def expand_part(part: dict, label: str) -> set[Cell]:
    kind = part.get("kind")
    if kind == "gridBox":
        if "cells" in part:
            raise PlanError(f"{label} cannot mix gridBox and gridCells definitions")
        low = index_vector(part.get("minCell"), label + ".minCell")
        size = index_vector(part.get("sizeCells"), label + ".sizeCells", positive=True)
        count = math.prod(size)
        if count > MAX_PART_CELLS:
            raise PlanError(f"{label} exceeds per-part cell budget")
        if any(abs(low[axis] + size[axis]) > MAX_INDEX_ABS for axis in range(3)):
            raise PlanError(f"{label} extends beyond bounded cell indices")
        return {(x, y, z)
                for x in range(low[0], low[0] + size[0])
                for y in range(low[1], low[1] + size[1])
                for z in range(low[2], low[2] + size[2])}
    if kind == "gridCells":
        if "minCell" in part or "sizeCells" in part:
            raise PlanError(f"{label} cannot mix gridCells and gridBox definitions")
        rows = part.get("cells")
        if not isinstance(rows, list) or not rows or len(rows) > MAX_PART_CELLS:
            raise PlanError(f"{label}.cells must be nonempty and within the per-part budget")
        cells = [index_vector(row, label + ".cells[]") for row in rows]
        if len(set(cells)) != len(cells):
            raise PlanError(f"{label}.cells contains duplicate cells")
        return set(cells)
    raise PlanError(f"{label}.kind must be gridBox or gridCells")


def validate_plan(value: Any) -> tuple[dict, list[dict]]:
    if not isinstance(value, dict) or not integer(value.get("schemaVersion")) or value.get("schemaVersion") != 1:
        raise PlanError("schemaVersion must be 1")
    forbid_owner_controls(value, "plan")
    if value.get("frame") != "room-local-m":
        raise PlanError("frame must be room-local-m")
    plan = copy.deepcopy(value)
    plan["scanId"] = identifier(value.get("scanId"), "scanId")
    for key in ("transformHash", "sourcePlySha256"):
        if not isinstance(value.get(key), str) or not SHA256.fullmatch(value[key]):
            raise PlanError(f"{key} must be a SHA256 hex digest")
        plan[key] = value[key].lower()
    grid = value.get("grid")
    if not isinstance(grid, dict):
        raise PlanError("grid is required")
    step = grid.get("stepM")
    origin = grid.get("originM")
    if (isinstance(step, bool) or not isinstance(step, (int, float)) or
            not math.isfinite(step) or step <= 0 or step > 10):
        raise PlanError("grid.stepM must be positive, finite and at most 10 metres")
    if (not isinstance(origin, list) or len(origin) != 3 or
            not all(not isinstance(axis, bool) and isinstance(axis, (int, float)) and
                    math.isfinite(axis) for axis in origin)):
        raise PlanError("grid.originM must contain three finite numbers")
    plan["grid"] = {"stepM": float(step), "originM": [float(axis) for axis in origin]}
    instances = value.get("instances")
    if not isinstance(instances, list) or not instances or len(instances) > MAX_INSTANCES:
        raise PlanError("instances must be nonempty and within the instance budget")
    seen_instances, records, total = set(), [], 0
    normalized_instances = []
    for ii, instance in enumerate(instances):
        label = f"instances[{ii}]"
        if not isinstance(instance, dict):
            raise PlanError(f"{label} must be an object")
        forbid_owner_controls(instance, label)
        instance_id = identifier(instance.get("instanceId"), label + ".instanceId")
        if instance_id in seen_instances:
            raise PlanError("duplicate instanceId")
        seen_instances.add(instance_id)
        normalized_instance = copy.deepcopy(instance)
        for field in ("name", "categoryClaim"):
            if field in instance:
                text_field(instance[field], label + "." + field)
        if "photoEvidence" in instance:
            normalized_instance["photoEvidence"] = photo_evidence(instance["photoEvidence"], label + ".photoEvidence")
        parts = instance.get("parts")
        if not isinstance(parts, list) or not parts:
            raise PlanError(f"{label}.parts must be nonempty")
        seen_parts, normalized_parts = set(), []
        for pi, part in enumerate(parts):
            part_label = f"{label}.parts[{pi}]"
            if not isinstance(part, dict):
                raise PlanError(f"{part_label} must be an object")
            forbid_owner_controls(part, part_label)
            part_id = identifier(part.get("partId"), part_label + ".partId")
            if part_id in seen_parts:
                raise PlanError(f"{label} has duplicate partId")
            seen_parts.add(part_id)
            role = text_field(part.get("role"), part_label + ".role")
            state = text_field(part.get("geometryState"), part_label + ".geometryState")
            if state.strip().lower() in BLOCKED_GEOMETRY_STATES:
                raise PlanError(f"{part_label}.geometryState cannot claim accepted/measured ownership")
            evidence = photo_evidence(part.get("photoEvidence"), part_label + ".photoEvidence")
            cells = expand_part(part, part_label)
            # GLB positions are float32. Reject wildly translated/tiny grids
            # where adjacent model cell corners could collapse numerically.
            cell_array = np.asarray(list(cells), dtype=float)
            grid_limits = np.stack((cell_array.min(axis=0), cell_array.max(axis=0) + 1))
            world_in_steps = grid_limits + np.asarray(plan["grid"]["originM"]) / float(step)
            if not np.isfinite(world_in_steps).all() or np.max(np.abs(world_in_steps)) > MAX_WORLD_GRID_STEPS:
                raise PlanError(f"{part_label} exceeds float32-resolvable room grid bounds")
            total += len(cells)
            if total > MAX_TOTAL_CELL_CLAIMS or len(records) >= MAX_PARTS:
                raise PlanError("plan exceeds total cell or part budget")
            normalized_part = copy.deepcopy(part)
            normalized_part.update({"partId": part_id, "role": role,
                                    "geometryState": state, "photoEvidence": evidence})
            if part["kind"] == "gridCells":
                normalized_part["cells"] = [list(cell) for cell in sorted(cells)]
            normalized_parts.append(normalized_part)
            records.append({"instanceId": instance_id, "partId": part_id,
                            "role": role, "geometryState": state,
                            "photoEvidence": evidence, "cells": cells,
                            "glbNodeName": instance_id + "::" + part_id})
        normalized_instance["parts"] = normalized_parts
        normalized_instances.append(normalized_instance)
    plan["instances"] = normalized_instances
    try:
        canonical_bytes(plan)
    except (TypeError, ValueError) as exc:
        raise PlanError("plan must contain only finite JSON values") from exc
    return plan, records


def exposed_mesh(cells: set[Cell], step: float, origin: list[float]) -> tuple[trimesh.Trimesh, int]:
    """One mesh per named part; retain empty cells and omit internal faces."""
    vertices, faces, corner_indices = [], [], {}
    quads = 0
    for x, y, z in sorted(cells):
        for direction, corners in SIDES:
            neighbor = (x + direction[0], y + direction[1], z + direction[2])
            if neighbor in cells:
                continue
            indices = []
            for dx, dy, dz in corners:
                corner = (x + dx, y + dy, z + dz)
                if corner not in corner_indices:
                    corner_indices[corner] = len(vertices)
                    vertices.append([origin[axis] + corner[axis] * step for axis in range(3)])
                indices.append(corner_indices[corner])
            a, b, c, d = indices
            faces.extend(((a, b, c), (a, c, d)))
            quads += 1
    mesh = trimesh.Trimesh(vertices=np.asarray(vertices, dtype=float),
                           faces=np.asarray(faces, dtype=np.int64), process=False)
    return mesh, quads


def build_artifacts(value: Any) -> tuple[dict, dict, bytes]:
    plan, parts = validate_plan(value)
    plan_hash = sha256_bytes(canonical_bytes(plan))
    step, origin = plan["grid"]["stepM"], plan["grid"]["originM"]
    scene = trimesh.Scene()
    claims = defaultdict(list)
    part_stats = []
    for part in parts:
        mesh, quads = exposed_mesh(part["cells"], step, origin)
        color_hash = hashlib.sha256(part["instanceId"].encode()).digest()
        color = [80 + color_hash[0] % 130, 80 + color_hash[1] % 130,
                 80 + color_hash[2] % 130, 255]
        mesh.visual.face_colors = color
        mesh.metadata = {key: part[key] for key in
                         ("instanceId", "partId", "role", "geometryState", "photoEvidence")}
        mesh.metadata.update({"reviewState": "unreviewed", "provenance": "model-inferred"})
        scene.add_geometry(mesh, node_name=part["glbNodeName"], geom_name=part["glbNodeName"])
        for cell in part["cells"]:
            claims[cell].append({"instanceId": part["instanceId"], "partId": part["partId"]})
        part_stats.append({key: part[key] for key in
                           ("instanceId", "partId", "role", "geometryState", "photoEvidence", "glbNodeName")})
        part_stats[-1].update({"cellCount": len(part["cells"]), "exposedQuadCount": quads,
                               "triangleCount": len(mesh.faces)})
    scene.metadata = {"schemaVersion": 1, "scanId": plan["scanId"],
                      "frame": plan["frame"], "transformHash": plan["transformHash"],
                      "sourcePlySha256": plan["sourcePlySha256"],
                      "planSha256": plan_hash, "provenance": "model-inferred",
                      "ownerAcceptanceBlocked": True}
    glb = scene.export(file_type="glb")
    if not isinstance(glb, bytes):
        raise PlanError("GLB exporter did not return bytes")
    rows, conflicts, same_instance_overlaps = [], [], 0
    for cell, cell_parts in sorted(claims.items()):
        refs = sorted(cell_parts, key=lambda row: (row["instanceId"], row["partId"]))
        instance_ids = sorted({row["instanceId"] for row in refs})
        conflict = len(instance_ids) > 1
        row = {"indexXYZ": list(cell), "partRefs": refs,
               "candidateInstanceIds": instance_ids,
               "state": "conflict" if conflict else "model-inferred",
               "sourceFaceIds": []}
        rows.append(row)
        if conflict:
            conflicts.append(row)
        elif len(refs) > 1:
            same_instance_overlaps += 1
    shared = {"schemaVersion": 1, "scanId": plan["scanId"], "frame": plan["frame"],
              "transformHash": plan["transformHash"], "sourcePlySha256": plan["sourcePlySha256"],
              "grid": {**plan["grid"], "cellEncoding": "index-xyz", "maxBoundary": "exclusive"},
              "planSha256": plan_hash, "modelGlbSha256": sha256_bytes(glb),
              "reviewState": "unreviewed", "ownerAcceptanceBlocked": True,
              "legacyOwnership": "unchanged", "provenance": "model-inferred",
              "identityValidation": "declared-only"}
    occupancy = {**shared, "kind": "voxel-plan-model-candidates",
                 "instances": plan["instances"], "parts": part_stats, "cells": rows,
                 "meaning": "Integer model occupancy only. Photo support does not establish measured scan ownership."}
    bounds_indices = np.asarray(list(claims), dtype=float)
    low = np.asarray(origin) + bounds_indices.min(axis=0) * step
    high = np.asarray(origin) + (bounds_indices.max(axis=0) + 1) * step
    report = {**shared, "instanceCount": len(plan["instances"]), "partCount": len(parts),
              "totalCellClaims": sum(len(part["cells"]) for part in parts),
              "uniqueCellCount": len(rows), "crossInstanceConflictCellCount": len(conflicts),
              "sameInstanceOverlapCellCount": same_instance_overlaps,
              "conflicts": conflicts, "boundsM": [low.tolist(), high.tolist()],
              "parts": part_stats,
              "limitations": ["No scan source faces were assigned or changed.",
                              "Source/transform hashes are declared by the plan; a scan evidence binder must verify them.",
                              "All occupied cells are a modeled proposal, including photo-supported parts.",
                              "Empty model cells are holes, not depth-certified free space."]}
    return occupancy, report, glb


def build(value: Any, output: Path) -> dict:
    output = Path(output).absolute()
    if os.path.lexists(output):
        raise PlanError("output must be a new path; refusing to overwrite")
    if not output.parent.is_dir():
        raise PlanError("output parent must already exist")
    occupancy, report, glb = build_artifacts(value)
    payloads = {"reconstructed.glb": glb,
                "voxel-occupancy.json": canonical_bytes(occupancy),
                "build-report.json": canonical_bytes(report)}
    # Reserve only after all validation and export succeeded. A partial write
    # remains visible and a later invocation will refuse to overwrite it.
    output.mkdir()
    for name, payload in payloads.items():
        with (output / name).open("xb") as stream:
            stream.write(payload)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        value = json.loads(args.plan.read_text(encoding="utf-8"))
        report = build(value, args.output)
    except (OSError, json.JSONDecodeError, PlanError) as exc:
        parser.exit(2, f"voxel-plan: {exc}\n")
    print(json.dumps({key: report[key] for key in
                      ("scanId", "partCount", "uniqueCellCount", "crossInstanceConflictCellCount",
                       "ownerAcceptanceBlocked")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
