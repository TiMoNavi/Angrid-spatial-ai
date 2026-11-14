#!/usr/bin/env python3
"""Read-only, per-scan audit of furniture slicing on the two Office 2 captures.

The scans use different room frames and object IDs. This intentionally does not
match objects across captures or interpret a missing surface as proof of a scan
failure. The only write is a JSON report in the rescan's ignored QA directory.
"""

import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import trimesh


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
PRIVATE = EXPERIMENT / ".private"
DESTINATION = PRIVATE / "office-2-rescan/qa/experiment13/scan-comparison.json"
sys.path.insert(0, str(EXPERIMENT / "实验9_先切分后分类体素"))
from prepare_classified import (  # noqa: E402
    local_coordinates,
    structure_assignment,
    transform_hash,
    transform_points,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def bounds(points):
    if len(points) == 0:
        return None
    return {"min": np.min(points, axis=0).tolist(),
            "max": np.max(points, axis=0).tolist()}


def face_bounds(vertices, faces, ids):
    if len(ids) == 0:
        return None
    return bounds(vertices[faces[ids]].reshape(-1, 3))


def scan_audit(scan_id: str):
    root = PRIVATE / scan_id
    derived = root / "derived-v1"
    room = json.loads((root / "converted.json").read_text())
    report = json.loads((derived / "segment-report.json").read_text())
    manifest = json.loads((derived / "layer-manifest.json").read_text())
    assignments = json.loads((derived / "face-assignments.json").read_text())
    source = root / "raw-mesh.ply"
    if manifest["scanId"] != report["scanId"] or manifest["scanId"] != scan_id:
        raise ValueError("scanId mismatch: " + scan_id)
    if manifest["transformHash"] != transform_hash(room["transform"]["worldToRoom"]):
        raise ValueError("transformHash mismatch: " + scan_id)
    if assignments["sourceHash"] != sha256(source):
        raise ValueError("PLY sourceHash mismatch: " + scan_id)

    mesh = trimesh.load(source, process=False)
    raw = mesh.metadata["_ply_raw"]
    vertex_data = raw["vertex"]["data"]
    face_data = raw["face"]["data"]
    faces = np.asarray(mesh.faces)
    matrix = np.asarray(room["transform"]["worldToRoom"]).reshape(4, 4, order="F")
    vertices = transform_points(np.asarray(mesh.vertices), matrix)
    centers = vertices[faces].mean(axis=1)
    edges_a = vertices[faces[:, 1]] - vertices[faces[:, 0]]
    edges_b = vertices[faces[:, 2]] - vertices[faces[:, 0]]
    cross = np.cross(edges_a, edges_b)
    area2 = np.linalg.norm(cross, axis=1)
    normals = cross / np.maximum(area2[:, None], 1e-20)
    eligible = np.all(vertex_data["inroom"][faces] == 1, axis=1) & (area2 > 1e-6)
    structure = structure_assignment(
        centers, normals, room, report["parameters"]["structureDistanceM"]
    ) & eligible
    furniture_eligible = (eligible & ~structure &
                          np.isin(face_data["class"], [0, 4, 5]) &
                          (centers[:, 1] >= 0.035))
    margin = report["parameters"]["marginM"]
    conflict_mask = np.zeros(len(faces), dtype=bool)
    conflict_mask[assignments["sourceFaceIdsByAssignment"].get("conflict", [])] = True
    rows = []
    for index, (item, row, candidate) in enumerate(zip(
            room["objects"], report["objects"],
            assignments["originalCandidatesPreserved"])):
        if row["convertedIndex"] != index or row["objectId"] != candidate["objectId"]:
            raise ValueError("Object/candidate order mismatch: " + scan_id)
        half = np.asarray(item["size"]) / 2
        local_centers = local_coordinates(centers, item)
        center_mask = (np.all(np.abs(local_centers) <= half + margin, axis=1)
                       & furniture_eligible)
        center_ids = np.flatnonzero(center_mask)
        corners = local_coordinates(vertices[faces[center_ids]].reshape(-1, 3), item)
        corners = corners.reshape(-1, 3, 3)
        fully_inside = np.all(np.abs(corners) <= half + margin, axis=(1, 2))
        border_ids = center_ids[~fully_inside]
        strict_ids = center_ids[fully_inside]
        candidate_ids = np.asarray(candidate["sourceFaceIds"], dtype=np.int64)
        exclusive_ids = np.asarray(row["sourceFaceIds"], dtype=np.int64)
        conflict_ids = candidate_ids[conflict_mask[candidate_ids]]
        if not np.array_equal(np.sort(candidate_ids), strict_ids):
            raise ValueError("Recomputed strict candidate differs from face ledger: " + scan_id)
        if len(candidate_ids) != row["candidateFaceCount"]:
            raise ValueError("Candidate count mismatch: " + scan_id)
        if len(exclusive_ids) != row["faceCount"] or len(conflict_ids) != row["conflictFaceCount"]:
            raise ValueError("Owner/conflict count mismatch: " + scan_id)
        exclusive_aabb = face_bounds(vertices, faces, exclusive_ids)
        if (exclusive_aabb is None) != (row["aabb"] is None):
            raise ValueError("Exclusive AABB presence mismatch: " + scan_id)
        if exclusive_aabb is not None:
            for side in ("min", "max"):
                if not np.allclose(exclusive_aabb[side], row["aabb"][side], atol=1e-6):
                    raise ValueError("Exclusive AABB differs from report: " + scan_id)
        rows.append({
            "objectId": row["objectId"],
            "convertedIndexWithinThisScanOnly": index,
            "category": row["category"],
            "roomPlanObb": row["roomPlanObb"],
            "centerInsideExpandedObbFaces": int(len(center_ids)),
            "centerInsideButVertexOutsideFaces": int(len(border_ids)),
            "centerInsideButVertexOutsideSourceFaceIdSample": border_ids[:20].tolist(),
            "strictCandidateFaces": int(len(candidate_ids)),
            "strictCandidateSourceFaceIdSample": candidate_ids[:20].tolist(),
            "candidateSupportAabbIncludingConflict": face_bounds(vertices, faces, candidate_ids),
            "conflictCandidateFaces": int(len(conflict_ids)),
            "conflictSourceFaceIdSample": conflict_ids[:20].tolist(),
            "retainedExclusiveFaces": int(len(exclusive_ids)),
            "retainedExclusiveAabb": exclusive_aabb,
            "reportedExclusiveAabb": row["aabb"],
            "roomPlanMappingState": row["mappingState"],
        })
    return {
        "scanId": scan_id,
        "sourcePlySha256": assignments["sourceHash"],
        "transformHash": manifest["transformHash"],
        "sourceFaces": len(faces),
        "eligibleFaces": report["eligibleFaces"],
        "faceAssignments": report["assignments"],
        "faceConservationPassed": report["conservation"]["passes"],
        "marginM": margin,
        "minComponentFaces": report["parameters"]["minComponentFaces"],
        "totalCenterInsideButVertexOutsideFaces": sum(
            row["centerInsideButVertexOutsideFaces"] for row in rows),
        "objects": rows,
    }


def main():
    scans = [scan_audit(scan_id) for scan_id in ("office-2", "office-2-rescan")]
    report = {
        "schemaVersion": 1,
        "frame": "per-scan room-local-m",
        "crossScanRegistrationAvailable": False,
        "crossScanObjectMatchingAvailable": False,
        "warning": "Do not align object array indices or attribute AABB differences to Apple or scanning before fixed-structure registration and manual object matching.",
        "scans": scans,
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(report, ensure_ascii=False, indent=2,
                                      allow_nan=False) + "\n", encoding="utf-8")
    print("report:", DESTINATION)
    for scan in scans:
        print(scan["scanId"], "boundary candidates",
              scan["totalCenterInsideButVertexOutsideFaces"],
              "per object", [row["centerInsideButVertexOutsideFaces"]
                             for row in scan["objects"]])


if __name__ == "__main__":
    main()
