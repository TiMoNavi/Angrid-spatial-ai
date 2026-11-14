#!/usr/bin/env python3
"""Compare grid-native modeled cells with an immutable E15/E19 source scan.

This is an evidence sidecar, not a semantic segmentation or owner-acceptance
operation. Model occupancy stays inferred even when a PLY face shares a cell.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import itertools
import json
import os
from pathlib import Path

import numpy as np
import trimesh

import voxel_plan_builder as builder

PROTECTED = {'structure', 'excluded', 'rejected-noise'}
MAX_EVIDENCE_REFERENCES = 2_000_000


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def transform_hash(values: list) -> str:
    matrix = np.asarray(values, dtype=float)
    if matrix.shape != (16,) or not np.isfinite(matrix).all():
        raise ValueError('worldToRoom must be a finite column-major 4x4 matrix')
    matrix = matrix.reshape(4, 4).T
    if (not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-6) or
            not np.allclose(matrix[:3, :3].T @ matrix[:3, :3], np.eye(3), atol=1e-5) or
            not np.isclose(np.linalg.det(matrix[:3, :3]), 1, atol=1e-5)):
        raise ValueError('worldToRoom must be a rigid transform')
    normalized = [int(v) if float(v).is_integer() else float(v) for v in values]
    return hashlib.sha256(json.dumps(normalized, separators=(',', ':')).encode()).hexdigest()


def partition(assignments: dict, report: dict, count: int) -> tuple[np.ndarray, np.ndarray]:
    buckets = np.full(count, '', dtype='<U20')
    for name, ids in assignments['sourceFaceIdsByAssignment'].items():
        ids = np.asarray(ids, dtype=np.int64)
        if (len(ids) != len(np.unique(ids)) or np.any(ids < 0) or
                np.any(ids >= count) or np.any(buckets[ids] != '')):
            raise ValueError('source-face assignment partition is invalid')
        buckets[ids] = name
    if np.any(buckets == ''):
        raise ValueError('source-face assignment partition is incomplete')
    owners = np.full(count, '', dtype=object)
    for row in report['objects']:
        ids = np.asarray(row['sourceFaceIds'], dtype=np.int64)
        if (np.any(ids < 0) or np.any(ids >= count) or np.any(owners[ids] != '') or
                np.any(buckets[ids] != 'one-owner')):
            raise ValueError('legacy object/source-face mapping is inconsistent')
        owners[ids] = row['objectId']
    if np.any((buckets == 'one-owner') & (owners == '')):
        raise ValueError('one-owner face is missing a stable object ID')
    return buckets, owners


def bind_grid(occupancy: dict, centers: np.ndarray, buckets: np.ndarray,
              owners: np.ndarray, neighbor_radius: int = 1) -> dict:
    """Link actual source cells to model cells, retaining N-instance ambiguity."""
    if neighbor_radius not in (0, 1):
        raise ValueError('neighbor radius must be zero or one cell')
    step = occupancy['grid']['stepM']
    origin = np.asarray(occupancy['grid']['originM'], dtype=float)
    if len(centers) != len(buckets) or len(centers) != len(owners) or not np.isfinite(centers).all():
        raise ValueError('source evidence arrays do not match')
    actual_indices = np.floor((centers - origin) / step).astype(np.int64)
    source_cells = defaultdict(list)
    for fid, cell in enumerate(actual_indices):
        source_cells[tuple(map(int, cell))].append(fid)
    per_instance_cells = defaultdict(set)
    for row in occupancy['cells']:
        for instance in row['candidateInstanceIds']:
            per_instance_cells[instance].add(tuple(row['indexXYZ']))
    offsets = list(itertools.product(range(-neighbor_radius, neighbor_radius + 1), repeat=3))
    offsets.remove((0, 0, 0))
    six = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    rows, refs = [], 0
    instance_stats = {instance: {'modelCells': set(), 'same': set(), 'near': set(),
                                'conflict': set(), 'sameCells': set(), 'conflictCells': set()}
                      for instance in per_instance_cells}
    for model in occupancy['cells']:
        cell = tuple(model['indexXYZ'])
        same = source_cells.get(cell, [])
        nearby = []
        for offset in offsets:
            actual = tuple(cell[axis] + offset[axis] for axis in range(3))
            if actual in source_cells:
                nearby.append({'sourceIndexXYZ': list(actual), 'sourceFaceIds': source_cells[actual]})
        neighbors = [fid for entry in nearby for fid in entry['sourceFaceIds']]
        instance_rows = []
        for instance in model['candidateInstanceIds']:
            def compatible(fid: int) -> bool:
                return buckets[fid] == 'unknown' or (buckets[fid] == 'one-owner' and owners[fid] == instance)
            same_ok = [fid for fid in same if compatible(fid)]
            same_bad = [fid for fid in same if not compatible(fid)]
            near_ok = [fid for fid in neighbors if compatible(fid)]
            near_bad = [fid for fid in neighbors if not compatible(fid)]
            near_context = [fid for fid in near_bad if buckets[fid] in PROTECTED]
            near_owner_conflict = [fid for fid in near_bad if buckets[fid] not in PROTECTED]
            surface = any(tuple(cell[a] + off[a] for a in range(3)) not in per_instance_cells[instance]
                          for off in six)
            # Adjacency to the room floor/wall or rejected noise is context,
            # not an ownership conflict by itself. Same-cell intersections
            # and competing furniture ownership remain explicit conflicts.
            conflict = bool(same_bad or near_owner_conflict or len(model['candidateInstanceIds']) > 1)
            evidence = {'instanceId': instance, 'surfaceModelCell': surface,
                        'sameCellSourceFaceIds': same_ok, 'sameCellConflictFaceIds': same_bad,
                        'nearbySourceFaceIds': near_ok, 'nearbyConflictFaceIds': near_owner_conflict,
                        'nearbyProtectedContextSourceFaceIds': near_context,
                        'state': 'conflict' if conflict else ('same-cell-supported' if same_ok else 'model-only')}
            instance_rows.append(evidence)
            stats = instance_stats[instance]
            stats['modelCells'].add(cell)
            stats['same'].update(same_ok)
            stats['near'].update(near_ok)
            stats['conflict'].update(same_bad + near_owner_conflict)
            if same_ok:
                stats['sameCells'].add(cell)
            if conflict:
                stats['conflictCells'].add(cell)
        refs += len(same) + len(neighbors)
        if refs > MAX_EVIDENCE_REFERENCES:
            raise ValueError('evidence sidecar exceeds bounded reference budget')
        rows.append({'indexXYZ': list(cell), 'partRefs': model['partRefs'],
                     'candidateInstanceIds': model['candidateInstanceIds'],
                     'geometryProvenance': 'model-inferred', 'instanceEvidence': instance_rows,
                     'sameCellSourceFaceIds': same, 'nearbySourceCells': nearby,
                     'state': 'conflict' if any(e['state'] == 'conflict' for e in instance_rows) else
                              ('same-cell-supported' if same else 'model-only')})
    summaries = {}
    for instance, stats in instance_stats.items():
        own_rows = [r for r in rows if instance in r['candidateInstanceIds']]
        evidence_rows = [e for r in own_rows for e in r['instanceEvidence'] if e['instanceId'] == instance]
        summaries[instance] = {'modelCellCount': len(stats['modelCells']),
                               'sameCellSupportedCount': len(stats['sameCells']),
                               'conflictCellCount': len(stats['conflictCells']),
                               'uniqueSameCellSourceFaceCount': len(stats['same']),
                               'uniqueNearbySourceFaceCount': len(stats['near']),
                               'uniqueConflictSourceFaceCount': len(stats['conflict']),
                               'sourceBucketsForSameCellSupport': dict(sorted(Counter(str(buckets[f]) for f in stats['same']).items())),
                               'cellStates': dict(sorted(Counter(e['state'] for e in evidence_rows).items()))}
    part_summaries = []
    for part in occupancy['parts']:
        matched = [r for r in rows if {'instanceId': part['instanceId'], 'partId': part['partId']} in r['partRefs']]
        ev = [e for r in matched for e in r['instanceEvidence'] if e['instanceId'] == part['instanceId']]
        part_summaries.append({'instanceId': part['instanceId'], 'partId': part['partId'],
                               'role': part['role'], 'geometryState': part['geometryState'],
                               'modelCellCount': len(matched),
                               'sameCellSupportedCount': sum(bool(e['sameCellSourceFaceIds']) for e in ev),
                               'conflictCellCount': sum(e['state'] == 'conflict' for e in ev),
                               'photoEvidence': part['photoEvidence']})
    return {'cells': rows, 'instances': summaries, 'parts': part_summaries,
            'cellStates': dict(sorted(Counter(r['state'] for r in rows).items())),
            'neighborRadiusCells': neighbor_radius, 'sourceFaceCount': len(centers)}


def verify_build(plan_path: Path, build_dir: Path) -> dict:
    expected, _, glb = builder.build_artifacts(read(plan_path))
    actual = read(build_dir / 'voxel-occupancy.json')
    if builder.canonical_bytes(actual) != builder.canonical_bytes(expected):
        raise ValueError('occupancy differs from the supplied integer plan')
    if digest(build_dir / 'reconstructed.glb') != hashlib.sha256(glb).hexdigest():
        raise ValueError('GLB differs from the supplied integer plan')
    return actual


def run(scan_dir: Path, plan_path: Path, build_dir: Path, output: Path,
        neighbor_radius: int = 1) -> dict:
    scan_dir = scan_dir.resolve(strict=True)
    output = output.absolute()
    if (os.path.lexists(output) or not output.parent.is_dir() or
            output.parent.resolve() != scan_dir):
        raise ValueError('output must be a new direct child of the imported scan directory')
    occupancy = verify_build(plan_path, build_dir)
    manifest = read(scan_dir / 'import-manifest.json')
    room = read(scan_dir / 'converted.json')
    report_path = scan_dir / 'derived-v1/segment-report.json'
    assignment_path = scan_dir / 'derived-v1/face-assignments.json'
    old_report, assignments = read(report_path), read(assignment_path)
    source = (scan_dir / manifest['assetPaths']['rawMeshPly']).resolve(strict=True)
    if not source.is_relative_to(scan_dir / 'source'):
        raise ValueError('source mesh escapes the immutable imported source directory')
    source_hash = digest(source)
    transform_id = transform_hash(room['transform']['worldToRoom'])
    if (manifest.get('scanId') != occupancy['scanId'] or
            manifest.get('sourceMeshFrame') != 'capture-session-world-m' or
            occupancy['sourcePlySha256'] != source_hash or occupancy['transformHash'] != transform_id or
            assignments.get('sourceHash') != source_hash or old_report.get('transformHash') != transform_id or
            old_report.get('frame') != 'room-local-m' or old_report.get('scanId') != occupancy['scanId']):
        raise ValueError('plan, original PLY, frame or legacy assignments belong to different inputs')
    editor_grid = read(scan_dir / 'derived-v1/furniture-grid.json')['grids'].get(format(occupancy['grid']['stepM'], 'g'))
    if (not editor_grid or editor_grid.get('stepM') != occupancy['grid']['stepM'] or
            editor_grid.get('originM') != occupancy['grid']['originM'] or
            editor_grid.get('cellEncoding') != 'index-xyz'):
        raise ValueError('model grid differs from an available editor grid')
    if any(e['photoIndex'] >= len(room['photos']) for i in occupancy['instances']
           for p in i['parts'] for e in p['photoEvidence']):
        raise ValueError('photoEvidence refers beyond the converted photo array')
    before = {'sourcePlySha256': source_hash, 'faceAssignmentsSha256': digest(assignment_path),
              'segmentReportSha256': digest(report_path)}
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) != old_report['sourceFaces']:
        raise ValueError('original source-face count/order differs from the assignment ledger')
    matrix = np.asarray(room['transform']['worldToRoom'], dtype=float).reshape(4, 4).T
    centers = trimesh.transform_points(np.asarray(mesh.triangles_center), matrix)
    buckets, owners = partition(assignments, old_report, len(centers))
    bound = bind_grid(occupancy, centers, buckets, owners, neighbor_radius)
    after = {'sourcePlySha256': digest(source), 'faceAssignmentsSha256': digest(assignment_path),
             'segmentReportSha256': digest(report_path)}
    if before != after:
        raise ValueError('input evidence changed during binding; no result published')
    shared = {'schemaVersion': 1, 'scanId': occupancy['scanId'], 'frame': 'room-local-m',
              'transformHash': transform_id, 'sourcePlySha256': source_hash,
              'grid': occupancy['grid'], 'planSha256': occupancy['planSha256'],
              'modelGlbSha256': occupancy['modelGlbSha256'],
              'identityValidation': 'verified-source-and-transform',
              'inputs': {**before, 'planFileSha256': digest(plan_path),
                         'occupancySha256': digest(build_dir / 'voxel-occupancy.json')},
              'reviewState': 'unreviewed', 'maskedValidated': False,
              'ownerAcceptanceBlocked': True,
              'legacyOwnership': 'unchanged', 'geometryProvenance': 'model-inferred',
              'limitations': ['Same-cell support proves a source surface occurs in the model cell, not its semantic identity.',
                              'Nearby source cells retain their actual coordinates and do not become measured model cells.',
                              'A neighbor conflict is a review flag, not proof of collision.',
                              'No mask/depth visibility, observed-free volume or accepted owner is produced.']}
    ledger = {**shared, **bound}
    summary = {k: v for k, v in ledger.items() if k != 'cells'}
    output.mkdir()
    for name, value in [('evidence-ledger.json', ledger), ('evidence-report.json', summary)]:
        with (output / name).open('xb') as stream:
            stream.write(builder.canonical_bytes(value))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-dir', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--build-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--neighbor-radius-cells', type=int, choices=[0, 1], default=1)
    args = parser.parse_args()
    try:
        report = run(args.scan_dir, args.plan, args.build_dir, args.output, args.neighbor_radius_cells)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(2, f'voxel-evidence: {exc}\n')
    print(json.dumps({'scanId': report['scanId'], 'cellStates': report['cellStates'],
                      'identityValidation': report['identityValidation'],
                      'ownerAcceptanceBlocked': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
