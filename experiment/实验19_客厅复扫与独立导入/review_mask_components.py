#!/usr/bin/env python3
"""Diagnose spatial components of review-only photo mask source-face proposals.

This does not create accepted object ownership. Combining masks by category is
only a diagnostic grouping: distinct chairs can have the same category.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
import trimesh

HERE = Path(__file__).resolve().parent
PRIVATE = HERE.parent / '.private'
E15 = HERE.parent / '实验15_扫描识别切分与自动导入' / 'pipeline'
sys.path.insert(0, str(E15))
from geometry_v1 import transform_hash, transform_points  # noqa: E402
from instance_candidates import validate_v1_assignments  # noqa: E402
from photo_projection import column_major_matrix  # noqa: E402


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def private_path(path: Path) -> Path:
    path = path.resolve()
    if path == PRIVATE.resolve() or not path.is_relative_to(PRIVATE.resolve()):
        raise ValueError('all inputs and outputs must remain in experiment/.private')
    return path


def spatial_components(ids: np.ndarray, room_centers: np.ndarray,
                       radius_m: float) -> list[np.ndarray]:
    """Group the selected original face centers by radius; preserve their IDs."""
    ids = np.asarray(ids, dtype=np.int64)
    if ids.ndim != 1 or len(ids) != len(np.unique(ids)) or np.any(ids < 0):
        raise ValueError('source face IDs must be unique nonnegative integers')
    if not 0.005 <= radius_m <= 0.1:
        raise ValueError('radius must be between 5 and 100 millimeters')
    if len(ids) > 100000:
        raise ValueError('review candidate exceeds bounded spatial trial')
    if not len(ids):
        return []
    points = np.asarray(room_centers)[ids]
    if points.shape != (len(ids), 3) or not np.isfinite(points).all():
        raise ValueError('source-face room coordinates are invalid')
    if len(ids) == 1:
        return [ids.copy()]
    pairs = np.asarray(list(cKDTree(points).query_pairs(radius_m)), dtype=np.int64).reshape(-1, 2)
    graph = coo_matrix((np.ones(2 * len(pairs), dtype=np.int8),
                        (np.r_[pairs[:, 0], pairs[:, 1]],
                         np.r_[pairs[:, 1], pairs[:, 0]])),
                       shape=(len(ids), len(ids))).tocsr()
    _, labels = connected_components(graph, directed=False)
    sizes = np.bincount(labels)
    order = sorted(range(len(sizes)), key=lambda k: (-sizes[k], int(ids[labels == k].min())))
    return [np.sort(ids[labels == k]) for k in order]


def summarize_components(components: list[np.ndarray], room_centers: np.ndarray,
                         classes: np.ndarray, buckets: dict[str, np.ndarray],
                         photo_faces: dict[str, set[int]]) -> list[dict]:
    owner = set(map(int, buckets.get('one-owner', []))) | set(map(int, buckets.get('conflict', [])))
    bucket_sets = {key: set(map(int, ids)) for key, ids in buckets.items()}
    rows = []
    for index, ids in enumerate(components):
        face_set = set(map(int, ids))
        xyz = room_centers[ids]
        names, counts = np.unique(classes[ids], return_counts=True)
        views = Counter(face_id for photo_ids in photo_faces.values() for face_id in photo_ids
                        if face_id in face_set)
        rows.append({
            'componentIndex': index,
            'sourceFaceCount': len(ids),
            'sourceFaceIdsSha256': hashlib.sha256(','.join(map(str, ids)).encode()).hexdigest(),
            'aabbRoomLocalM': {'min': np.min(xyz, axis=0).round(6).tolist(),
                               'max': np.max(xyz, axis=0).round(6).tolist()},
            'medianRoomLocalM': np.median(xyz, axis=0).round(6).tolist(),
            'rawArkitClassCounts': {str(int(name)): int(count)
                                   for name, count in zip(names, counts)},
            'photoSourceFaceCounts': {photo: len(face_set & photo_ids)
                                      for photo, photo_ids in sorted(photo_faces.items())
                                      if face_set & photo_ids},
            'supportedByTwoOrMorePhotosFaceCount': sum(count >= 2 for count in views.values()),
            'originalAssignmentCounts': {name: len(face_set & values)
                                         for name, values in sorted(bucket_sets.items())},
            'existingOwnerConflictFaceCount': len(face_set & owner),
        })
    return rows


def assert_unprotected_candidate_scope(ids: np.ndarray,
                                       buckets: dict[str, np.ndarray]) -> None:
    protected = set(map(int, buckets.get('excluded', [])))
    protected.update(map(int, buckets.get('structure', [])))
    protected.update(map(int, buckets.get('rejected-noise', [])))
    if any(int(face_id) in protected for face_id in ids):
        raise ValueError('mask candidate includes a protected original source face')


def run(scan_dir: Path, report_path: Path, output: Path,
        category: str, radius_m: float = .04, emit_main_cluster: bool = False) -> dict:
    scan_dir, report_path, output = map(private_path, (scan_dir, report_path, output))
    if (report_path.name != 'report.json' or report_path.parent.parent != scan_dir or
            not report_path.parent.name.startswith('derived-v5-full-source')):
        raise ValueError('input must be a scan-local E18 full-source report')
    if (output.parent != scan_dir or
            not (output.name.startswith('derived-v6-review-') or
                 output.name.startswith('e19-review-'))):
        raise ValueError('output must be a new direct scan child named derived-v6-review-* or e19-review-*')
    if output.exists() or not category or len(category) > 80:
        raise ValueError('output must be new and category nonempty')
    report = json.loads(report_path.read_text(encoding='utf-8'))
    manifest = json.loads((scan_dir / 'import-manifest.json').read_text(encoding='utf-8'))
    if (report.get('schemaVersion') != 1 or
            report.get('algorithmVersion') != 'all-source-mask-depth-e18-v1' or
            report.get('scanId') != scan_dir.name or manifest.get('scanId') != scan_dir.name or
            report.get('frame') != 'room-local-m' or
            report.get('originalOwnerAssignmentsPreserved') is not True or
            report.get('acceptedOwnerCount') != 0):
        raise ValueError('expected an unaccepted E18 full-source report for this scan')
    source = (scan_dir / manifest['assetPaths']['rawMeshPly']).resolve(strict=True)
    if not source.is_relative_to(scan_dir / 'source'):
        raise ValueError('original PLY escapes imported scan')
    converted, assignments = scan_dir / 'converted.json', scan_dir / 'derived-v1/face-assignments.json'
    expected = report.get('inputHashes', {})
    for path, key in ((source, 'rawMeshPly'), (converted, 'converted'),
                      (assignments, 'assignments')):
        if expected.get(key) != sha256(path):
            raise ValueError(f'{key} differs from the source-face mask trial')
    if report.get('sourceHash') != sha256(source):
        raise ValueError('original PLY SHA256 mismatch')
    room = json.loads(converted.read_text(encoding='utf-8'))
    if report.get('transformHash') != transform_hash(room['transform']['worldToRoom']):
        raise ValueError('room-local transform mismatch')
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) != report.get('sourceFaceCount'):
        raise ValueError('original source face order/count unavailable')
    buckets = validate_v1_assignments(json.loads(assignments.read_text(encoding='utf-8')),
                                      sha256(source), len(mesh.faces))
    classes = np.asarray(mesh.metadata['_ply_raw']['face']['data']['class'], dtype=np.int16)
    if len(classes) != len(mesh.faces):
        raise ValueError('original ARKit face class count mismatch')
    face_centers = transform_points(np.asarray(mesh.triangles_center),
        column_major_matrix(room['transform']['worldToRoom'], (4, 4)))
    selected = [row for row in report.get('proposals', [])
                if row.get('categoryClaimUnreviewed') == category]
    if not selected:
        raise ValueError('category has no photo mask proposals')
    photo_faces: dict[str, set[int]] = {}
    for row in selected:
        photo = row.get('photoId')
        values = row.get('sourceFaceIds')
        if (not isinstance(photo, str) or not isinstance(values, list) or
                any(type(value) is not int or not 0 <= value < len(mesh.faces) for value in values)):
            raise ValueError('invalid proposal source face identity')
        photo_faces.setdefault(photo, set()).update(values)
    ids = np.array(sorted(set().union(*photo_faces.values())), dtype=np.int64)
    if not len(ids):
        raise ValueError('the selected category has no depth-supported original faces')
    assert_unprotected_candidate_scope(ids, buckets)
    components = spatial_components(ids, face_centers, radius_m)
    rows = summarize_components(components, face_centers, classes, buckets, photo_faces)
    result = {'schemaVersion': 1, 'algorithm': 'review-source-face-neighbor-components-v1',
              'scanId': scan_dir.name, 'categoryClaimUnreviewed': category,
              'radiusM': radius_m, 'sourceHash': sha256(source),
              'transformHash': report['transformHash'],
              'inputReportSha256': sha256(report_path),
              'sourceFaceCount': len(mesh.faces), 'candidateFaceCount': len(ids),
              'componentCount': len(rows), 'components': rows,
              'reviewState': 'unreviewed', 'ownershipState': 'unchanged-v1',
              'warning': 'Spatial and ARKit class consistency are diagnostics, not object truth. '
                         'Category grouping can mix distinct instances or surfaces that touch. '
                         'No inferred hidden geometry or accepted owner is generated.'}
    output.mkdir(parents=True)
    (output / 'component-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2,
                                                     allow_nan=False) + chr(10), encoding='utf-8')
    if emit_main_cluster:
        main = {'schemaVersion': 1, 'kind': 'review-only-main-cluster',
                'scanId': scan_dir.name, 'categoryClaimUnreviewed': category,
                'sourceHash': result['sourceHash'], 'transformHash': result['transformHash'],
                'inputReportSha256': result['inputReportSha256'],
                'componentIndex': 0, 'sourceFaceIds': components[0].tolist(),
                'sourceFaceCount': len(components[0]),
                'reviewState': 'unreviewed', 'ownershipState': 'unchanged-v1',
                'warning': 'This is a candidate measured surface, not a complete chair or approved voxel owner.'}
        (output / 'main-cluster-candidate.json').write_text(
            json.dumps(main, ensure_ascii=False, indent=2) + chr(10), encoding='utf-8')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-dir', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--category', required=True)
    parser.add_argument('--radius-m', type=float, default=.04)
    parser.add_argument('--emit-main-cluster', action='store_true')
    args = parser.parse_args()
    result = run(args.scan_dir, args.report, args.output, args.category,
                 args.radius_m, args.emit_main_cluster)
    print(json.dumps({key: result[key] for key in
                      ('scanId', 'categoryClaimUnreviewed', 'candidateFaceCount',
                       'componentCount', 'radiusM')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
