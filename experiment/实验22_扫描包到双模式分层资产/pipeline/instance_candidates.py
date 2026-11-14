#!/usr/bin/env python3
"""Propose auditable source-face instances without changing the v1 owner ledger.

Manual source-face seeds are a separate input from AI photo-semantic hints. The
latter remain unprojected until image orientation, depth, and visibility are
validated; neither input silently becomes an accepted owner assignment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

import numpy as np
import trimesh
from scipy.spatial import cKDTree


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from geometry_v1 import (  # noqa: E402
    components_for_faces,
    local_coordinates,
    structure_assignment,
    transform_hash,
    transform_points,
)

ALGORITHM_VERSION = "instance-candidates-v1.1"
FURNITURE_PRIOR_CLASSES = (0, 4, 5)  # raw ARKit unknown/table/seat; not final labels


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def stable_id(source_hash: str, kind: str, key: str) -> str:
    digest = hashlib.sha256(f"{source_hash}|{kind}|{key}".encode()).hexdigest()[:20]
    return f"proposal:{digest}"


def face_geometry(vertices: np.ndarray, faces: np.ndarray):
    triangle = vertices[faces]
    centers = triangle.mean(axis=1)
    normal = np.cross(triangle[:, 1] - triangle[:, 0], triangle[:, 2] - triangle[:, 0])
    normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-20)
    return centers, normal


def parse_face_classes(mesh: trimesh.Trimesh, face_count: int):
    try:
        field = mesh.metadata["_ply_raw"]["face"]["data"]
        if "class" in field.dtype.names:
            return np.asarray(field["class"], dtype=np.int16), True
    except (KeyError, AttributeError, TypeError):
        pass
    return np.zeros(face_count, dtype=np.int16), False


def validate_v1_assignments(payload: dict, source_hash: str, face_count: int):
    if payload.get("sourceHash") != source_hash:
        raise ValueError("v1 face assignments do not match the source PLY SHA256")
    buckets = payload.get("sourceFaceIdsByAssignment")
    if not isinstance(buckets, dict) or not buckets:
        raise ValueError("v1 assignments lack source-face buckets")
    seen = np.zeros(face_count, dtype=np.int32)
    result = {}
    for name, values in buckets.items():
        ids = np.asarray(values, dtype=np.int64)
        if ids.ndim != 1 or np.any((ids < 0) | (ids >= face_count)):
            raise ValueError(f"v1 assignment {name} has invalid source face IDs")
        if len(ids) != len(np.unique(ids)):
            raise ValueError(f"v1 assignment {name} has duplicate source face IDs")
        seen[ids] += 1
        result[name] = ids
    if not np.all(seen == 1):
        raise ValueError("v1 source-face buckets do not form an exact partition")
    result.setdefault("unknown", np.empty(0, dtype=np.int64))
    return result


def hard_structure_mask(centers: np.ndarray, normals: np.ndarray, room: dict,
                        distance_m: float):
    if not room.get("walls") or not room.get("polygon"):
        return np.zeros(len(centers), dtype=bool), "room structure missing; proximity gate unavailable"
    return structure_assignment(centers, normals, room, distance_m), None


def object_box_mask(points: np.ndarray, objects: list[dict], allowed_index: int | None,
                    margin_m: float):
    blocked = np.zeros(len(points), dtype=bool)
    for index, item in enumerate(objects):
        if index == allowed_index:
            continue
        half = np.asarray(item["size"], dtype=float) / 2 + margin_m
        blocked |= np.all(np.abs(local_coordinates(points, item)) <= half, axis=1)
    return blocked


def bounds_of_faces(vertices: np.ndarray, faces: np.ndarray, ids: np.ndarray):
    if not len(ids):
        return None
    points = vertices[faces[ids]].reshape(-1, 3)
    return {"min": points.min(axis=0).round(6).tolist(),
            "max": points.max(axis=0).round(6).tolist()}


def component_containing_seeds(faces: np.ndarray, ids: np.ndarray,
                               positives: np.ndarray):
    if not len(ids):
        return np.empty(0, dtype=np.int64)
    hits = []
    for component in components_for_faces(faces, ids):
        if np.isin(positives, component).any():
            hits.append(component)
    return np.sort(np.concatenate(hits)) if hits else np.empty(0, dtype=np.int64)


def grow_seeded_faces(faces: np.ndarray, centers: np.ndarray,
                      allowed: np.ndarray, positives: np.ndarray, negatives: np.ndarray,
                      radius_m: float, roi: dict | None = None):
    """Conservative local face-adjacency growth; deliberately not a graph cut."""
    if len(positives) == 0 or len(np.unique(positives)) != len(positives):
        raise ValueError("manual proposal needs distinct positive source faces")
    if not np.all(allowed[positives]):
        raise ValueError("positive seed is excluded by v1, structure, class, or another OBB")
    if np.isin(positives, negatives).any():
        raise ValueError("a source face cannot be both a positive and negative seed")
    ids = np.flatnonzero(allowed)
    if len(negatives):
        ids = ids[~np.isin(ids, negatives)]
    distance = cKDTree(centers[positives]).query(centers[ids], k=1)[0]
    ids = ids[distance <= radius_m + 1e-9]
    if roi is not None:
        lower, upper = np.asarray(roi["min"], float), np.asarray(roi["max"], float)
        if lower.shape != (3,) or upper.shape != (3,) or np.any(lower >= upper):
            raise ValueError("roiRoomLocalM needs increasing min/max XYZ")
        ids = ids[np.all((centers[ids] >= lower) & (centers[ids] <= upper), axis=1)]
    if not np.isin(positives, ids).all():
        raise ValueError("positive seed lies outside its declared radius/ROI")
    grown = component_containing_seeds(faces, ids, positives)
    if not np.isin(positives, grown).all():
        raise AssertionError("growth disconnected a declared positive seed")
    return grown


def parse_manual_seeds(path: Path | None, scan_id: str, source_hash: str):
    if path is None:
        return [], None
    data = load_json(path)
    if (data.get("schemaVersion") != 1 or data.get("kind") != "manual-face-seeds" or
            data.get("scanId") != scan_id or data.get("sourceHash") != source_hash or
            not isinstance(data.get("proposals"), list)):
        raise ValueError("manual face seeds are not bound to this scan/source")
    return data["proposals"], sha256(path)


def parse_pending_photo_hints(path: Path | None, scan_id: str, valid_photo_ids: set[str]):
    if path is None:
        return None
    source = load_json(path)
    # The Codex adapter returns a status envelope; direct schema payloads are
    # also accepted for offline review. Neither representation assigns faces.
    if isinstance(source, dict) and "payload" in source:
        if (set(source) != {"mode", "reasonCode", "reviewState",
                            "photoProjection", "payload"} or
                source["mode"] not in ("codex", "offline") or
                source["reviewState"] != "unreviewed" or
                source["photoProjection"] != "pending"):
            raise ValueError("photo hint worker envelope is not review-only")
        data, mode, reason = source["payload"], source["mode"], source["reasonCode"]
    else:
        data, mode, reason = source, "supplied", None
    if not isinstance(data, dict):
        raise ValueError("photo semantic hints must be an object")
    if (set(data) != {"schemaVersion", "scanId", "hints", "unresolvedNotes"} or
            data.get("schemaVersion") != 1 or data.get("scanId") != scan_id or
            not isinstance(data.get("hints"), list) or len(data["hints"]) > 100 or
            not isinstance(data.get("unresolvedNotes"), list) or
            len(data["unresolvedNotes"]) > 30 or any(
                not isinstance(note, str) or len(note) > 500
                for note in data["unresolvedNotes"])):
        raise ValueError("photo semantic hints have wrong schema or scanId")
    expected = {"photoId", "category", "confidence", "bboxNorm",
                "positivePointsNorm", "negativePointsNorm", "reason"}
    normalized = lambda x: (isinstance(x, (int, float)) and not isinstance(x, bool)
                            and np.isfinite(x) and 0 <= x <= 1)
    for hint in data["hints"]:
        if not isinstance(hint, dict) or set(hint) != expected:
            raise ValueError("photo hint has unexpected fields, possibly source faces or owners")
        if not isinstance(hint["photoId"], str) or hint["photoId"] not in valid_photo_ids:
            raise ValueError("photo hint does not reference an indexed photo")
        if (not isinstance(hint["category"], str) or not 1 <= len(hint["category"]) <= 80 or
                hint["confidence"] not in ("low", "medium", "high") or
                not isinstance(hint["reason"], str) or not 1 <= len(hint["reason"]) <= 800):
            raise ValueError("photo hint category, confidence, or reason is invalid")
        box = hint["bboxNorm"]
        if (not isinstance(box, list) or (box and
                (len(box) != 4 or not all(normalized(v) for v in box) or
                 box[0] >= box[2] or box[1] >= box[3]))):
            raise ValueError("photo hint bbox is invalid")
        for key in ("positivePointsNorm", "negativePointsNorm"):
            points = hint[key]
            if (not isinstance(points, list) or len(points) > 40 or any(
                    not isinstance(p, list) or len(p) != 2 or
                    not all(normalized(v) for v in p) for p in points)):
                raise ValueError("photo hint point coordinates are invalid")
        if not box and not hint["positivePointsNorm"]:
            raise ValueError("photo hint needs a bbox or positive point")
    return {"sha256": sha256(path), "count": len(data["hints"]),
            "mode": mode, "reasonCode": reason,
            "projectionState": "pending; no photo hint changed any face assignment"}


def parse_projected_photo_proposals(path: Path | None, scan_id: str,
                                    source_hash: str, transform_id: str,
                                    buckets: dict[str, np.ndarray], face_count: int):
    if path is None:
        return None
    data = load_json(path)
    if (not isinstance(data, dict) or data.get("schemaVersion") != 1 or
            data.get("algorithmVersion") != "photo-source-face-v1" or
            data.get("scanId") != scan_id or data.get("sourceHash") != source_hash or
            data.get("transformHash") != transform_id or
            data.get("sourceFaceCount") != face_count or
            data.get("originalOwnerAssignmentsPreserved") is not True or
            not isinstance(data.get("proposals"), list) or len(data["proposals"]) > 100 or
            not isinstance(data.get("inputHashes"), dict) or
            data["inputHashes"].get("raw-mesh.ply") != source_hash):
        raise ValueError("photo projections are not bound to this original source and transform")
    admissible = np.zeros(face_count, dtype=bool)
    for bucket in ("unknown", "one-owner", "conflict"):
        if bucket in buckets:
            admissible[buckets[bucket]] = True
    existing_owner = np.zeros(face_count, dtype=bool)
    for bucket in ("one-owner", "conflict"):
        if bucket in buckets:
            existing_owner[buckets[bucket]] = True
    proposals = []
    seen_ids = set()
    for row in data["proposals"]:
        if (not isinstance(row, dict) or
                any(key in row for key in ("owner", "ownerId", "ownerIds", "acceptedOwnerId")) or
                not isinstance(row.get("instanceId"), str) or row["instanceId"] in seen_ids or
                row.get("reviewState") != "unreviewed" or
                row.get("ownershipState") != "unchanged-v1" or
                not isinstance(row.get("categoryCandidates"), list) or
                len(row["categoryCandidates"]) != 1 or
                not isinstance(row["categoryCandidates"][0], str)):
            raise ValueError("photo projection contains an invalid or owner-changing proposal")
        seen_ids.add(row["instanceId"])
        values = row.get("sourceFaceIds")
        if not isinstance(values, list) or any(type(value) is not int for value in values):
            raise ValueError("photo projection source face IDs are invalid")
        ids = np.asarray(values, dtype=np.int64)
        if (len(ids) != row.get("sourceFaceCount") or len(np.unique(ids)) != len(ids) or
                np.any((ids < 0) | (ids >= face_count)) or not np.all(admissible[ids])):
            raise ValueError("photo projection contains out-of-scope original PLY faces")
        actual_conflicts = ids[existing_owner[ids]].tolist()
        if (row.get("existingOwnerConflictSourceFaceIds") != actual_conflicts or
                row.get("existingOwnerConflictFaceCount") != len(actual_conflicts)):
            raise ValueError("photo projection owner conflict counts are inconsistent")
        proposals.append(row)
    return {"sha256": sha256(path), "count": len(proposals), "proposals": proposals}


def roomplan_instances(room: dict, report: dict, raw_room: dict | None):
    originals = {item.get("identifier"): item for item in (raw_room or {}).get("objects", [])}
    result = []
    for index, row in enumerate(report.get("objects", [])):
        if row.get("convertedIndex") != index or row.get("roomPlanObb") != room["objects"][index]:
            raise ValueError("v1 report objects must match converted RoomPlan index and geometry")
        source_id = row.get("sourceIdentifier")
        original = originals.get(source_id) or {}
        raw_confidence = original.get("confidence")
        confidence = next(iter(raw_confidence), None) if isinstance(raw_confidence, dict) else None
        ids = row.get("sourceFaceIds", [])
        result.append({"instanceId": row["objectId"], "category": row["category"],
                       "semanticSource": "roomplan", "roomPlanSourceIdentifier": source_id,
                       "roomPlanConfidence": confidence,
                       "roomPlanMappingState": row.get("mappingState", "unverified"),
                       "roomPlanObb": room["objects"][index], "sourceFaceIds": ids,
                       "sourceFaceCount": len(ids), "candidateConflictFaces": row.get("conflictFaceCount", 0),
                       "reviewState": "unreviewed", "ownershipState": "unchanged-v1"})
    return result


def make_instance_ledger(*, scan_id: str, source_hash: str, transform_id: str,
                         vertices: np.ndarray, faces: np.ndarray, classes: np.ndarray,
                         room: dict, buckets: dict[str, np.ndarray], report: dict,
                         raw_room: dict | None, seed_rows: list[dict], seed_hash: str | None,
                         photo_hints: dict | None, photo_projected: dict | None = None,
                         structure_distance_m: float = 0.06,
                         box_margin_m: float = 0.045,
                         min_component_faces: int = 100,
                         max_unseeded_candidates: int = 100):
    if len(classes) != len(faces):
        raise ValueError("one raw class is required for each PLY source face")
    if len(report.get("objects", [])) != len(room.get("objects", [])):
        raise ValueError("v1 object report and converted RoomPlan objects disagree")
    centers, normals = face_geometry(vertices, faces)
    structure, structure_warning = hard_structure_mask(
        centers, normals, room, structure_distance_m)
    base = np.zeros(len(faces), dtype=bool)
    base[buckets["unknown"]] = True
    base &= np.isin(classes, FURNITURE_PRIOR_CLASSES) & ~structure
    known_ids = {item["objectId"]: i for i, item in enumerate(report["objects"])}
    instances = roomplan_instances(room, report, raw_room)
    proposals = []
    used_manual_ids: set[str] = set()
    for row in seed_rows:
        if not isinstance(row, dict):
            raise ValueError("manual proposal must be an object")
        category = row.get("category")
        if not isinstance(category, str) or not category.strip():
            raise ValueError("manual proposal needs a nonempty candidate category")
        positive = np.asarray(row.get("positiveSourceFaceIds", []), dtype=np.int64)
        negative = np.asarray(row.get("negativeSourceFaceIds", []), dtype=np.int64)
        if positive.ndim != 1 or negative.ndim != 1 or np.any(
                (positive < 0) | (positive >= len(faces))) or np.any(
                (negative < 0) | (negative >= len(faces))):
            raise ValueError("manual seed IDs must address source PLY faces")
        related_id = row.get("roomPlanObjectId")
        if related_id is not None and related_id not in known_ids:
            raise ValueError("manual proposal refers to unknown RoomPlan object ID")
        allowed_index = known_ids.get(related_id)
        blocked = object_box_mask(centers, room.get("objects", []),
                                  allowed_index, box_margin_m)
        allowed = base & ~blocked
        radius = float(row.get("maxSeedDistanceM", 0.6))
        if not np.isfinite(radius) or not 0.05 <= radius <= 3.0:
            raise ValueError("maxSeedDistanceM must be between 0.05 and 3 m")
        ids = grow_seeded_faces(faces, centers, allowed, positive, negative,
                                radius, row.get("roiRoomLocalM"))
        identifier = stable_id(source_hash, "manual-face-seeds",
                               ",".join(map(str, np.sort(positive))))
        if identifier in used_manual_ids:
            raise ValueError("two manual proposals have identical positive seeds")
        used_manual_ids.add(identifier)
        proposals.append({
            "instanceId": identifier, "categoryCandidates": [category],
            "semanticSource": "manual-source-face-seeds; unverified",
            "roomPlanObjectId": related_id, "roomPlanConfidence":
                instances[allowed_index]["roomPlanConfidence"] if allowed_index is not None else None,
            "positiveSourceFaceIds": np.sort(positive).tolist(),
            "negativeSourceFaceIds": np.sort(negative).tolist(),
            "sourceFaceIds": ids.tolist(), "sourceFaceCount": int(len(ids)),
            "aabbRoomLocalM": bounds_of_faces(vertices, faces, ids),
            "maxSeedDistanceM": radius, "roiRoomLocalM": row.get("roiRoomLocalM"),
            "reviewState": "unreviewed", "ownershipState": "unchanged-v1",
            "reasonCodes": ["shared-edge-continuity", "within-seed-radius",
                            "outside-protected-structure", "outside-other-roomplan-obb"],
            "warning": "Candidate surface, not a proven complete or solid object."
        })

    claimed = np.zeros(len(faces), dtype=bool)
    for proposal in proposals:
        claimed[np.asarray(proposal["sourceFaceIds"], dtype=np.int64)] = True
    auto_allowed = base & ~claimed & ~object_box_mask(
        centers, room.get("objects", []), None, box_margin_m)
    components = [component for component in components_for_faces(
        faces, np.flatnonzero(auto_allowed)) if len(component) >= min_component_faces]
    components.sort(key=lambda ids: (-len(ids), int(ids.min())))
    for component in components[:max_unseeded_candidates]:
        bounds = bounds_of_faces(vertices, faces, component)
        extent = np.asarray(bounds["max"]) - np.asarray(bounds["min"])
        flags = ["no-photo-semantic-seed", "no-roomplan-object"]
        if max(extent) > 2.0:
            flags.append("large-component-may-join-multiple-objects")
        proposals.append({
            "instanceId": stable_id(source_hash, "geometry-component",
                                    str(int(component.min()))),
            "categoryCandidates": [], "semanticSource": "geometry-only",
            "roomPlanObjectId": None, "roomPlanConfidence": None,
            "sourceFaceIds": np.sort(component).tolist(),
            "sourceFaceCount": int(len(component)), "aabbRoomLocalM": bounds,
            "reviewState": "unreviewed", "ownershipState": "unchanged-v1",
            "reasonCodes": ["shared-edge-component", "outside-protected-structure",
                            "outside-known-roomplan-obb"], "reviewFlags": flags,
            "warning": "Unlabelled observed surface; may contain several touching objects."
        })
    if photo_projected:
        proposals.extend(photo_projected["proposals"])
    candidate_count = np.zeros(len(faces), dtype=np.uint16)
    for proposal in proposals:
        candidate_count[np.asarray(proposal["sourceFaceIds"], dtype=np.int64)] += 1
    candidate_ids = np.flatnonzero(candidate_count > 0)
    admissible_ids = np.concatenate([buckets.get(bucket, np.empty(0, dtype=np.int64))
                                     for bucket in ("unknown", "one-owner", "conflict")])
    if not np.isin(candidate_ids, admissible_ids).all():
        raise AssertionError("proposal consumed a protected source face")
    overlap_ids = np.flatnonzero(candidate_count > 1)
    return {
        "schemaVersion": 1, "algorithmVersion": ALGORITHM_VERSION,
        "scanId": scan_id, "frame": "room-local-m",
        "sourceHash": source_hash, "transformHash": transform_id,
        "manualSeedHash": seed_hash, "photoSemanticHints": photo_hints,
        "photoProjectionHash": photo_projected["sha256"] if photo_projected else None,
        "photoToPlyProjection": ("review-only original-source-face proposals; no owner changes"
                                 if photo_projected else "not-implemented; photo hints do not create source-face seeds"),
        "sourceFaceCount": int(len(faces)),
        "originalAssignmentCounts": {key: int(len(value)) for key, value in buckets.items()},
        "conservation": {"sum": int(sum(len(value) for value in buckets.values())),
                         "sourceFaces": int(len(faces)), "passes": True,
                         "originalOwnerAssignmentsPreserved": True},
        "roomPlanInstances": instances, "proposals": proposals,
        "proposalOverlapSourceFaceIds": overlap_ids.tolist(),
        "v1UnknownFaceCount": int(len(buckets["unknown"])),
        "unknownWithoutProposalFaceCount": int(len(buckets["unknown"]) -
                                              np.isin(candidate_ids, buckets["unknown"]).sum()),
        "suggestedExistingOwnerFaceCount": int(np.isin(
            candidate_ids, np.concatenate([buckets.get(bucket, np.empty(0, dtype=np.int64))
                                           for bucket in ("one-owner", "conflict")])).sum()),
        "unseededComponentCountAboveThreshold": len(components),
        "unseededComponentsEmitted": min(len(components), max_unseeded_candidates),
        "warnings": [warning for warning in (
            structure_warning,
            "All proposals are review-only. V1 face owners and unknown remain unchanged.",
            "Raw PLY vertex colors are diagnostic, not photo textures.",
            "No watertight or unseen furniture geometry is inferred.") if warning],
        "parameters": {"structureDistanceM": structure_distance_m,
                       "roomPlanObbExclusionMarginM": box_margin_m,
                       "minUnseededComponentFaces": min_component_faces,
                       "maxUnseededCandidates": max_unseeded_candidates},
    }


def write_ledger_safely(out: Path, scan_dir: Path, ledger: dict, input_hashes: dict):
    output = out.resolve()
    root = scan_dir.resolve()
    private_root = (EXPERIMENT / ".private").resolve()
    if root == private_root or not root.is_relative_to(private_root):
        raise ValueError("scan directory must be within experiment/.private")
    if not output.is_relative_to(root) or not output.name.startswith("derived-v3"):
        raise ValueError("output must be a derived-v3 directory within the private scan directory")
    target = output / "instance-ledger.json"
    if target.is_file():
        old = load_json(target)
        if old.get("inputHashes") != input_hashes:
            raise ValueError("derived-v3 belongs to different inputs; choose a new output directory")
    output.mkdir(parents=True, exist_ok=True)
    ledger["inputHashes"] = input_hashes
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output,
                                     prefix=".instance-ledger-", suffix=".json", delete=False) as stream:
        json.dump(ledger, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        stream.write("\n")
        staged = Path(stream.name)
    os.replace(staged, target)
    return target


def run_config_hash(*, scan_id: str, allow_no_mesh: bool, args) -> str:
    """Prevent a changed algorithm or threshold from overwriting a prior review."""
    config = {"algorithmVersion": ALGORITHM_VERSION, "scanId": scan_id,
              "allowNoMesh": allow_no_mesh,
              "structureDistanceM": args.structure_distance,
              "boxMarginM": args.box_margin,
              "minComponentFaces": args.min_component_faces,
              "maxUnseededCandidates": args.max_unseeded_candidates}
    return hashlib.sha256(json.dumps(config, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def run(args):
    scan_dir = args.scan_dir.resolve()
    photo_projections_path = getattr(args, "photo_projections", None)
    source = (args.source or scan_dir / "raw-mesh.ply").resolve()
    room_path = (args.converted or scan_dir / "converted.json").resolve()
    assignment_path = (args.assignments or scan_dir / "derived-v1/face-assignments.json").resolve()
    manifest_path = (args.manifest or scan_dir / "derived-v1/layer-manifest.json").resolve()
    report_path = (args.report or scan_dir / "derived-v1/segment-report.json").resolve()
    for path in (room_path,):
        if not path.is_file():
            raise FileNotFoundError(path)
    room = load_json(room_path)
    scan_id = args.scan_id or scan_dir.name
    matrix_values = room["transform"]["worldToRoom"]
    transform_id = transform_hash(matrix_values)
    roomplan_path = args.roomplan
    if roomplan_path is None:
        matches = list((scan_dir / "source/Room/rooms").glob("room-*.json"))
        roomplan_path = matches[0] if len(matches) == 1 else None
    raw_room = load_json(roomplan_path) if roomplan_path else None
    photos = {str(row["file"]) for row in room.get("photos", []) if row.get("file")}
    photo_hints = parse_pending_photo_hints(args.photo_hints, scan_id, photos)
    if not source.is_file():
        if not args.allow_no_mesh or args.manual_seeds or photo_projections_path:
            raise FileNotFoundError("source PLY missing; use --allow-no-mesh without face seeds for honest fallback")
        ledger = {"schemaVersion": 1, "algorithmVersion": ALGORITHM_VERSION,
                  "scanId": scan_id, "frame": "room-local-m", "sourceHash": None,
                  "transformHash": transform_id, "photoSemanticHints": photo_hints,
                  "photoToPlyProjection": "unavailable: source PLY missing",
                  "sourceFaceCount": None, "roomPlanInstances": [
                      {"instanceId": f"{scan_id}:converted-unverified-{i}",
                       "category": item["category"], "roomPlanObb": item,
                       "roomPlanSourceIdentifier": None, "roomPlanConfidence": None,
                       "reviewState": "unreviewed", "ownershipState": "unavailable-no-source-ply"}
                      for i, item in enumerate(room.get("objects", []))],
                  "proposals": [], "degradedReason": "No original PLY; no source-face instances or voxel detail were invented."}
        hashes = {"converted.json": sha256(room_path),
                  "runConfigSha256": run_config_hash(scan_id=scan_id, allow_no_mesh=True,
                                                      args=args)}
        return write_ledger_safely(args.out, scan_dir, ledger, hashes)
    for path in (assignment_path, manifest_path, report_path):
        if not path.is_file():
            raise FileNotFoundError(path)
    source_hash = sha256(source)
    manifest, report = load_json(manifest_path), load_json(report_path)
    if (manifest.get("scanId") != scan_id or report.get("scanId") != scan_id or
            manifest.get("frame") != "room-local-m" or
            manifest.get("transformHash") != transform_id or
            report.get("transformHash") != transform_id):
        raise ValueError("converted room and v1 report/manifest identity mismatch")
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces):
        raise ValueError("source PLY has no triangle faces")
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if report.get("sourceFaces") != len(faces):
        raise ValueError("v1 report sourceFaceCount differs from source PLY")
    buckets = validate_v1_assignments(load_json(assignment_path), source_hash, len(faces))
    photo_projected = parse_projected_photo_proposals(
        photo_projections_path, scan_id, source_hash, transform_id, buckets, len(faces))
    classes, class_available = parse_face_classes(mesh, len(faces))
    vertices = transform_points(np.asarray(mesh.vertices),
                                np.asarray(matrix_values).reshape(4, 4, order="F"))
    seeds, seed_hash = parse_manual_seeds(args.manual_seeds, scan_id, source_hash)
    ledger = make_instance_ledger(
        scan_id=scan_id, source_hash=source_hash, transform_id=transform_id,
        vertices=vertices, faces=faces, classes=classes, room=room,
        buckets=buckets, report=report, raw_room=raw_room, seed_rows=seeds,
        seed_hash=seed_hash, photo_hints=photo_hints, photo_projected=photo_projected,
        structure_distance_m=args.structure_distance,
        box_margin_m=args.box_margin, min_component_faces=args.min_component_faces,
        max_unseeded_candidates=args.max_unseeded_candidates)
    ledger["rawFaceClassAvailable"] = class_available
    hashes = {"raw-mesh.ply": source_hash, "converted.json": sha256(room_path),
              "derived-v1/face-assignments.json": sha256(assignment_path),
              "derived-v1/layer-manifest.json": sha256(manifest_path),
              "derived-v1/segment-report.json": sha256(report_path),
              "runConfigSha256": run_config_hash(scan_id=scan_id, allow_no_mesh=False,
                                                  args=args)}
    if roomplan_path:
        hashes["source-roomplan.json"] = sha256(roomplan_path)
    if seed_hash:
        hashes["manual-face-seeds.json"] = seed_hash
    if photo_hints:
        hashes["photo-semantic-hints.json"] = photo_hints["sha256"]
    if photo_projected:
        hashes["photo-face-proposals.json"] = photo_projected["sha256"]
    return write_ledger_safely(args.out, scan_dir, ledger, hashes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-dir", type=Path, required=True)
    parser.add_argument("--scan-id", help="must match v1 manifest scanId; defaults to scan-dir name")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--converted", type=Path)
    parser.add_argument("--assignments", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--roomplan", type=Path)
    parser.add_argument("--manual-seeds", type=Path, help="manual-face-seeds v1; never an AI owner patch")
    parser.add_argument("--photo-hints", type=Path, help="unprojected photo-semantic-hints v1")
    parser.add_argument("--photo-projections", type=Path, help="review-only calibrated source-face proposals")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--allow-no-mesh", action="store_true")
    parser.add_argument("--structure-distance", type=float, default=0.06)
    parser.add_argument("--box-margin", type=float, default=0.045)
    parser.add_argument("--min-component-faces", type=int, default=100)
    parser.add_argument("--max-unseeded-candidates", type=int, default=100)
    args = parser.parse_args()
    if (not 0 < args.structure_distance <= 0.2 or not 0 <= args.box_margin <= 0.5 or
            args.min_component_faces < 1 or args.max_unseeded_candidates < 0):
        parser.error("invalid geometry or candidate count parameters")
    target = run(args)
    ledger = load_json(target)
    print(json.dumps({"out": str(target), "scanId": ledger["scanId"],
                      "sourceFaceCount": ledger["sourceFaceCount"],
                      "roomPlanInstances": len(ledger["roomPlanInstances"]),
                      "proposals": len(ledger["proposals"]),
                      "unassignedOriginal": ledger.get("v1UnknownFaceCount"),
                      "projection": ledger["photoToPlyProjection"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
