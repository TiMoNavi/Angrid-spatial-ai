#!/usr/bin/env python3
"""Create additive, review-only voxel layers from the Office 2 rescan.

Every observed face remains in the original derived-v1 assignment ledger. This
script partitions only the existing unknown faces for display and adds a
separate overlay for table-owned faces near the chair. No source is changed.
"""

import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
import trimesh


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
PRIVATE = EXPERIMENT / ".private" / "office-2-rescan"
DERIVED_V1 = PRIVATE / "derived-v1"
DERIVED_V2 = PRIVATE / "derived-v2"
SCAN_ID = "office-2-rescan"
EXPECTED_SOURCE_HASH = "bc2380b58762a7e1d7698b0d9ecc4757f6b50b259f0e01025c3924b69c930d63"
PHOTO_SOURCE_FACE_IDS = (339880, 344246, 340065, 356310, 185525)
SOFA_SPATIAL_COMPONENT_ANCHOR = 21206
SOFA_SEED_ROI = ((0.16, 0.28, -0.40), (0.60, 0.70, 0.30))
SOFA_EXPANSION_ROI = ((0.13, 0.04, -1.27), (1.06, 1.25, 0.60))
SOFA_STRUCTURE_EXCLUSION_M = 0.06
KNOWN_OBJECT_EXCLUSION_M = 0.045
CHAIR_NEAR_MARGIN_M = 0.20
CHAIR_TABLE_REVIEW_MARGIN_M = 0.045

sys.path.insert(0, str(EXPERIMENT / "实验9_先切分后分类体素"))
from prepare_classified import (  # noqa: E402
    components_for_faces,
    grid_payload,
    local_coordinates,
    structure_assignment,
    surface_cells,
    transform_hash,
    transform_points,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"),
                               allow_nan=False) + "\n", encoding="utf-8")


def face_centers_and_normals(vertices, faces):
    triangles = vertices[faces]
    centers = triangles.mean(axis=1)
    cross = np.cross(triangles[:, 1] - triangles[:, 0],
                     triangles[:, 2] - triangles[:, 0])
    normals = cross / np.maximum(np.linalg.norm(cross, axis=1)[:, None], 1e-20)
    return centers, normals


def inside_roi(points, roi):
    lower, upper = (np.asarray(edge) for edge in roi)
    return np.all((points >= lower) & (points <= upper), axis=1)


def inside_obb(points, item, margin):
    local = local_coordinates(points, item)
    return np.all(np.abs(local) <= np.asarray(item["size"]) / 2 + margin, axis=1)


def face_edges(faces):
    return {tuple(edge) for edge in np.sort(
        faces[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1)}


def selected_unknown_components(faces, unknown_ids):
    components = components_for_faces(faces, unknown_ids)
    by_face = np.full(len(faces), -1, dtype=np.int32)
    for index, component in enumerate(components):
        by_face[component] = index
    photo_components = {int(by_face[face]) for face in PHOTO_SOURCE_FACE_IDS}
    if -1 in photo_components or len(photo_components) != 2:
        raise ValueError("Photo sofa anchors are no longer two unknown components")
    spatial_component = int(by_face[SOFA_SPATIAL_COMPONENT_ANCHOR])
    if spatial_component < 0 or spatial_component in photo_components:
        raise ValueError("Independent spatial sofa component was not found")
    return components, by_face, photo_components, spatial_component


def sofa_candidates(room, faces, centers, normals, classes, unknown_ids):
    components, by_face, photo_components, spatial_component = selected_unknown_components(
        faces, unknown_ids)
    own = by_face[unknown_ids]
    photo_component = np.isin(own, list(photo_components))
    expanded_component = photo_component | (own == spatial_component)
    point = centers[unknown_ids]
    raw_unknown = classes[unknown_ids] == 0
    # This is a conservative exclusion for candidate display, not a change to
    # the original structure assignment or an assertion that all other faces
    # are wall/floor.
    structural = structure_assignment(
        point, normals[unknown_ids], room, SOFA_STRUCTURE_EXCLUSION_M)
    known_object = np.zeros(len(unknown_ids), dtype=bool)
    for item in room["objects"]:
        known_object |= inside_obb(point, item, KNOWN_OBJECT_EXCLUSION_M)
    common = raw_unknown & ~structural & ~known_object
    core_mask = photo_component & common & inside_roi(point, SOFA_SEED_ROI)
    expanded_mask = (expanded_component & common &
                     inside_roi(point, SOFA_EXPANSION_ROI) & ~core_mask)
    core = np.sort(unknown_ids[core_mask])
    expanded = np.sort(unknown_ids[expanded_mask])
    if not set(PHOTO_SOURCE_FACE_IDS).issubset(set(core.tolist())):
        raise ValueError("A photo-verified sofa anchor was excluded from the core")
    return core, expanded, {
        "photoFaceIds": list(PHOTO_SOURCE_FACE_IDS),
        "photoUri": "photos/0142.jpg",
        "photoIndex": 63,
        "photoComponentSizes": sorted(int(len(components[index])) for index in photo_components),
        "spatialComponentAnchor": SOFA_SPATIAL_COMPONENT_ANCHOR,
        "spatialComponentSize": int(len(components[spatial_component])),
        "seedRoiRoomLocalM": SOFA_SEED_ROI,
        "expansionRoiRoomLocalM": SOFA_EXPANSION_ROI,
        "structuralExclusionM": SOFA_STRUCTURE_EXCLUSION_M,
        "knownObjectExclusionM": KNOWN_OBJECT_EXCLUSION_M,
        "note": "Core is photo anchored; expansion is observed surface geometry only. Both remain unreviewed, incomplete, and not solid furniture.",
    }


def chair_candidates(room, faces, centers, classes, unknown_ids, report):
    chairs = [(i, row) for i, row in enumerate(room["objects"])
              if row["category"] == "chair"]
    if len(chairs) != 1:
        raise ValueError("Expected one RoomPlan chair in this pinned rescan")
    chair_index, chair = chairs[0]
    chair_observed = np.asarray(report["objects"][chair_index]["sourceFaceIds"],
                                dtype=np.int64)
    chair_edges = face_edges(faces[chair_observed])
    unknown_seat = unknown_ids[classes[unknown_ids] == 5]
    components = components_for_faces(faces, unknown_seat)
    adjacent = [component for component in components
                if len(component) >= 25 and bool(face_edges(faces[component]) & chair_edges)]
    if len(adjacent) != 2:
        raise ValueError("Expected two substantial unknown chair-adjacent components")
    nearby = np.concatenate(adjacent)
    point = centers[nearby]
    close = inside_obb(point, chair, CHAIR_NEAR_MARGIN_M)
    # RoomPlan front points toward -X for this source-hash-pinned chair. Its
    # observed continuation is on the opposite, rear side. Keep this a
    # review-only spatial heuristic, not a new owner assignment.
    front = np.asarray(chair["front"])
    if not (front[0] < -0.9 and abs(front[1]) < 0.1):
        raise ValueError("Chair facing changed; review posterior rule")
    behind = point[:, 0] >= chair["center"][0]
    supported_height = (point[:, 1] >= 0) & (point[:, 1] <=
                         chair["center"][1] + chair["size"][1] / 2 + CHAIR_NEAR_MARGIN_M)
    continuation = np.sort(nearby[close & behind & supported_height])
    return continuation, {
        "roomPlanChairObjectId": report["objects"][chair_index]["objectId"],
        "sharedEdgeComponentSizes": sorted(int(len(component)) for component in adjacent),
        "nearMarginM": CHAIR_NEAR_MARGIN_M,
        "posteriorTest": "center x >= chair.center.x; chair front is -X",
        "reviewState": "unreviewed",
        "note": "The selected seat-class surface is still unknown in derived-v1; adjacent mesh and position are only candidate evidence.",
    }


def chair_table_review(room, vertices, faces, centers, report):
    chair = room["objects"][0]
    # The long table is verified as index 1 for this exact source hash. These
    # faces remain table-owned in the original ledger until manual review.
    table = report["objects"][1]
    if table["category"] != "table":
        raise ValueError("The verified long-table slot changed")
    table_ids = np.asarray(table["sourceFaceIds"], dtype=np.int64)
    center_inside = inside_obb(centers[table_ids], chair,
                               CHAIR_TABLE_REVIEW_MARGIN_M)
    near = table_ids[center_inside]
    corners = local_coordinates(vertices[faces[near]].reshape(-1, 3), chair)
    corners = corners.reshape(-1, 3, 3)
    fully_inside = np.all(
        np.abs(corners) <= np.asarray(chair["size"]) / 2 +
        CHAIR_TABLE_REVIEW_MARGIN_M, axis=(1, 2))
    review = np.sort(near[~fully_inside])
    return review, {
        "currentOwnerObjectId": table["objectId"],
        "candidateChairObjectId": report["objects"][0]["objectId"],
        "marginM": CHAIR_TABLE_REVIEW_MARGIN_M,
        "reviewState": "unreviewed",
        "note": "Current derived-v1 table ownership remains unchanged. A center-in/vertex-out chair test is not enough to reassign a face.",
    }


def main():
    started = time.perf_counter()
    source = PRIVATE / "raw-mesh.ply"
    if sha256(source) != EXPECTED_SOURCE_HASH:
        raise ValueError("Office 2 rescan PLY sourceHash mismatch")
    room = load_json(PRIVATE / "converted.json")
    original_manifest = load_json(DERIVED_V1 / "layer-manifest.json")
    original_report = load_json(DERIVED_V1 / "segment-report.json")
    assignment = load_json(DERIVED_V1 / "face-assignments.json")
    matrix = np.asarray(room["transform"]["worldToRoom"]).reshape(4, 4, order="F")
    thash = transform_hash(room["transform"]["worldToRoom"])
    if (original_manifest["scanId"] != SCAN_ID or
            original_manifest["transformHash"] != thash or
            assignment["sourceHash"] != EXPECTED_SOURCE_HASH):
        raise ValueError("Derived-v1 does not match this source and room transform")

    mesh = trimesh.load(source, process=False)
    vertices = transform_points(np.asarray(mesh.vertices), matrix)
    faces = np.asarray(mesh.faces)
    classes = mesh.metadata["_ply_raw"]["face"]["data"]["class"]
    centers, normals = face_centers_and_normals(vertices, faces)
    unknown = np.asarray(assignment["sourceFaceIdsByAssignment"]["unknown"],
                         dtype=np.int64)
    core, expanded, sofa_info = sofa_candidates(
        room, faces, centers, normals, classes, unknown)
    chair, chair_info = chair_candidates(
        room, faces, centers, classes, unknown, original_report)
    table_review, table_info = chair_table_review(
        room, vertices, faces, centers, original_report)

    selected = np.concatenate([core, expanded, chair])
    if len(np.unique(selected)) != len(selected) or not np.isin(selected, unknown).all():
        raise AssertionError("The three candidates overlap or leave the unknown domain")
    residual = unknown[~np.isin(unknown, selected)]
    structure_residual = residual[np.isin(classes[residual], [1, 2, 3])]
    opening_residual = residual[np.isin(classes[residual], [6, 7])]
    object_residual = residual[np.isin(classes[residual], [0, 4, 5])]
    primary_layers = {
        "sofa-core-grid.json": core,
        "sofa-candidate-grid.json": expanded,
        "chair-continuation-grid.json": chair,
        "unknown-structure-residual-grid.json": structure_residual,
        "unknown-opening-residual-grid.json": opening_residual,
        "unknown-object-residual-grid.json": object_residual,
    }
    partition = np.concatenate(list(primary_layers.values()))
    if (len(partition) != len(unknown) or
            not np.array_equal(np.sort(partition), np.sort(unknown)) or
            len(np.unique(partition)) != len(partition)):
        raise AssertionError("Unknown source face conservation failed")
    if not np.isin(table_review, original_report["objects"][1]["sourceFaceIds"]).all():
        raise AssertionError("Chair/table review is no longer table-owned")
    layers = {**primary_layers, "chair-table-review-grid.json": table_review}
    labels = {
        "sofa-core-grid.json": "photo-anchored observed sofa core candidate",
        "sofa-candidate-grid.json": "spatially extended observed sofa candidate",
        "chair-continuation-grid.json": "seat-class chair continuation candidate",
        "chair-table-review-grid.json": "currently table-owned chair overlap review",
        "unknown-structure-residual-grid.json": "unassigned structural-class observation, not confirmed structure",
        "unknown-opening-residual-grid.json": "unassigned opening-class observation, not confirmed opening",
        "unknown-object-residual-grid.json": "remaining unassigned observation, not confirmed furniture",
    }
    output = DERIVED_V2.resolve()
    if not output.is_relative_to((EXPERIMENT / ".private" / SCAN_ID).resolve()):
        raise ValueError("Refusing output outside the private rescan directory")
    output.mkdir(parents=True, exist_ok=True)
    manifest_layers = []
    for name, ids in layers.items():
        meta = {
            "objectId": SCAN_ID + ":" + name.removesuffix("-grid.json"),
            "label": labels[name],
            "reviewState": "unreviewed",
            "faceCount": int(len(ids)),
            "sourceFaceIdSample": ids[:20].tolist(),
            "semanticStatus": "candidate; not a recovered watertight or solid object",
        }
        if name == "sofa-core-grid.json":
            meta["photoSourceFaceIds"] = list(PHOTO_SOURCE_FACE_IDS)
        geometry = grid_payload([(meta, surface_cells(vertices, faces[ids]))],
                                name.removesuffix(".json"),
                                evidence="observed-surface", provenance="measured")
        write_json(output / name, geometry)
        manifest_layers.append({
            "id": name.removesuffix(".json"), "kind": name.removesuffix(".json"),
            "provenance": "measured surface; semantic candidate",
            "geometryUri": name, "units": "m", "frame": "room-local-m",
            "transformHash": thash, "available": True,
            "sha256": sha256(output / name),
            "recordCount": geometry["grids"]["0.2"]["recordCount"],
            "sourceFaceCount": int(len(ids)),
            "reviewState": "unreviewed",
            "warning": labels[name],
        })
        print(name, len(ids), "faces ->",
              geometry["grids"]["0.2"]["recordCount"], "20 cm cells", flush=True)

    report = {
        "schemaVersion": 1, "scanId": SCAN_ID, "frame": "room-local-m",
        "sourceHash": EXPECTED_SOURCE_HASH, "transformHash": thash,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "originalUnknownFaces": int(len(unknown)),
        "unknownPrimaryConservation": {
            "sum": int(sum(len(ids) for ids in primary_layers.values())),
            "originalUnknown": int(len(unknown)), "passes": True,
        },
        "sourceFaceIdsByLayer": {name: ids.tolist() for name, ids in layers.items()},
        "faceCountsByLayer": {name: int(len(ids)) for name, ids in layers.items()},
        "reviewOnlyOutsideUnknown": ["chair-table-review-grid.json"],
        "sofa": sofa_info, "chairContinuation": chair_info,
        "chairTableReview": table_info,
        "limitations": [
            "Source PLY and all derived-v1 assignments remain unchanged.",
            "Photo anchors constrain only a visible patch, not the complete sofa envelope.",
            "The sofa spatial component and 20 cm chair margin are heuristics requiring manual review.",
            "Residual class labels follow raw PLY semantics and do not prove structure, opening, furniture, or empty space.",
            "A surface voxel is not a watertight or solid furniture volume.",
        ],
    }
    write_json(output / "review-report.json", report)
    source_files = [
        {"uri": "converted.json", "sha256": sha256(PRIVATE / "converted.json")},
        {"uri": "raw-mesh.ply", "sha256": EXPECTED_SOURCE_HASH},
        {"uri": "mesh-voxels/raw-room.ply",
         "sha256": sha256(PRIVATE / "mesh-voxels/raw-room.ply")},
        {"uri": "derived-v1/layer-manifest.json",
         "sha256": sha256(DERIVED_V1 / "layer-manifest.json")},
    ]
    write_json(output / "layer-manifest.json", {
        "schemaVersion": 1, "scanId": SCAN_ID, "frame": "room-local-m",
        "transformHash": thash, "sourceFiles": source_files,
        "layers": manifest_layers, "reportUri": "review-report.json",
        "reportHash": sha256(output / "review-report.json"),
        "originalUnknownLayerPreserved": True,
        "v1FurnitureOwnershipPreserved": True,
        "observedFreeAvailable": False,
    })
    print("unknown conservation:", len(unknown), "=",
          sum(len(ids) for ids in primary_layers.values()),
          "; chair/table review-only:", len(table_review),
          "; elapsed:", round(time.perf_counter() - started, 3), "s", flush=True)


if __name__ == "__main__":
    main()
