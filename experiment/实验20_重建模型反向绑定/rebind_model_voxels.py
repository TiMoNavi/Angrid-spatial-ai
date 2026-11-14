#!/usr/bin/env python3
"""Review-only reverse binding of named reconstruction parts to original PLY faces.

Living room trial: the rebuilt GLB is a human/photo-guided structural model. A
nearby PLY triangle is evidence of a surface, not proof of its semantic owner.
No accepted ownership, input scan, or upstream experiment is ever changed.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from scipy.spatial import ConvexHull, cKDTree
import trimesh


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
PRIVATE = EXPERIMENT / '.private'
PROJECT = EXPERIMENT.parent.parent
DEFAULT_SCAN = PRIVATE / 'living-room-e19'
DEFAULT_REBUILT = PROJECT / 'reference/重建模型/Living room'
DEFAULT_ZIP = PROJECT / 'reference/案例office/Living room.zip'
GROUPS = {
    'blue-covered-seat-5': (5, 'sofa'),
    'swivel-chair-6': (6, 'chair'),
}
PROTECTED = {'excluded', 'structure', 'rejected-noise'}


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def require_private(path: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(PRIVATE.resolve()) or path == PRIVATE.resolve():
        raise ValueError('scan/output must be below experiment/.private')
    return path


def verify_provenance(scan: Path, rebuilt: Path, source_zip: Path) -> dict:
    """Fail closed on a mismatched session, frame, source mesh, or object list."""
    scan = require_private(scan)
    manifest = read_json(scan / 'import-manifest.json')
    converted = read_json(scan / 'converted.json')
    room = read_json(rebuilt / 'room.json')
    if manifest.get('scanId') != scan.name or manifest.get('roomIndex') != 0:
        raise ValueError('this trial requires the Living room room-0 import')
    if manifest.get('sourceMeshFrame') != 'capture-session-world-m':
        raise ValueError('source PLY frame is not the expected session frame')
    if not all(converted.get(k) == room.get(k) for k in
               ('transform', 'polygon', 'walls', 'objects', 'photos')):
        raise ValueError('rebuilt room does not match the imported scan')
    for prefix, (index, category) in GROUPS.items():
        if converted['objects'][index]['category'] != category:
            raise ValueError(f'{prefix} no longer maps to RoomPlan object {index}')
    archive = scan / 'source-archive.zip'
    archive_hash = digest(archive)
    if (archive_hash != digest(source_zip) or
            archive_hash != manifest['sourceArchive']['sha256']):
        raise ValueError('source ZIP differs from the rebuilt Living room session')
    source = (scan / manifest['assetPaths']['rawMeshPly']).resolve(strict=True)
    if not source.is_relative_to(scan / 'source'):
        raise ValueError('source mesh escapes imported scan')
    reference_ply = rebuilt / 'reference-scan.ply'
    source_hash = digest(source)
    if source_hash != digest(reference_ply):
        raise ValueError('rebuilt reference PLY differs from imported original PLY')
    assignments_path = scan / 'derived-v1/face-assignments.json'
    assignments = read_json(assignments_path)
    report_path = scan / 'derived-v1/segment-report.json'
    report = read_json(report_path)
    transform_values = [int(x) if float(x).is_integer() else float(x)
                        for x in converted['transform']['worldToRoom']]
    transform_hash = hashlib.sha256(json.dumps(transform_values,
                                   separators=(',', ':')).encode()).hexdigest()
    if (assignments.get('sourceHash') != source_hash or
            report.get('scanId') != scan.name or
            report.get('frame') != 'room-local-m' or
            report.get('transformHash') != transform_hash):
        raise ValueError('face assignments do not belong to this PLY')
    original = read_json(scan / manifest['assetPaths']['roomPlanJson'])['objects']
    candidates = assignments['originalCandidatesPreserved']
    if len(original) != len(converted['objects']) or len(candidates) != len(original):
        raise ValueError('original RoomPlan object order differs from E15 candidates')
    object_ids = {}
    for group, (index, category) in GROUPS.items():
        source_object = original[index]
        object_id = scan.name + ':' + source_object['identifier']
        if (list(source_object['category']) != [category] or
                candidates[index]['objectId'] != object_id or
                report['objects'][index]['objectId'] != object_id or
                report['objects'][index]['mappingState'] != 'verified'):
            raise ValueError(f'{group} original object identifier/category differs')
        object_ids[group] = object_id
    grid = read_json(scan / 'derived-v1/furniture-grid.json')['grids']['0.05']
    if (grid.get('stepM') != 0.05 or grid.get('originM') != [0, 0, 0] or
            grid.get('cellEncoding') != 'index-xyz'):
        raise ValueError('editor 5 cm voxel grid convention changed')
    return {'source': source, 'sourceHash': source_hash,
            'zipHash': archive_hash, 'converted': converted,
            'assignments': assignments, 'assignmentsHash': digest(assignments_path),
            'segmentReport': report, 'segmentReportHash': digest(report_path),
            'grid': grid, 'model': rebuilt / 'reconstructed.glb',
            'objectIds': object_ids}


def surface_samples(vertices: np.ndarray, faces: np.ndarray,
                    spacing: float) -> np.ndarray:
    """Deterministic triangular lattice; sample spacing bounds NN error."""
    pieces = []
    for face in faces:
        a, b, c = vertices[face]
        edge = max(np.linalg.norm(a - b), np.linalg.norm(b - c),
                   np.linalg.norm(c - a))
        n = max(1, int(np.ceil(edge / spacing)))
        if n > 80:
            raise ValueError('an individual GLB triangle is too large for this trial')
        i, j = np.indices((n + 1, n + 1)).reshape(2, -1)
        keep = i + j <= n
        i, j = i[keep], j[keep]
        pieces.append(a + (b - a) * (i[:, None] / n) +
                      (c - a) * (j[:, None] / n))
    return np.concatenate(pieces) if pieces else np.empty((0, 3))


def index_xyz(points: np.ndarray, step: float) -> np.ndarray:
    return np.floor(points / step).astype(np.int32)


def model_cells(vertices: np.ndarray, faces: np.ndarray, samples: np.ndarray,
                step: float) -> tuple[set[tuple[int, int, int]],
                                       set[tuple[int, int, int]]]:
    """Conservative surface cells plus center-inside convex volume for box parts."""
    surface = set(map(tuple, index_xyz(samples, step)))
    unique = np.unique(np.round(vertices, 8), axis=0)
    if len(unique) != 8:
        return surface, set()
    hull = ConvexHull(unique)
    geometry = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    if (not geometry.is_watertight or
            not np.isclose(abs(geometry.volume), hull.volume, rtol=.001, atol=1e-8)):
        # Eight vertices alone do not prove that filling the hull is valid.
        return surface, set()
    low = np.floor(unique.min(axis=0) / step).astype(int)
    high = np.floor(unique.max(axis=0) / step).astype(int)
    shape = high - low + 1
    if np.prod(shape) > 50000:
        raise ValueError('part exceeds bounded 5 cm voxel trial')
    candidates = np.stack(np.meshgrid(*(np.arange(lo, hi + 1)
                                        for lo, hi in zip(low, high)),
                                      indexing='ij'), axis=-1).reshape(-1, 3)
    centers = (candidates + .5) * step
    interior = candidates[np.all(centers @ hull.equations[:, :3].T +
                                 hull.equations[:, 3] <= 1e-8, axis=1)]
    return surface, set(map(tuple, interior))


def load_parts(model: Path, step: float) -> dict:
    scene = trimesh.load(model, force='scene', process=False)
    if not isinstance(scene, trimesh.Scene):
        raise ValueError('named GLB scene required')
    result = {name: {'parts': {}, 'samples': [], 'samplePart': [], 'cells': {}}
              for name in GROUPS}
    found = set()
    for node in scene.graph.nodes_geometry:
        group = next((g for g in GROUPS if node.startswith(g + '-')), None)
        if group is None:
            continue
        found.add(group)
        matrix, geometry = scene.graph[node]
        mesh = scene.geometry[geometry]
        verts = trimesh.transform_points(np.asarray(mesh.vertices), matrix)
        if not np.isfinite(verts).all() or len(mesh.faces) == 0:
            raise ValueError(f'invalid GLB part {node}')
        samples = surface_samples(verts, np.asarray(mesh.faces), step * .7)
        surface, interior = model_cells(verts, np.asarray(mesh.faces), samples, step)
        entry = result[group]
        entry['parts'][node] = {'surface': surface, 'interior': interior}
        entry['samples'].append(samples)
        entry['samplePart'].extend([node] * len(samples))
    if found != set(GROUPS):
        raise ValueError(f'missing expected GLB groups: {set(GROUPS) - found}')
    for group, entry in result.items():
        entry['samples'] = np.concatenate(entry['samples'])
        entry['samplePart'] = np.asarray(entry['samplePart'])
        entry['tree'] = cKDTree(entry['samples'])
        entry['bounds'] = np.stack((entry['samples'].min(axis=0),
                                    entry['samples'].max(axis=0)))
    return result


def source_ownership(assignments: dict, report: dict, count: int) -> tuple[np.ndarray, np.ndarray]:
    bucket = np.full(count, '', dtype='<U20')
    grouped = assignments['sourceFaceIdsByAssignment']
    for name, ids in grouped.items():
        ids = np.asarray(ids, dtype=int)
        if np.any(ids < 0) or np.any(ids >= count) or np.any(bucket[ids] != ''):
            raise ValueError('original source face partition is invalid')
        bucket[ids] = name
    if np.any(bucket == ''):
        raise ValueError('original source face partition is incomplete')
    owner = np.full(count, -1, dtype=np.int16)
    for row in report['objects']:
        ids = np.asarray(row['sourceFaceIds'], dtype=int)
        if np.any(owner[ids] != -1) or np.any(bucket[ids] != 'one-owner'):
            raise ValueError('legacy one-owner mapping is inconsistent')
        owner[ids] = row['convertedIndex']
    if np.any((bucket == 'one-owner') & (owner == -1)):
        raise ValueError('one-owner face lacks an object mapping')
    return bucket, owner


def assign_face_candidates(centers: np.ndarray, parts: dict, radius: float,
                           ambiguity: float) -> dict:
    """Nearest model surface by group, without modifying old face ownership."""
    near = {}
    for group, entry in parts.items():
        distance, nearest = entry['tree'].query(centers, distance_upper_bound=radius)
        near[group] = (distance, nearest)
    groups = list(parts)
    d0, i0 = near[groups[0]]
    d1, i1 = near[groups[1]]
    a = np.isfinite(d0)
    b = np.isfinite(d1)
    ambiguous = np.zeros(len(centers), dtype=bool)
    both = a & b
    ambiguous[both] = np.abs(d0[both] - d1[both]) <= ambiguity
    chosen = {groups[0]: np.flatnonzero(a & (~b | (d0 < d1 - ambiguity))),
              groups[1]: np.flatnonzero(b & (~a | (d1 < d0 - ambiguity)))}
    return {'chosen': chosen, 'ambiguous': np.flatnonzero(ambiguous),
            'near': near}


def bind(centers: np.ndarray, classes: np.ndarray, bucket: np.ndarray,
         owner: np.ndarray, parts: dict, step: float, radius: float,
         ambiguity: float, min_part_faces: int) -> dict:
    matches = assign_face_candidates(centers, parts, radius, ambiguity)
    result = {}
    for group, entry in parts.items():
        index, category = GROUPS[group]
        candidate = matches['chosen'][group]
        ambiguous = matches['ambiguous']
        near_index = matches['near'][group][1]
        face_by_part = defaultdict(list)
        conflicts_by_part = defaultdict(list)
        reason_counts = Counter()
        for fid in candidate:
            part = str(entry['samplePart'][near_index[fid]])
            state = bucket[fid]
            if state in PROTECTED or state == 'conflict' or (state == 'one-owner' and owner[fid] != index):
                conflicts_by_part[part].append(int(fid))
                reason_counts['protected-' + state if state in PROTECTED else 'old-owner-or-conflict'] += 1
            else:
                face_by_part[part].append(int(fid))
                reason_counts['eligible-' + state] += 1
        for fid in ambiguous:
            nearest = int(near_index[fid])
            if nearest < len(entry['samples']):
                conflicts_by_part[str(entry['samplePart'][nearest])].append(int(fid))
                reason_counts['ambiguous-between-models'] += 1
        voxels = defaultdict(lambda: {'parts': set(), 'surfaceParts': set(),
                                      'sourceFaceIds': set(), 'conflictFaceIds': set(),
                                      'proximityEvidence': set(),
                                      'nearbyConflictEvidence': set()})
        same_cell_by_part = defaultdict(set)
        for part, geometry in entry['parts'].items():
            for cell in geometry['surface'] | geometry['interior']:
                voxels[cell]['parts'].add(part)
                if cell in geometry['surface']:
                    voxels[cell]['surfaceParts'].add(part)
        for collection, same_cell_field, nearby_field in (
                (face_by_part, 'sourceFaceIds', 'proximityEvidence'),
                (conflicts_by_part, 'conflictFaceIds', 'nearbyConflictEvidence')):
            for part, face_ids in collection.items():
                # Keep observed PLY grid cells separate from model grid cells.
                for fid in face_ids:
                    near_sample = entry['samples'][near_index[fid]]
                    model_cell = tuple(index_xyz(near_sample[None, :], step)[0])
                    source_cell = tuple(index_xyz(centers[fid][None, :], step)[0])
                    if source_cell == model_cell:
                        voxels[model_cell][same_cell_field].add(fid)
                        if same_cell_field == 'sourceFaceIds':
                            same_cell_by_part[part].add(model_cell)
                    else:
                        voxels[model_cell][nearby_field].add((fid, *source_cell))
                    voxels[model_cell]['parts'].add(part)
                    voxels[model_cell]['surfaceParts'].add(part)
        rows = []
        counts = Counter()
        surface_counts = Counter()
        for cell, data in sorted(voxels.items()):
            supported_parts = {p for p in data['parts']
                               if len(face_by_part[p]) >= min_part_faces}
            if data['conflictFaceIds'] or data['nearbyConflictEvidence']:
                state = 'conflict'
            elif data['sourceFaceIds'] and supported_parts:
                state = 'measured'
            elif supported_parts:
                state = 'model-inferred'
            else:
                state = 'unsupported'
            counts[state] += 1
            if data['surfaceParts']:
                surface_counts[state] += 1
            rows.append({'indexXYZ': [int(axis) for axis in cell], 'partIds': sorted(data['parts']),
                         'surface': bool(data['surfaceParts']), 'state': state,
                         'sourceFaceIds': sorted(data['sourceFaceIds']),
                         'conflictFaceIds': sorted(data['conflictFaceIds']),
                         'conflictNearby': bool(data['nearbyConflictEvidence']),
                         'proximityEvidence': [{'sourceFaceId': int(fid),
                                                'sourceIndexXYZ': [int(x), int(y), int(z)]}
                                               for fid, x, y, z in sorted(data['proximityEvidence'])],
                         'nearbyConflictEvidence': [{'sourceFaceId': int(fid),
                                                     'sourceIndexXYZ': [int(x), int(y), int(z)]}
                                                    for fid, x, y, z in sorted(data['nearbyConflictEvidence'])]})
        result[group] = {'categoryClaimUnreviewed': category, 'roomPlanIndex': index,
                         'partCount': len(entry['parts']), 'candidateFaceCount': len(candidate),
                         'eligibleSourceFaceCount': sum(map(len, face_by_part.values())),
                         'conflictSourceFaceCount': sum(map(len, conflicts_by_part.values())),
                         'sameCellSourceFaceCount': sum(len(row['sourceFaceIds']) for row in rows),
                         'nearbyOnlySourceFaceCount': sum(len(row['proximityEvidence']) for row in rows),
                         'nearbyConflictSourceFaceCount': sum(len(row['nearbyConflictEvidence']) for row in rows),
                         'candidateBuckets': dict(sorted(reason_counts.items())),
                         'rawArkitClassCountsForEligible': dict(sorted(Counter(
                             int(classes[fid]) for values in face_by_part.values()
                             for fid in values).items())),
                         'partEvidenceCounts': {p: len(face_by_part[p]) for p in sorted(entry['parts'])},
                         'partSurfaceCoverage': {p: {
                             'surfaceCellCount': len(entry['parts'][p]['surface']),
                             'sameCellSupportedSurfaceCellCount': len(same_cell_by_part[p]),
                             'sameCellSupportedFraction': round(
                                 len(same_cell_by_part[p]) / len(entry['parts'][p]['surface']), 4),
                             'eligibleNearbyFaceCount': len(face_by_part[p])}
                             for p in sorted(entry['parts'])},
                         'voxelStateCounts': dict(sorted(counts.items())),
                         'surfaceVoxelStateCounts': dict(sorted(surface_counts.items())),
                         'measuredSurfaceVoxelFraction': round(
                             surface_counts['measured'] / sum(surface_counts.values()), 4),
                         'voxels': rows}
    # A single 5 cm cell claimed by two furniture groups is unresolved.
    shared = set(map(tuple, (row['indexXYZ'] for row in result[list(parts)[0]]['voxels']))) & set(
        map(tuple, (row['indexXYZ'] for row in result[list(parts)[1]]['voxels'])))
    if shared:
        for entry in result.values():
            for row in entry['voxels']:
                if tuple(row['indexXYZ']) in shared:
                    row['state'] = 'conflict'
            entry['voxelStateCounts'] = dict(sorted(Counter(row['state'] for row in entry['voxels']).items()))
            entry['surfaceVoxelStateCounts'] = dict(sorted(Counter(row['state'] for row in entry['voxels']
                                                            if row['surface']).items()))
            surface_states = Counter(row['state'] for row in entry['voxels'] if row['surface'])
            entry['measuredSurfaceVoxelFraction'] = round(
                surface_states['measured'] / sum(surface_states.values()), 4)
    return {'objects': result, 'sharedModelVoxelCount': len(shared),
            'ambiguousSourceFaceCount': len(matches['ambiguous'])}


def diagnose_review_candidate(path: Path, scan: Path, source_hash: str,
                              centers: np.ndarray, classes: np.ndarray,
                              bucket: np.ndarray, chair: dict) -> dict:
    """Compare a prior photo/depth candidate to GLB bounds and sampled surface."""
    path = require_private(path)
    if not path.is_relative_to(scan) or not path.exists():
        raise ValueError('review candidate must be a scan-local private file')
    proposal = read_json(path)
    ids = np.asarray(proposal.get('sourceFaceIds', []), dtype=np.int64)
    if (proposal.get('scanId') != scan.name or
            proposal.get('sourceHash') != source_hash or
            proposal.get('categoryClaimUnreviewed') != 'chair' or
            proposal.get('reviewState') != 'unreviewed' or
            len(ids) != proposal.get('sourceFaceCount') or
            len(ids) != len(np.unique(ids)) or
            np.any(ids < 0) or np.any(ids >= len(centers))):
        raise ValueError('review chair candidate has incompatible source identities')
    xyz = centers[ids]
    inside = np.all((xyz >= chair['bounds'][0]) & (xyz <= chair['bounds'][1]), axis=1)
    distance, nearest = chair['tree'].query(xyz)
    within_4cm = distance <= .04
    within_6cm = distance <= .06
    nearest_parts = chair['samplePart'][nearest]
    return {'sourceFaceCount': len(ids),
            'withinCombinedModelAabbCount': int(inside.sum()),
            'withinCombinedModelAabbFraction': round(float(inside.mean()), 4),
            'withinSampledModelSurface4cmCount': int(within_4cm.sum()),
            'withinSampledModelSurface4cmFraction': round(float(within_4cm.mean()), 4),
            'withinSampledModelSurface6cmCount': int(within_6cm.sum()),
            'withinSampledModelSurface6cmFraction': round(float(within_6cm.mean()), 4),
            'nearestPartWithin4cmCounts': dict(sorted(Counter(map(str, nearest_parts[within_4cm])).items())),
            'legacyAssignmentCounts': dict(sorted(Counter(map(str, bucket[ids])).items())),
            'rawArkitClassCounts': {str(k): v for k, v in sorted(Counter(map(int, classes[ids])).items())},
            'meaning': 'Coverage of an unreviewed photo/depth chair proposal; neither AABB nor '
                       'model-surface proximity confirms instance ownership.'}


def run(scan: Path, rebuilt: Path, source_zip: Path, output: Path,
        step: float = .05, radius: float = .06, ambiguity: float = .02,
        min_part_faces: int = 5) -> dict:
    scan, output = require_private(scan), require_private(output)
    if output.exists() or output.parent != scan or not output.name.startswith('model-rebind-e20-'):
        raise ValueError('output must be a new direct scan child model-rebind-e20-*')
    if step != .05 or not .02 <= radius <= .1 or not 0 <= ambiguity < radius or min_part_faces < 1:
        raise ValueError('invalid bounded trial parameters')
    evidence = verify_provenance(scan, rebuilt, source_zip)
    mesh = trimesh.load(evidence['source'], process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) != evidence['segmentReport']['sourceFaces']:
        raise ValueError('original face order/count differs from segmentation')
    classes = np.asarray(mesh.metadata['_ply_raw']['face']['data']['class'], dtype=np.int16)
    matrix = np.asarray(evidence['converted']['transform']['worldToRoom'],
                        dtype=float).reshape(4, 4).T
    centers = trimesh.transform_points(np.asarray(mesh.triangles_center), matrix)
    if not np.isfinite(centers).all() or len(classes) != len(centers):
        raise ValueError('invalid PLY source-face centers or ARKit classes')
    bucket, owner = source_ownership(evidence['assignments'], evidence['segmentReport'], len(centers))
    parts = load_parts(evidence['model'], step)
    bound = bind(centers, classes, bucket, owner, parts, step, radius, ambiguity, min_part_faces)
    review_path = scan / 'derived-v6-review-chair-v2-20261114/main-cluster-candidate.json'
    if review_path.exists():
        bound['chairReviewCandidateDiagnostic'] = diagnose_review_candidate(
            review_path, scan, evidence['sourceHash'], centers, classes,
            bucket, parts['swivel-chair-6'])
    for group, object_id in evidence['objectIds'].items():
        bound['objects'][group]['originalRoomPlanObjectId'] = object_id
    result = {'schemaVersion': 1, 'algorithm': 'named-glb-proximity-review-e20-v1',
              'scanId': scan.name, 'frame': 'room-local-m',
              'voxelGrid': {'stepM': step, 'originM': [0, 0, 0], 'cellEncoding': 'index-xyz'},
              'parameters': {'surfaceRadiusM': radius, 'crossModelAmbiguityM': ambiguity,
                             'minPartCompatibleFaces': min_part_faces},
              'inputs': {'sourceArchiveSha256': evidence['zipHash'],
                         'sourcePlySha256': evidence['sourceHash'],
                         'modelGlbSha256': digest(evidence['model']),
                         'faceAssignmentsSha256': evidence['assignmentsHash'],
                         'segmentReportSha256': evidence['segmentReportHash']},
              'legacyOwnership': 'unchanged', 'reviewState': 'unreviewed',
              'maskedValidated': False, 'ownerAcceptanceBlocked': True,
              'measuredStateMeaning': 'Original PLY face center shares the 5 cm cell with a reconstructed model surface; instance identity unverified',
              'limitations': ['GLB part geometry is photo-guided and partly imagined, not scan truth.',
                              'Nearby PLY faces in a different cell remain proximity evidence, not measured model voxels.',
                              'Conflict may be a nearby different-cell owner/structure, not physical voxel overlap.',
                              'Proximity to PLY faces is not instance segmentation or visibility proof.',
                              'Unsupported means insufficient nearby compatible faces, not observed free space.',
                              'Original owner, structure, excluded and noise classifications are never overwritten.'],
              **bound}
    candidate_text = json.dumps(result, ensure_ascii=False,
                                separators=(',', ':'), allow_nan=False) + '\n'
    summary = {k: v for k, v in result.items() if k != 'objects'}
    summary['objects'] = {name: {k: v for k, v in obj.items() if k != 'voxels'}
                          for name, obj in result['objects'].items()}
    summary_text = json.dumps(summary, ensure_ascii=False, indent=2,
                              allow_nan=False) + '\n'
    output.mkdir(parents=True)
    (output / 'candidate-voxels.json').write_text(candidate_text, encoding='utf-8')
    (output / 'summary.json').write_text(summary_text, encoding='utf-8')
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-dir', type=Path, default=DEFAULT_SCAN)
    parser.add_argument('--rebuilt-dir', type=Path, default=DEFAULT_REBUILT)
    parser.add_argument('--source-zip', type=Path, default=DEFAULT_ZIP)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--surface-radius-m', type=float, default=.06)
    args = parser.parse_args()
    result = run(args.scan_dir, args.rebuilt_dir, args.source_zip,
                 args.output, radius=args.surface_radius_m)
    print(json.dumps({'scanId': result['scanId'],
                      'objects': {name: {'eligibleSourceFaceCount': row['eligibleSourceFaceCount'],
                                        'voxelStateCounts': row['voxelStateCounts']}
                                  for name, row in result['objects'].items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
