#!/usr/bin/env python3
"""Auditable, offline segmentation-first surface grids; never edits scan inputs."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import resource
import time

import numpy as np
from scipy.optimize import linear_sum_assignment
import trimesh

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.private' / 'office-2'
STEPS = (0.2, 0.1, 0.05, 0.025)
FINE = 0.025


def write_json(path, value, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                               separators=None if pretty else (',', ':'), allow_nan=False) + '\n')


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def transform_hash(matrix):
    # Same bytes as JS JSON.stringify for the finite, non-exponential matrix here.
    values = [int(n) if float(n).is_integer() else float(n) for n in matrix]
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()


def transform_points(points, matrix):
    return np.asarray(points) @ matrix[:3, :3].T + matrix[:3, 3]


def local_coordinates(points, item):
    delta = np.asarray(points) - item['center']
    c, s = np.cos(item['rotY']), np.sin(item['rotY'])
    return np.column_stack((c * delta[:, 0] - s * delta[:, 2], delta[:, 1],
                            s * delta[:, 0] + c * delta[:, 2]))


def in_polygon(points, polygon):
    points = np.atleast_2d(points)
    x, z = points[:, 0], points[:, 1]
    inside = np.zeros(len(points), dtype=bool)
    for i, a in enumerate(polygon):
        b = polygon[i - 1]
        hit = ((a[1] > z) != (b[1] > z)) & (x < (b[0] - a[0]) * (z - a[1]) /
                                                          (b[1] - a[1] + 1e-30) + a[0])
        inside ^= hit
    return inside


def wall_coordinates(points, wall):
    delta = np.asarray(points) - np.asarray(wall['origin'])
    return delta @ np.asarray(wall['u']), delta[:, 1], delta @ np.asarray(wall['n'])


def in_openings(u, y, wall, pad=0):
    result = np.zeros(np.shape(u), dtype=bool)
    for opening in wall.get('openings', []):
        result |= ((u > opening['u0'] - pad) & (u < opening['u1'] + pad) &
                   (y > opening['v0'] - pad) & (y < opening['v1'] + pad))
    return result


def structure_assignment(centers, normals, room, distance=0.03):
    result = np.zeros(len(centers), dtype=bool)
    horizontal = np.abs(normals[:, 1]) > 0.8
    footprint = in_polygon(centers[:, [0, 2]], room['polygon'])
    result |= horizontal & (np.abs(centers[:, 1]) <= distance) & footprint
    height = max(w['height'] for w in room['walls'])
    result |= horizontal & (np.abs(centers[:, 1] - height) <= distance) & footprint
    for wall in room['walls']:
        u, y, d = wall_coordinates(centers, wall)
        result |= ((np.abs(d) <= distance) & (u >= 0) & (u <= wall['length']) &
                   (y >= 0) & (y <= wall['height']) & ~in_openings(u, y, wall) &
                   (np.abs(normals @ np.asarray(wall['n'])) > 0.8))
    return result


def source_object_mapping(room, raw_room, matrix, scan_id):
    """Hungarian one-to-one matching; report ambiguity instead of silently binding."""
    originals = []
    for source in raw_room.get('objects', []):
        world = np.asarray(source['transform']).reshape(4, 4, order='F')
        local = matrix @ world
        originals.append({'category': next(iter(source['category'])),
                          'center': local[:3, 3], 'size': np.asarray(source['dimensions']),
                          'rotY': float(np.arctan2(-local[2, 0], local[0, 0])),
                          'identifier': source['identifier']})
    costs = np.full((len(room['objects']), len(originals)), 1e6)
    details = {}
    for i, item in enumerate(room['objects']):
        for j, source in enumerate(originals):
            if item['category'] != source['category']:
                continue
            center_error = float(np.linalg.norm(np.asarray(item['center']) - source['center']))
            size_error = float(np.linalg.norm(np.asarray(item['size']) - source['size']))
            # Box geometry has pi symmetry, so sign of local X is irrelevant.
            angle_error = float(abs((item['rotY'] - source['rotY'] + np.pi / 2) % np.pi - np.pi / 2))
            costs[i, j] = center_error + size_error + angle_error * 0.05
            details[i, j] = (center_error, size_error, angle_error)
    rows, cols = linear_sum_assignment(costs)
    result = []
    for i, j in zip(rows, cols):
        ce, se, ae = details.get((i, j), (1e6, 1e6, 1e6))
        alternatives = sorted(costs[i].tolist())
        gap = alternatives[1] - alternatives[0] if len(alternatives) > 1 else 1e6
        matched = ce < 0.015 and se < 0.015 and ae < 0.03 and gap > 0.02
        result.append({'convertedIndex': int(i), 'objectId': scan_id + ':' + originals[j]['identifier']
                       if matched else scan_id + ':unresolved-' + str(i),
                       'sourceIdentifier': originals[j]['identifier'] if matched else None,
                       'mappingState': 'verified' if matched else 'conflict',
                       'category': room['objects'][i]['category'], 'centerErrorM': ce,
                       'dimensionsErrorM': se, 'angleErrorRad': ae, 'nextCandidateScoreGap': float(gap)})
    if len(result) != len(room['objects']):
        raise ValueError('Cannot map every converted object; mismatched source object count')
    return sorted(result, key=lambda row: row['convertedIndex'])


def candidate_scores(vertices, faces, centers, classes, objects, eligible, margin):
    scores = np.full((len(faces), len(objects)), np.inf)
    for i, item in enumerate(objects):
        half = np.asarray(item['size']) / 2
        local = local_coordinates(centers, item)
        inside = np.all(np.abs(local) <= half + margin, axis=1) & eligible
        ids = np.flatnonzero(inside)
        if len(ids):
            corners = local_coordinates(vertices[faces[ids]].reshape(-1, 3), item).reshape(-1, 3, 3)
            ids = ids[np.all(np.abs(corners) <= half + margin, axis=(1, 2))]
        score = np.max(np.abs(local) / np.maximum(half, 0.05), axis=1)
        score += np.where((classes == 4) & (item['category'] != 'table'), .22, 0)
        score += np.where((classes == 5) & (item['category'] != 'chair'), .22, 0)
        scores[ids, i] = score[ids]
    return scores


def components_for_faces(faces, ids):
    if not len(ids):
        return []
    # Face adjacency by original shared edge, preserving disconnected table legs.
    edges = np.sort(faces[ids][:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1)
    owner = np.repeat(np.arange(len(ids)), 3)
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    ordered = edges[order]
    pairs = np.flatnonzero(np.all(ordered[1:] == ordered[:-1], axis=1))
    adjacency = np.column_stack((owner[order[pairs]], owner[order[pairs + 1]]))
    return [ids[np.asarray(component)] for component in
            trimesh.graph.connected_components(adjacency, nodes=np.arange(len(ids)))]


def triangle_box_intersects(triangles, centers, half):
    """Separating-axis triangle/AABB test. Box-axis rejection is done by bounds."""
    tri = triangles - centers[:, None, :]
    edges = np.roll(tri, -1, axis=1) - tri
    axes = [np.cross(edges[:, 0], edges[:, 1])]
    for edge in range(3):
        for basis in np.eye(3):
            axes.append(np.cross(edges[:, edge], basis))
    keep = np.ones(len(tri), dtype=bool)
    for axis in axes:
        projections = np.einsum('nvc,nc->nv', tri, axis)
        radius = half * np.sum(np.abs(axis), axis=1)
        keep &= (projections.min(axis=1) <= radius + 1e-12) & (projections.max(axis=1) >= -radius - 1e-12)
    return keep


def surface_cells(vertices, faces, step=FINE):
    """Exact triangle-box surface intersections on a zero-origin nested lattice."""
    if not len(faces):
        return np.empty((0, 3), dtype=np.int64)
    all_cells = []
    for start in range(0, len(faces), 1000):
        triangles = vertices[faces[start:start + 1000]]
        lower = np.floor(triangles.min(axis=1) / step).astype(np.int64)
        upper = np.floor(triangles.max(axis=1) / step).astype(np.int64)
        boxes, triangle_ids = [], []
        for i, (lo, hi) in enumerate(zip(lower, upper)):
            cell = np.stack(np.meshgrid(*[np.arange(lo[k], hi[k] + 1) for k in range(3)], indexing='ij'), axis=-1).reshape(-1, 3)
            if len(cell) > 200000:
                raise ValueError('Triangle spans excessive grid domain; check transform/units')
            boxes.append(cell)
            triangle_ids.extend([i] * len(cell))
        boxes = np.concatenate(boxes)
        centers = (boxes + .5) * step
        keep = triangle_box_intersects(triangles[np.asarray(triangle_ids)], centers, step / 2)
        all_cells.append(boxes[keep])
    return np.unique(np.concatenate(all_cells), axis=0)


def grid_payload(groups, kind, evidence='observed-surface', provenance='measured'):
    """groups contain finest cells; nested coarsening preserves measured coverage."""
    result = {'schemaVersion': 1, 'frame': 'room-local-m', 'kind': kind,
              'evidenceState': evidence, 'provenance': provenance, 'grids': {}}
    for step in STEPS:
        converted = [(group, np.unique(np.floor_divide(cells, round(step / FINE)), axis=0))
                     for group, cells in groups]
        cells = np.unique(np.concatenate([c for _, c in converted]), axis=0) if converted else np.empty((0, 3), dtype=int)
        lookup = {tuple(cell): i for i, cell in enumerate(cells)}
        result['grids'][str(step)] = {'stepM': step, 'originM': [0, 0, 0],
            'cellEncoding': 'index-xyz', 'recordCount': len(cells),
            'counts': {'total': len(cells), 'display': min(len(cells), 50000)}, 'cells': cells.tolist(),
            'groups': [{**meta, 'cellIndices': [lookup[tuple(cell)] for cell in c]} for meta, c in converted]}
    return result


def structure_domains(room):
    walls = []
    for w in room['walls']:
        walls.append({'id': 'wall-' + str(w['index']), **w, 'thicknessM': None,
                      'unknownThickness': True, 'layoutProxyThicknessM': .1,
                      'provenance': 'inferred', 'meaning': 'finite RoomPlan prior; not measured wall material'})
    return {'units': 'm', 'frame': 'room-local-m', 'floorY': 0, 'floorPolygon': room['polygon'],
            'walls': walls, 'ceilingY': max(w['height'] for w in room['walls']),
            'physicalThicknessPolicy': 'unknown; fixed 0.10m layout proxy only, independent of display step',
            'evidenceState': 'unseen', 'provenance': 'inferred',
            'omittedPolygonClosure': 'Only six measured RoomPlan wall segments; missing boundary edges stay unknown.'}


def point_in_wall_proxy(point, wall):
    p = np.asarray([point])
    u, y, d = wall_coordinates(p, wall)
    return bool(abs(d[0]) <= wall.get('layoutProxyThicknessM', .1) / 2 and
                0 <= u[0] <= wall['length'] and 0 <= y[0] <= wall['height'] and
                not in_openings(u, y, wall)[0])


def structure_grids(room, domains):
    result = {'schemaVersion': 1, 'frame': 'room-local-m', 'provenance': 'inferred',
              'evidenceState': 'unseen', 'solidDomainUri': 'structure-domains.json', 'grids': {}}
    for step in STEPS:
        groups, all_cells = [], []
        for wall in room['walls']:
            a, b = np.asarray(wall['a']), np.asarray(wall['b'])
            if min(np.abs(b - a)) > 1e-3:
                raise ValueError('This structure adapter requires aligned room-local walls; refusing silent re-rotation')
            along_axis = int(np.argmax(np.abs(b - a)))  # X/Z axis in 2D.
            normal_axis = 1 - along_axis
            constant = a[normal_axis]
            plane_index = int(np.floor(constant / step))
            lo, hi = sorted((a[along_axis], b[along_axis]))
            along = np.arange(int(np.floor(lo / step)), int(np.ceil(hi / step)))
            ys = np.arange(0, int(np.ceil(wall['height'] / step)))
            aa, yy = np.meshgrid(along, ys, indexing='ij')
            cells = np.zeros((aa.size, 3), dtype=int)
            cells[:, [0, 2][along_axis]] = aa.ravel()
            cells[:, [0, 2][normal_axis]] = plane_index
            cells[:, 1] = yy.ravel()
            centers = (cells + .5) * step
            u, y, _ = wall_coordinates(centers, wall)
            # A coarse cube crossing an opening is omitted, preserving passage.
            cells = cells[~in_openings(u, y, wall, pad=step / 2 + 1e-8)]
            groups.append(({'objectId': 'office-2:wall-' + str(wall['index']), 'category': 'wall',
                            'assignment': 'structure', 'normalLayers': 1}, cells))
            all_cells.append(cells)
        polygon = np.asarray(room['polygon'])
        xs = np.arange(int(np.floor(polygon[:, 0].min() / step)), int(np.ceil(polygon[:, 0].max() / step)))
        zs = np.arange(int(np.floor(polygon[:, 1].min() / step)), int(np.ceil(polygon[:, 1].max() / step)))
        xx, zz = np.meshgrid(xs, zs, indexing='ij')
        floor = np.column_stack((xx.ravel(), np.full(xx.size, -1), zz.ravel()))
        floor = floor[in_polygon((floor[:, [0, 2]] + .5) * step, room['polygon'])]
        groups.append(({'objectId': 'office-2:floor', 'category': 'floor', 'assignment': 'structure',
                        'surfaceY': 0, 'normalLayers': 1}, floor)); all_cells.append(floor)
        # Ceiling is stored in the physical prior but omitted from the display shell.
        cells = np.unique(np.concatenate(all_cells), axis=0)
        lookup = {tuple(cell): i for i, cell in enumerate(cells)}
        result['grids'][str(step)] = {'stepM': step, 'originM': [0, 0, 0], 'cellEncoding': 'index-xyz',
            'recordCount': len(cells), 'counts': {'total': len(cells), 'display': min(len(cells), 50000)},
            'cells': cells.tolist(), 'groups': [{**meta, 'cellIndices': [lookup[tuple(c)] for c in group]}
                                               for meta, group in groups],
            'displayShellPolicy': 'one global axis-aligned cell in wall normal; floor cube top is y=0; holes conservatively expanded half-cell'}
    return result


def corrected_table_patch(vertices, faces, ids, normals, item):
    if item['category'] != 'table' or not len(ids):
        return None
    centers = vertices[faces[ids]].mean(axis=1)
    top = item['center'][1] + item['size'][1] / 2
    selected = ids[(np.abs(normals[ids, 1]) > .9) & (np.abs(centers[:, 1] - top) < .10)]
    if len(selected) < 20:
        return None
    y = float(np.median(vertices[faces[selected]][:, :, 1]))
    points = local_coordinates(vertices[faces[selected]].reshape(-1, 3), item)
    half = np.asarray(item['size']) / 2
    lo = np.maximum(points.min(axis=0), -half)
    hi = np.minimum(points.max(axis=0), half)
    if hi[0] - lo[0] < .1 or hi[2] - lo[2] < .1:
        return None
    corners = np.array([[lo[0], 0, lo[2]], [hi[0], 0, lo[2]], [hi[0], 0, hi[2]], [lo[0], 0, hi[2]]])
    c, s = np.cos(item['rotY']), np.sin(item['rotY'])
    world = corners.copy()
    world[:, 0] = c * corners[:, 0] + s * corners[:, 2] + item['center'][0]
    world[:, 2] = -s * corners[:, 0] + c * corners[:, 2] + item['center'][2]
    world[:, 1] = y
    return world, np.array([[0, 1, 2], [0, 2, 3]]), {'planeY': y, 'supportFaceCount': len(selected),
        'sourceFaceIds': selected.tolist(), 'verticesM': world.tolist(),
        'warning': 'Rectangular inferred tabletop patch, limited by observed horizontal support and RoomPlan OBB; not a recovered complete tabletop.'}


def clutter_components(vertices, faces, ids, room, threshold=50, distance=.05, classes=None):
    result = []
    for component in components_for_faces(faces, ids):
        points = vertices[faces[component]].reshape(-1, 3)
        extent = np.ptp(points, axis=0)
        centers = vertices[faces[component]].mean(axis=1)
        separation = np.abs(centers[:, 1])
        ceiling = max(w['height'] for w in room['walls'])
        separation = np.minimum(separation, np.abs(centers[:, 1] - ceiling))
        for wall in room['walls']:
            u, y, d = wall_coordinates(centers, wall)
            within = (u >= 0) & (u <= wall['length']) & (y >= 0) & (y <= wall['height'])
            separation = np.minimum(separation, np.where(within, np.abs(d), np.inf))
        reasons = []
        if len(component) < threshold: reasons.append('too-few-faces')
        if np.count_nonzero(extent >= .05) < 2: reasons.append('small-or-linear')
        if separation.min() < distance: reasons.append('near-structure')
        if classes is not None and np.any(classes[component] != 0): reasons.append('existing-semantic-prior')
        for item in room.get('objects', []):
            if np.any(np.all(np.abs(local_coordinates(points, item)) <= np.asarray(item['size']) / 2 + .08, axis=1)):
                reasons.append('near-furniture-prior'); break
        stable_id = hashlib.sha256(np.sort(component).astype('<i8').tobytes()).hexdigest()[:16]
        result.append({'candidateId': 'office-2:clutter:' + stable_id,
            'sourceFaceIds': component.tolist(), 'faces': len(component),
            'extentM': extent.tolist(), 'structureDistanceM': float(separation.min()),
            'acceptedCandidate': not reasons, 'reasons': reasons, 'multiFrameSupport': None,
            'evidenceState': 'observed-surface', 'assignment': 'clutter-candidate' if not reasons else 'unknown',
            'warning': 'No aligned per-face frame identities: candidate only, requires review; never automatic deletion.'})
    return result


def prepare(args):
    started = time.perf_counter()
    room = json.loads(args.room.read_text()); raw_room = json.loads(args.roomplan.read_text())
    matrix = np.asarray(room['transform']['worldToRoom']).reshape(4, 4, order='F')
    thash = transform_hash(room['transform']['worldToRoom'])
    mapping = source_object_mapping(room, raw_room, matrix, args.scan_id)
    mesh = trimesh.load(args.source, process=False)
    raw = mesh.metadata['_ply_raw']; vd = raw['vertex']['data']; fd = raw['face']['data']
    vertices = transform_points(np.asarray(mesh.vertices), matrix); faces = np.asarray(mesh.faces)
    classes = fd['class']; centers = vertices[faces].mean(axis=1)
    cross = np.cross(vertices[faces[:, 1]] - vertices[faces[:, 0]], vertices[faces[:, 2]] - vertices[faces[:, 0]])
    area2 = np.linalg.norm(cross, axis=1); normals = cross / np.maximum(area2[:, None], 1e-20)
    inroom = np.all(vd['inroom'][faces] == 1, axis=1)
    eligible = inroom & (area2 > 1e-6)
    structure = structure_assignment(centers, normals, room, args.structure_distance) & eligible
    furniture_eligible = eligible & ~structure & np.isin(classes, [0, 4, 5]) & (centers[:, 1] >= .035)
    scores = candidate_scores(vertices, faces, centers, classes, room['objects'], furniture_eligible, args.margin)
    owners_count = np.isfinite(scores).sum(axis=1)
    assignments = np.full(len(faces), 'excluded', dtype='<U20')
    assignments[eligible] = 'unknown'; assignments[structure] = 'structure'
    assignments[owners_count > 1] = 'conflict'
    owner = np.full(len(faces), -1, dtype=int)
    for i in range(len(room['objects'])):
        ids = np.flatnonzero((owners_count == 1) & np.isfinite(scores[:, i]))
        assignments[ids] = 'rejected-noise'
        for component in components_for_faces(faces, ids):
            if len(component) >= args.min_component_faces:
                assignments[component] = 'one-owner'; owner[component] = i
    original_assignments = assignments.copy()
    overrides = []
    if args.overrides:
        document = json.loads(args.overrides.read_text())
        if document.get('sourceHash') != sha256(args.source):
            raise ValueError('Override sourceHash mismatch; source faces cannot be safely addressed')
        by_id = {row['objectId']: row['convertedIndex'] for row in mapping}
        for edit in document.get('overrides', []):
            face = int(edit['sourceFaceId']); target = edit['assignment']
            if not 0 <= face < len(faces) or not eligible[face]: raise ValueError('Override face outside eligible source domain')
            if assignments[face] == 'structure': raise ValueError('Furniture override cannot consume verified structural evidence')
            if target in by_id:
                assignments[face] = 'one-owner'; owner[face] = by_id[target]
            elif target in ('unknown', 'rejected-noise'):
                assignments[face] = target; owner[face] = -1
            else: raise ValueError('Unknown override assignment')
            overrides.append(edit)
    out = args.out; out.mkdir(parents=True, exist_ok=True)
    domains = structure_domains(room)
    write_json(out / 'structure-domains.json', domains)
    assets = {'structure-grid.json': structure_grids(room, domains)}
    object_groups, corrected_groups, object_rows, patches = [], [], [], []
    colors = np.column_stack([vd[name] for name in ('red', 'green', 'blue')])
    for i, item in enumerate(room['objects']):
        ids = np.flatnonzero(owner == i); meta = {**mapping[i], 'assignment': mapping[i]['objectId']}
        cells = surface_cells(vertices, faces[ids]); object_groups.append((meta, cells))
        used, inverse = np.unique(faces[ids].ravel(), return_inverse=True)
        candidate = trimesh.Trimesh(vertices=vertices[used], faces=inverse.reshape(-1, 3), process=False)
        candidate.visual.vertex_colors = np.column_stack((colors[used], np.full(len(used), 255, dtype=np.uint8)))
        name = f'object-{i:02d}-{item["category"]}.ply'; candidate.export(out / name)
        row = {**mapping[i], 'roomPlanObb': item, 'sourceFaceIds': ids.tolist(), 'faceCount': len(ids),
               'candidateFaceCount': int(np.isfinite(scores[:, i]).sum()),
               'conflictFaceCount': int(((owners_count > 1) & np.isfinite(scores[:, i])).sum()),
               'meshUri': name, 'watertight': bool(candidate.is_watertight),
               'aabb': {'min': candidate.bounds[0].tolist(), 'max': candidate.bounds[1].tolist()} if len(ids) else None}
        patch = corrected_table_patch(vertices, faces, ids, normals, item)
        if patch:
            pv, pf, detail = patch; corrected_groups.append((meta, surface_cells(pv, pf)))
            patches.append({**meta, **detail, 'provenance': 'inferred', 'evidenceState': 'unseen'})
        object_rows.append(row)
    assets['furniture-grid.json'] = grid_payload(object_groups, 'furniture-classified-grid')
    assets['furniture-corrected-grid.json'] = grid_payload(corrected_groups, 'furniture-corrected-grid', 'unseen', 'inferred')
    conflict_ids = np.flatnonzero(assignments == 'conflict')
    conflict_groups = []
    for owner_tuple in sorted(set(tuple(np.flatnonzero(np.isfinite(scores[f]))) for f in conflict_ids)):
        ids = np.array([f for f in conflict_ids if tuple(np.flatnonzero(np.isfinite(scores[f]))) == owner_tuple])
        ids_meta = [mapping[i]['objectId'] for i in owner_tuple]
        conflict_groups.append(({'objectId': 'conflict:' + '+'.join(map(str, owner_tuple)), 'assignment': 'conflict',
                                 'candidateOwners': ids_meta}, surface_cells(vertices, faces[ids])))
    assets['conflict-grid.json'] = grid_payload(conflict_groups, 'conflict-grid')
    unknown_ids = np.flatnonzero(assignments == 'unknown')
    assets['unknown-grid.json'] = grid_payload([({'assignment': 'unknown'}, surface_cells(vertices, faces[unknown_ids]))], 'unknown-grid')
    clutter_report = {'computed': bool(args.compute_clutter), 'skipClutter': not args.compute_clutter,
                      'multiFrameSupportAvailable': False, 'components': [], 'sensitivity': []}
    if args.compute_clutter:
        clutter_report['components'] = clutter_components(vertices, faces, unknown_ids, room, classes=classes)
        reviews = {}
        if args.clutter_overrides:
            document = json.loads(args.clutter_overrides.read_text())
            if document.get('sourceHash') != sha256(args.source):
                raise ValueError('Clutter override sourceHash mismatch')
            for edit in document.get('clutterOverrides', []):
                if edit['decision'] not in ('accept', 'reject'): raise ValueError('Invalid clutter review decision')
                if edit['candidateId'] in reviews: raise ValueError('Duplicate clutter candidate decision')
                reviews[edit['candidateId']] = edit
            known = {r['candidateId'] for r in clutter_report['components']}
            if set(reviews) - known: raise ValueError('Clutter override refers to unknown candidate IDs')
        clutter_groups = []
        for i, row in enumerate(clutter_report['components']):
            review = reviews.get(row['candidateId'])
            row['reviewState'] = 'accepted' if review and review['decision'] == 'accept' else 'rejected' if review else 'unreviewed'
            row['review'] = review
            row['includedInGrid'] = (row['acceptedCandidate'] or row['reviewState'] == 'accepted') and row['reviewState'] != 'rejected'
            if row['includedInGrid']:
                clutter_groups.append(({'objectId': row['candidateId'],
                                        'assignment': 'clutter-candidate', 'reviewState': row['reviewState']},
                                       surface_cells(vertices, faces[np.asarray(row['sourceFaceIds'])])))
        assets['clutter-grid.json'] = grid_payload(clutter_groups, 'clutter-candidate-grid')
        for threshold in (25, 50, 100):
            for distance in (.03, .05, .08):
                rows = clutter_components(vertices, faces, unknown_ids, room, threshold, distance, classes=classes)
                clutter_report['sensitivity'].append({'minimumFaces': threshold, 'distanceM': distance,
                    'candidates': sum(row['acceptedCandidate'] for row in rows),
                    'faces': sum(row['faces'] for row in rows if row['acceptedCandidate'])})
    else:
        # Do not leave a previous opt-in cache looking current under skip mode.
        (out / 'clutter-grid.json').unlink(missing_ok=True)
    counts = Counter(assignments[eligible].tolist())
    if sum(counts.values()) != int(eligible.sum()): raise AssertionError('Face conservation failed')
    sensitivity = []
    for margin in (.02, .045, .08):
        alternate = candidate_scores(vertices, faces, centers, classes, room['objects'], furniture_eligible, margin)
        number = np.isfinite(alternate).sum(axis=1)
        for minimum in (10, 25, 50):
            kept = 0
            for i in range(len(room['objects'])):
                ids = np.flatnonzero((number == 1) & np.isfinite(alternate[:, i]))
                kept += sum(len(c) for c in components_for_faces(faces, ids) if len(c) >= minimum)
            sensitivity.append({'marginM': margin, 'minComponentFaces': minimum,
                'oneOwnerBeforeCleanup': int((number == 1).sum()), 'conflictFaces': int((number > 1).sum()),
                'keptOneOwner': kept, 'unknownBeforeCleanup': int((furniture_eligible & (number == 0)).sum())})
    structure_sensitivity = [{'distanceM': d, 'faces': int((structure_assignment(centers, normals, room, d) & eligible).sum())}
                             for d in (.02, .03, .05)]
    conflicts = [{'sourceFaceId': int(f), 'currentAssignment': str(assignments[f]),
                  'currentOwner': mapping[owner[f]]['objectId'] if owner[f] >= 0 else None,
                  'candidateOwners': [{'objectId': mapping[i]['objectId'], 'score': float(scores[f, i])}
                  for i in np.flatnonzero(np.isfinite(scores[f]))]} for f in np.flatnonzero(owners_count > 1)]
    write_json(out / 'face-assignments.json', {'schemaVersion': 1, 'sourceHash': sha256(args.source),
        'sourceFaceIdsByAssignment': {name: np.flatnonzero(assignments == name).tolist() for name in np.unique(assignments)},
        'candidateConflicts': conflicts, 'overrides': overrides,
        'sourceFaceIdsByOriginalAssignment': {name: np.flatnonzero(original_assignments == name).tolist() for name in np.unique(original_assignments)},
        'originalCandidatesPreserved': [{'objectId': mapping[i]['objectId'],
            'sourceFaceIds': np.flatnonzero(np.isfinite(scores[:, i])).tolist(),
            'scores': scores[np.isfinite(scores[:, i]), i].tolist()} for i in range(len(mapping))],
        'warning': 'unknown is observed unassigned surface, not free space; no observed-free labels are produced'})
    write_json(out / 'furniture-corrections.json', {'patches': patches, 'provenance': 'inferred'})
    write_json(out / 'clutter-report.json', clutter_report)
    for name, data in assets.items(): write_json(out / name, data)
    source_files = [{'uri': 'converted.json', 'sha256': sha256(args.room)},
                    {'uri': 'source/Room/rooms/room-0.json', 'sha256': sha256(args.roomplan)},
                    {'uri': 'raw-mesh.ply', 'sha256': sha256(args.source)}]
    warnings = {'structure-grid.json': 'RoomPlan inferred display shell; wall thickness unknown; floor flat at y=0; missing boundary segments remain unknown.',
        'furniture-grid.json': 'Observed candidate surface only; all source furniture fragments may be incomplete. OBB overlap is conflict, not forced ownership.',
        'furniture-corrected-grid.json': 'Inferred horizontal tabletop patches only; keep measured furniture layer for comparison.',
        'conflict-grid.json': 'Multiple furniture owners remain unresolved.', 'unknown-grid.json': 'Unassigned observed surface; not empty and not automatically clutter.',
        'clutter-grid.json': 'Threshold candidates without independent frame support; manual review required.'}
    kinds = {'structure-grid.json': 'clean-structure-grid', 'furniture-grid.json': 'furniture-classified-grid',
             'furniture-corrected-grid.json': 'furniture-corrected-grid', 'conflict-grid.json': 'conflict-grid',
             'unknown-grid.json': 'unknown-grid', 'clutter-grid.json': 'clutter-candidate-grid'}
    layers = []
    for name, kind in kinds.items():
        present = name in assets
        layers.append({'id': kind, 'kind': kind, 'provenance': 'inferred' if name in ('structure-grid.json', 'furniture-corrected-grid.json') else 'measured',
            'geometryUri': name if present else None, 'units': 'm', 'transformHash': thash,
            'available': present, 'sha256': sha256(out / name) if present else None,
            'recordCount': assets[name]['grids']['0.2']['recordCount'] if present else 0,
            'displayCount': min(assets[name]['grids']['0.2']['recordCount'], 50000) if present else 0,
            'warning': warnings[name] if present else 'Not computed: run --compute-clutter explicitly; visibility does not run computation.'})
    report = {'schemaVersion': 1, 'scanId': args.scan_id, 'frame': 'room-local-m', 'transformHash': thash,
        'sourceFaces': len(faces), 'sourceVertices': len(vertices), 'inroomFaces': int(inroom.sum()),
        'eligibleFaces': int(eligible.sum()), 'excludedFaces': int((~eligible).sum()), 'assignments': dict(counts),
        'conservation': {'sum': sum(counts.values()), 'eligible': int(eligible.sum()), 'passes': sum(counts.values()) == int(eligible.sum())},
        'objects': object_rows, 'parameters': {'marginM': args.margin, 'minComponentFaces': args.min_component_faces,
            'structureDistanceM': args.structure_distance, 'clutterComputed': bool(args.compute_clutter)},
        'segmentationSensitivity': sensitivity, 'structureSensitivity': structure_sensitivity,
        'grids': {name: {step: grid['recordCount'] for step, grid in data['grids'].items()} for name, data in assets.items()},
        'tabletopCorrections': [{k: v for k, v in patch.items() if k != 'sourceFaceIds'} for patch in patches],
        'coordinateRoundTripMaxErrorM': float(np.max(np.abs(transform_points(vertices, np.linalg.inv(matrix)) - np.asarray(mesh.vertices)))),
        'elapsedSeconds': round(time.perf_counter() - started, 3),
        'peakRssMiB': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if __import__('sys').platform == 'darwin' else 1024), 1),
        'validationScope': 'Synthetic invariants and local scan proxy review only. No independent human-labelled ground truth or generalization accuracy.',
        'limitations': ['OBB prior misses surfaces outside boxes and cannot identify unseen furniture.',
                       'Shared faces stay conflict; disconnected small pieces may be rejected-noise.',
                       'Window glass/frames inside openings stay unknown; no Gaussian splat input exists.',
                       'Wall material thickness is unknown; proxy collision is not construction geometry.',
                       'No ray evidence: unobserved room cells remain unknown, never observed-free.']}
    write_json(out / 'segment-report.json', report)
    write_json(out / 'layer-manifest.json', {'schemaVersion': 1, 'scanId': args.scan_id, 'frame': 'room-local-m',
        'transformHash': thash, 'sourceFiles': source_files, 'generatedAt': datetime.now(timezone.utc).isoformat(),
        'objectMappings': mapping, 'layers': layers, 'reportUri': 'segment-report.json',
        'reportHash': sha256(out / 'segment-report.json'),
        'clutter': {'computed': bool(args.compute_clutter), 'computeCommand': 'python3 prepare_classified.py --compute-clutter',
                    'visibilityRunsComputation': False}, 'observedFreeAvailable': False})
    print(json.dumps({k: report[k] for k in ('eligibleFaces', 'assignments', 'conservation', 'grids', 'elapsedSeconds', 'peakRssMiB', 'coordinateRoundTripMaxErrorM')}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-id', default='office-2', choices=['office-2'])
    parser.add_argument('--source', type=Path, default=PRIVATE / 'raw-mesh.ply')
    parser.add_argument('--room', type=Path, default=PRIVATE / 'converted.json')
    parser.add_argument('--roomplan', type=Path, default=PRIVATE / 'source/Room/rooms/room-0.json')
    parser.add_argument('--out', type=Path, default=PRIVATE / 'derived-v1')
    parser.add_argument('--margin', type=float, default=.045)
    parser.add_argument('--structure-distance', type=float, default=.03)
    parser.add_argument('--min-component-faces', type=int, default=25)
    parser.add_argument('--compute-clutter', action='store_true')
    parser.add_argument('--overrides', type=Path)
    parser.add_argument('--clutter-overrides', type=Path)
    args = parser.parse_args()
    # Only private derived output is writable. Inputs and read-only baselines stay outside it.
    allowed = (PRIVATE / 'derived-v1').resolve()
    output = args.out.resolve()
    if not output.is_relative_to(allowed):
        parser.error('--out must stay inside experiment/.private/office-2/derived-v1/')
    inputs = [args.source, args.room, args.roomplan] + [p for p in (args.overrides, args.clutter_overrides) if p]
    if any(p.resolve().is_relative_to(output) for p in inputs):
        parser.error('An input file is inside output directory; refusing any possibility of source overwrite')
    if not all(p.is_file() for p in inputs): parser.error('A required input file is missing')
    if args.clutter_overrides and not args.compute_clutter:
        parser.error('--clutter-overrides requires explicit --compute-clutter')
    if not 0 < args.structure_distance <= .2 or not 0 <= args.margin <= .5 or args.min_component_faces < 1:
        parser.error('Invalid geometric thresholds')
    if not args.source.exists():
        parser.error('Missing original LiDAR PLY. Office 1 must use its depth/TSDF fallback; no raw mesh is fabricated.')
    prepare(args)


if __name__ == '__main__': main()
