#!/usr/bin/env python3
"""Project review-only semantic photo points onto original PLY face IDs.

Input photo regions refer to upright copies made by prepare_photos.py.  The
original JPEG and its ARKit intrinsics remain in sensor orientation; their
camera-to-session transform and nearby depth frame are used here.  No result
is an accepted owner, a watertight object, or an inferred unobserved surface.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zlib

import numpy as np
import trimesh

from instance_candidates import (
    EXPERIMENT, FURNITURE_PRIOR_CLASSES, bounds_of_faces,
    face_geometry, hard_structure_mask, load_json, parse_face_classes,
    parse_pending_photo_hints, sha256, stable_id, validate_v1_assignments,
)
from geometry_v1 import components_for_faces, transform_hash, transform_points

ALGORITHM_VERSION = "photo-source-face-v1"
DEPTH_TOLERANCE_M = 0.08
MAX_DEPTH_FRAME_DELTA_S = 0.20
MAX_DEPTH_POSE_TRANSLATION_M = 0.06
MAX_DEPTH_POSE_ANGLE_RAD = 0.15
POINT_RADIUS_PX = 24.0
NEGATIVE_RADIUS_PX = 30.0


def column_major_matrix(values, shape):
    data = np.asarray(values, dtype=np.float64)
    if data.size != shape[0] * shape[1] or not np.isfinite(data).all():
        raise ValueError("invalid calibrated matrix")
    return data.reshape(shape, order="F")


def upright_to_sensor_norm(point):
    """Undo prepare_photos.py's clockwise 90-degree rotation.

    Thumbnail downscaling preserves normalized coordinates; cropping does not.
    """
    u, v = point
    return v, 1.0 - u


def sensor_to_upright_norm(u, v, width, height):
    return 1.0 - v / height, u / width


def project_session_points(points, camera_to_session, intrinsics, width, height):
    camera = column_major_matrix(camera_to_session, (4, 4))
    intrinsic = column_major_matrix(intrinsics, (3, 3))
    if width < 1 or height < 1 or intrinsic[0, 0] <= 0 or intrinsic[1, 1] <= 0:
        raise ValueError("invalid image dimensions or intrinsics")
    inverse = np.linalg.inv(camera)
    local = np.asarray(points, dtype=np.float64) @ inverse[:3, :3].T + inverse[:3, 3]
    depth = -local[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        x = intrinsic[0, 0] * local[:, 0] / depth + intrinsic[0, 2]
        y = -intrinsic[1, 1] * local[:, 1] / depth + intrinsic[1, 2]
    in_frame = (np.isfinite(x) & np.isfinite(y) & (depth > 0.15) &
                (x >= 0) & (x < width) & (y >= 0) & (y < height))
    return x, y, depth, in_frame


def nearest_depth_frame(photo, frames):
    photo_pose = column_major_matrix(photo["transform"], (4, 4))
    best = None
    for frame in frames:
        if frame.get("room") != photo.get("room"):
            continue
        delta = abs(float(frame["timestamp"]) - float(photo["timestamp"]))
        if delta > MAX_DEPTH_FRAME_DELTA_S:
            continue
        depth_pose = column_major_matrix(frame["transform"], (4, 4))
        translation = np.linalg.norm(photo_pose[:3, 3] - depth_pose[:3, 3])
        cosine = np.clip((np.trace(photo_pose[:3, :3].T @ depth_pose[:3, :3]) - 1) / 2, -1, 1)
        angle = float(np.arccos(cosine))
        if translation > MAX_DEPTH_POSE_TRANSLATION_M or angle > MAX_DEPTH_POSE_ANGLE_RAD:
            continue
        score = delta / MAX_DEPTH_FRAME_DELTA_S + translation / MAX_DEPTH_POSE_TRANSLATION_M + angle / MAX_DEPTH_POSE_ANGLE_RAD
        if best is None or score < best[0]:
            best = (score, frame, delta, float(translation), angle)
    return best


def _inside_bundle(bundle: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative.startswith("depth/"):
        raise ValueError("depth frame path is invalid")
    path = (bundle / relative).resolve()
    if not path.is_relative_to(bundle.resolve()):
        raise ValueError("depth frame path escapes bundle")
    return path


def load_depth_frame(bundle: Path, frame):
    width, height = int(frame["width"]), int(frame["height"])
    if not 1 <= width <= 2048 or not 1 <= height <= 2048:
        raise ValueError("unsupported depth dimensions")
    depth_path = _inside_bundle(bundle, frame["file"])
    confidence_path = _inside_bundle(bundle, frame["confidence"])
    if depth_path.suffix != ".f16z" or confidence_path.suffix != ".conf":
        raise ValueError("depth file format is unsupported")
    expected = width * height * 2
    if depth_path.stat().st_size > expected * 2:
        raise ValueError("compressed depth exceeds limit")
    inflater = zlib.decompressobj(-15)
    raw = inflater.decompress(depth_path.read_bytes(), expected + 1) + inflater.flush()
    if len(raw) != expected or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        raise ValueError("depth dimensions or compression mismatch")
    confidence = confidence_path.read_bytes()
    if len(confidence) != width * height:
        raise ValueError("depth confidence dimensions mismatch")
    return (np.frombuffer(raw, dtype="<f2").astype(np.float32).reshape(height, width),
            np.frombuffer(confidence, dtype=np.uint8).reshape(height, width))


def depth_supported_faces(points, frame, depth_map, confidence_map):
    width, height = int(frame["width"]), int(frame["height"])
    u, v, z, in_frame = project_session_points(
        points, frame["transform"], frame["intrinsics"], width, height)
    face_ids = np.flatnonzero(in_frame & (z < 5.0))
    supported = np.zeros(len(points), dtype=bool)
    residual = np.full(len(points), np.inf, dtype=np.float32)
    if not len(face_ids):
        return supported, residual
    x, y = np.rint(u[face_ids]).astype(int), np.rint(v[face_ids]).astype(int)
    measured = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            xx, yy = np.clip(x + dx, 0, width - 1), np.clip(y + dy, 0, height - 1)
            value = depth_map[yy, xx]
            good = np.isfinite(value) & (value > 0.15) & (confidence_map[yy, xx] >= 1)
            measured.append(np.where(good, value, np.inf))
    values = np.sort(np.stack(measured, axis=0), axis=0)
    counts = np.isfinite(values).sum(axis=0)
    median = values[np.maximum((counts - 1) // 2, 0), np.arange(len(face_ids))]
    difference = np.abs(z[face_ids] - median)
    tolerance = DEPTH_TOLERANCE_M + 0.03 * z[face_ids]
    good = (counts >= 3) & np.isfinite(median) & (difference <= tolerance)
    supported[face_ids] = good
    residual[face_ids] = difference
    return supported, residual


def _seed_near_point(point, visible_ids, sensor_u, sensor_v, width, height, residual):
    raw_u, raw_v = upright_to_sensor_norm(point)
    distance = np.hypot(sensor_u[visible_ids] - raw_u * width,
                        sensor_v[visible_ids] - raw_v * height)
    near = distance <= POINT_RADIUS_PX
    if not near.any():
        return None
    choices = visible_ids[near]
    score = distance[near] + residual[choices] * 40.0
    return int(choices[np.argmin(score)])


def project_hints(*, scan_id, source_hash, transform_id, vertices_session, faces,
                  classes, buckets, room, photos, depth_frames, bundle_dir, hints,
                  hints_hash=None):
    """Return a source-face evidence ledger without changing any v1 assignment."""
    if len(faces) != len(classes):
        raise ValueError("raw class count differs from original PLY faces")
    if len({hint["photoId"] for hint in hints}) > 12:
        raise ValueError("at most twelve distinct posed photos may be projected per job")
    room_matrix = column_major_matrix(room["transform"]["worldToRoom"], (4, 4))
    vertices_room = transform_points(np.asarray(vertices_session), room_matrix)
    centers_session, _ = face_geometry(vertices_session, faces)
    centers_room, normals_room = face_geometry(vertices_room, faces)
    structure_geometry, warning = hard_structure_mask(centers_room, normals_room, room, 0.06)
    eligible = np.zeros(len(faces), dtype=bool)
    for bucket in ("unknown", "one-owner", "conflict"):
        if bucket in buckets:
            eligible[buckets[bucket]] = True
    eligible &= np.isin(classes, FURNITURE_PRIOR_CLASSES) & ~structure_geometry
    if "structure" in buckets:
        eligible[buckets["structure"]] = False
    photo_by_id = {p["file"]: p for p in photos}
    proposals = []
    cached = {}
    for hint_index, hint in enumerate(hints):
        photo_id = hint["photoId"]
        if photo_id not in photo_by_id:
            raise ValueError("photo semantic hint references absent original photo")
        photo = photo_by_id[photo_id]
        if photo_id not in cached:
            match = nearest_depth_frame(photo, depth_frames)
            if match is None:
                cached[photo_id] = (None, None, None, None, None, None,
                                    "no-nearby-calibrated-depth-frame")
            else:
                _, depth_frame, delta, translation, angle = match
                try:
                    depth_map, confidence_map = load_depth_frame(bundle_dir, depth_frame)
                except (OSError, ValueError, zlib.error):
                    cached[photo_id] = (None, None, None, None, None, None,
                                        "depth-frame-unreadable")
                else:
                    sensor_u, sensor_v, _, photo_in_frame = project_session_points(
                        centers_session, photo["transform"], photo["intrinsics"],
                        int(photo["width"]), int(photo["height"]))
                    supported, residual = depth_supported_faces(
                        centers_session, depth_frame, depth_map, confidence_map)
                    cached[photo_id] = (depth_frame, (delta, translation, angle),
                                        sensor_u, sensor_v, photo_in_frame & supported, residual, None)
        depth_frame, pose_delta, sensor_u, sensor_v, visible, residual, depth_error = cached[photo_id]
        flags = []
        selected = np.empty(0, dtype=np.int64)
        positive = []
        negative = []
        all_bbox_visible_count = 0
        if depth_frame is None:
            flags.append(depth_error)
        else:
            width, height = int(photo["width"]), int(photo["height"])
            display_u, display_v = sensor_to_upright_norm(sensor_u, sensor_v, width, height)
            region = visible & eligible
            box = hint["bboxNorm"]
            if box:
                region &= ((display_u >= box[0]) & (display_u <= box[2]) &
                           (display_v >= box[1]) & (display_v <= box[3]))
            else:
                region &= False
                for point in hint["positivePointsNorm"]:
                    pu, pv = upright_to_sensor_norm(point)
                    region |= visible & eligible & (np.hypot(sensor_u - pu * width,
                                                              sensor_v - pv * height) <= 3 * POINT_RADIUS_PX)
            visible_ids = np.flatnonzero(region)
            all_bbox_visible_count = int(len(visible_ids))
            for point in hint["positivePointsNorm"]:
                face_id = _seed_near_point(point, visible_ids, sensor_u, sensor_v,
                                           width, height, residual)
                if face_id is not None:
                    positive.append(face_id)
            for point in hint["negativePointsNorm"]:
                pu, pv = upright_to_sensor_norm(point)
                near = np.hypot(sensor_u[visible_ids] - pu * width,
                                sensor_v[visible_ids] - pv * height) <= NEGATIVE_RADIUS_PX
                negative.extend(visible_ids[near].tolist())
            if not hint["positivePointsNorm"]:
                flags.append("bbox-only-needs-positive-pixel-seed")
            elif not positive:
                flags.append("positive-point-has-no-depth-supported-ply-face")
            else:
                remaining = visible_ids[~np.isin(visible_ids, negative)]
                seeds = np.unique(np.asarray(positive, dtype=np.int64))
                if np.isin(seeds, remaining).all():
                    connected = [component for component in components_for_faces(faces, remaining)
                                 if np.isin(seeds, component).any()]
                    if connected:
                        selected = np.unique(np.concatenate(connected))
                else:
                    flags.append("positive-and-negative-points-conflict")
            if not len(selected):
                flags.append("no-connected-depth-supported-surface")
        known_owner_ids = np.intersect1d(
            selected, np.concatenate([buckets.get("one-owner", np.empty(0, dtype=np.int64)),
                                      buckets.get("conflict", np.empty(0, dtype=np.int64))]),
            assume_unique=False)
        if len(known_owner_ids):
            flags.append("overlaps-existing-roomplan-assignment-review-required")
        proposal = {
            "instanceId": stable_id(source_hash, "photo-region",
                                    f"{hints_hash or 'supplied'}:{hint_index}:{photo_id}"),
            "categoryCandidates": [hint["category"]], "photoId": photo_id,
            "hintIndex": hint_index, "aiConfidence": hint["confidence"],
            "semanticSource": "photo-hint-plus-measured-depth; unreviewed",
            "reviewState": "unreviewed", "ownershipState": "unchanged-v1",
            "depthFrameFile": depth_frame["file"] if depth_frame else None,
            "depthPoseDelta": dict(zip(("seconds", "translationM", "angleRad"), pose_delta)) if pose_delta else None,
            "depthVisibleRegionFaceCount": all_bbox_visible_count,
            "positiveSourceFaceIds": sorted(set(positive)),
            "negativeSourceFaceIds": sorted(set(negative)),
            "sourceFaceIds": selected.tolist(), "sourceFaceCount": int(len(selected)),
            "aabbRoomLocalM": bounds_of_faces(vertices_room, faces, selected),
            "existingOwnerConflictFaceCount": int(len(known_owner_ids)),
            "existingOwnerConflictSourceFaceIds": known_owner_ids.tolist(),
            "reviewFlags": flags, "multiViewFaceCount": 0,
            "warning": "Measured PLY candidate only; photo box and depth do not prove object boundary.",
        }
        proposals.append(proposal)

    category_views = {}
    for proposal in proposals:
        category = proposal["categoryCandidates"][0]
        views = category_views.setdefault(category, {})
        for face_id in proposal["sourceFaceIds"]:
            views.setdefault(face_id, set()).add(proposal["photoId"])
    for proposal in proposals:
        views = category_views[proposal["categoryCandidates"][0]]
        proposal["multiViewFaceCount"] = sum(len(views[face_id]) >= 2 for face_id in proposal["sourceFaceIds"])
        if proposal["sourceFaceIds"] and proposal["multiViewFaceCount"] == 0:
            proposal["reviewFlags"].append("single-view-unconfirmed")
    return {
        "schemaVersion": 1, "algorithmVersion": ALGORITHM_VERSION,
        "scanId": scan_id, "frame": "room-local-m",
        "sourceHash": source_hash, "transformHash": transform_id,
        "photoHintsHash": hints_hash, "photoFrameConvention": "upright-cw90-normalized-to-original-sensor",
        "originalOwnerAssignmentsPreserved": True,
        "sourceFaceCount": int(len(faces)), "proposals": proposals,
        "warnings": [v for v in (warning, "Proposals require human review; no face owner was modified.") if v],
    }


def write_safely(scan_dir: Path, out_dir: Path, payload: dict):
    scan_dir = scan_dir.resolve()
    out_dir = out_dir.resolve()
    private = (EXPERIMENT / ".private").resolve()
    if not scan_dir.is_relative_to(private) or scan_dir == private:
        raise ValueError("scan directory must be within experiment/.private")
    if not out_dir.is_relative_to(scan_dir) or not out_dir.name.startswith("derived-v4-photo"):
        raise ValueError("photo projection output must be a private derived-v4-photo directory")
    target = out_dir / "photo-face-proposals.json"
    if target.exists() and load_json(target).get("inputHashes") != payload["inputHashes"]:
        raise ValueError("existing photo projection belongs to different inputs")
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=out_dir,
                                     prefix=".photo-projection-", suffix=".json", delete=False) as stream:
        json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        stream.write("\n")
        staged = Path(stream.name)
    os.replace(staged, target)
    return target


def run(args):
    scan_dir = args.scan_dir.resolve()
    bundle = (args.bundle or scan_dir / "source/Room").resolve()
    source = (args.source or scan_dir / "raw-mesh.ply").resolve()
    converted = (args.converted or scan_dir / "converted.json").resolve()
    assignments = (args.assignments or scan_dir / "derived-v1/face-assignments.json").resolve()
    manifest = (args.manifest or scan_dir / "derived-v1/layer-manifest.json").resolve()
    hints_path = args.photo_hints.resolve()
    room = load_json(converted)
    scan_id = args.scan_id or scan_dir.name
    transform_id = transform_hash(room["transform"]["worldToRoom"])
    if load_json(manifest).get("transformHash") != transform_id:
        raise ValueError("v1 manifest and converted room transform disagree")
    valid_photo_ids = {p["file"] for p in room.get("photos", [])}
    parse_pending_photo_hints(hints_path, scan_id, valid_photo_ids)
    raw_hints = load_json(hints_path)
    hints = raw_hints.get("payload", raw_hints)["hints"]
    source_hash = sha256(source)
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces):
        raise ValueError("original PLY has no triangle faces")
    faces = np.asarray(mesh.faces, dtype=np.int64)
    buckets = validate_v1_assignments(load_json(assignments), source_hash, len(faces))
    classes, _ = parse_face_classes(mesh, len(faces))
    photos = load_json(bundle / "photos/photos.json")
    frames = load_json(bundle / "depth/frames.json")
    if not isinstance(photos, list) or not isinstance(frames, list):
        raise ValueError("bundle photo and depth indexes must be arrays")
    result = project_hints(
        scan_id=scan_id, source_hash=source_hash, transform_id=transform_id,
        vertices_session=np.asarray(mesh.vertices), faces=faces, classes=classes,
        buckets=buckets, room=room, photos=photos, depth_frames=frames,
        bundle_dir=bundle, hints=hints, hints_hash=sha256(hints_path))
    result["inputHashes"] = {
        "raw-mesh.ply": source_hash, "converted.json": sha256(converted),
        "face-assignments.json": sha256(assignments), "layer-manifest.json": sha256(manifest),
        "photos.json": sha256(bundle / "photos/photos.json"),
        "frames.json": sha256(bundle / "depth/frames.json"),
        "photo-hints.json": sha256(hints_path),
        "algorithmVersion": ALGORITHM_VERSION,
    }
    frame_by_file = {frame["file"]: frame for frame in frames}
    for photo_id in {proposal["photoId"] for proposal in result["proposals"]}:
        photo_path = (bundle / photo_id).resolve()
        if not photo_path.is_relative_to(bundle) or not photo_path.is_file():
            raise ValueError("original selected photo is missing or escapes bundle")
        result["inputHashes"]["photo:" + photo_id] = sha256(photo_path)
    for frame_file in {proposal["depthFrameFile"] for proposal in result["proposals"]
                       if proposal["depthFrameFile"]}:
        frame = frame_by_file[frame_file]
        for relative in (frame["file"], frame["confidence"]):
            result["inputHashes"]["depth:" + relative] = sha256(_inside_bundle(bundle, relative))
    return write_safely(scan_dir, args.out, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-dir", type=Path, required=True)
    parser.add_argument("--scan-id")
    parser.add_argument("--bundle", type=Path, help="extracted session bundle containing photos and depth")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--converted", type=Path)
    parser.add_argument("--assignments", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--photo-hints", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    target = run(args)
    payload = load_json(target)
    print(json.dumps({"out": str(target), "scanId": payload["scanId"],
                      "proposalCount": len(payload["proposals"]),
                      "sourceFacesSuggested": sum(p["sourceFaceCount"] for p in payload["proposals"])},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
