"""Stable room-local floor-plan data and SVG preview for E22 scan assets.

The base plan is RoomPlan geometry from converted.json. It is never rebuilt from
noisy PLY fragments or replaced by an AI proposal.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
import hashlib
import html
import json
import math
from pathlib import Path

from geometry_v1 import transform_hash


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _finite(values: object, count: int, label: str) -> None:
    if (not isinstance(values, list) or len(values) != count or
            any(isinstance(x, bool) or not isinstance(x, (int, float)) or
                not math.isfinite(x) for x in values)):
        raise ValueError(f'invalid floor-plan {label}')


def build_plan(scan: Path, imported: dict, room: dict, classified: dict,
               report: dict, source_hash: str) -> dict:
    """Return RoomLayout-compatible geometry plus identity and 1:1 object refs."""
    polygon = room.get('polygon')
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise ValueError('floor plan needs at least three polygon corners')
    for point in polygon:
        _finite(point, 2, 'polygon point')
    walls = room.get('walls')
    objects = room.get('objects')
    if not isinstance(walls, list) or not isinstance(objects, list):
        raise ValueError('floor plan needs wall and object arrays')
    for wall in walls:
        if not isinstance(wall, dict) or not isinstance(wall.get('openings'), list):
            raise ValueError('invalid floor-plan wall')
        for name, count in (('a', 2), ('b', 2), ('u', 3)):
            _finite(wall.get(name), count, 'wall ' + name)
        if not isinstance(wall.get('length'), (int, float)) or not math.isfinite(wall['length']):
            raise ValueError('invalid floor-plan wall length')
        for opening in wall['openings']:
            if not isinstance(opening, dict) or not isinstance(opening.get('kind'), str):
                raise ValueError('invalid floor-plan opening')
            for key in ('u0', 'u1'):
                if not isinstance(opening.get(key), (int, float)) or not math.isfinite(opening[key]):
                    raise ValueError('invalid floor-plan opening span')
    for obj in objects:
        if not isinstance(obj, dict) or not isinstance(obj.get('category'), str):
            raise ValueError('invalid floor-plan furniture')
        _finite(obj.get('center'), 3, 'object center')
        _finite(obj.get('size'), 3, 'object size')
        if any(value <= 0 for value in obj['size']):
            raise ValueError('invalid floor-plan object size')
        if not isinstance(obj.get('rotY'), (int, float)) or not math.isfinite(obj['rotY']):
            raise ValueError('invalid floor-plan object rotation')

    matrix = room.get('transform', {}).get('worldToRoom')
    _finite(matrix, 16, 'worldToRoom transform')
    actual_transform = transform_hash(matrix)
    if (classified.get('transformHash') != actual_transform or
            report.get('transformHash') != actual_transform or
            imported.get('scanId') != scan.name or
            report.get('scanId') != scan.name):
        raise ValueError('floor-plan scan or transform identity differs')
    if imported.get('converted', {}).get('sha256') != sha(scan / 'converted.json'):
        raise ValueError('floor-plan converted room differs from import')
    report_rows = report.get('objects')
    if not isinstance(report_rows, list) or len(report_rows) != len(objects):
        raise ValueError('floor-plan object mapping is incomplete')
    refs: list[dict] = []
    seen: set[int] = set()
    seen_ids: set[str] = set()
    for row in report_rows:
        if not isinstance(row, dict):
            raise ValueError('invalid floor-plan object mapping')
        index = row.get('convertedIndex')
        identifier = row.get('objectId')
        if (isinstance(index, bool) or not isinstance(index, int) or
                index < 0 or index >= len(objects) or index in seen or
                not isinstance(identifier, str) or not identifier or identifier in seen_ids or
                row.get('category') != objects[index]['category']):
            raise ValueError('floor-plan object mapping is ambiguous')
        seen.add(index)
        seen_ids.add(identifier)
        refs.append({'convertedIndex': index, 'objectId': identifier,
                     'sourceIdentifier': row.get('sourceIdentifier'),
                     'category': row['category'],
                     'mappingState': row.get('mappingState'),
                     'provenance': 'roomplan-inferred', 'reviewState': 'unreviewed'})
    refs.sort(key=lambda row: row['convertedIndex'])
    result = {'schemaVersion': 1, 'kind': 'room-layout-plan',
              'scanId': scan.name, 'roomIndex': imported['roomIndex'],
              'frame': 'room-local-m', 'units': 'm',
              'transformHash': actual_transform,
              'convertedHash': sha(scan / 'converted.json'),
              'segmentReportSha256': sha(scan / 'derived-v1/segment-report.json'),
              'sourcePlySha256': source_hash,
              'sourceArchiveSha256': imported['sourceArchive']['sha256'],
              'provenance': 'roomplan-inferred',
              'note': 'RoomPlan geometry; furniture boxes are detections, not complete models.',
              'polygon': polygon, 'walls': walls, 'objects': objects,
              'objectRefs': refs}
    if isinstance(room.get('rooms'), list):
        result['rooms'] = room['rooms']
    return result


def _number(value: float) -> str:
    value = 0 if abs(value) < 0.00000005 else value
    return format(value, '.6g')


def _boundary(origin: float, step: float, index: int) -> float:
    return float(Decimal(str(origin)) + Decimal(str(step)) * index)


def render_svg(plan: dict) -> str:
    """Draw the same room-local X/Z data; this image is a preview, not edit data."""
    polygon = plan['polygon']
    xs, zs = [point[0] for point in polygon], [point[1] for point in polygon]
    min_x, max_x, min_z, max_z = min(xs), max(xs), min(zs), max(zs)
    margin = .55
    view = ' '.join(_number(v) for v in
                    (min_x - margin, min_z - margin,
                     max_x - min_x + 2 * margin, max_z - min_z + 2 * margin))
    points = ' '.join(','.join(_number(v) for v in point) for point in polygon)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" '
             f'role="img" aria-label="Room floor plan" data-scan-id="{html.escape(plan["scanId"], quote=True)}">',
             '<rect x="-100000" y="-100000" width="200000" height="200000" fill="#f7f8f4"/>',
             f'<polygon points="{points}" fill="#e7eae1" stroke="#a6b0a8" stroke-width="0.02"/>']
    for index, obj in enumerate(plan['objects']):
        x, _, z = obj['center']
        width, _, depth = obj['size']
        angle = -obj['rotY'] * 180 / math.pi
        category = html.escape(obj['category'], quote=True)
        label = html.escape(plan['objectRefs'][index]['objectId'], quote=True)
        fill = '#d8bd93' if obj['category'] == 'table' else '#b8cbbd' if obj['category'] == 'storage' else '#bcc9d5'
        parts.append(f'<g transform="translate({_number(x)} {_number(z)}) rotate({_number(angle)})" '
                     f'data-object-id="{label}"><title>{category}</title>'
                     f'<rect x="{_number(-width/2)}" y="{_number(-depth/2)}" '
                     f'width="{_number(width)}" height="{_number(depth)}" fill="{fill}" '
                     'stroke="#73837d" stroke-width="0.015"/></g>')
    for wall in plan['walls']:
        a, b, u = wall['a'], wall['b'], wall['u']
        parts.append(f'<line x1="{_number(a[0])}" y1="{_number(a[1])}" '
                     f'x2="{_number(b[0])}" y2="{_number(b[1])}" '
                     'stroke="#293e42" stroke-width="0.075"/>')
        for opening in wall['openings']:
            x1, z1 = a[0] + u[0] * opening['u0'], a[1] + u[2] * opening['u0']
            x2, z2 = a[0] + u[0] * opening['u1'], a[1] + u[2] * opening['u1']
            coords = f'x1="{_number(x1)}" y1="{_number(z1)}" x2="{_number(x2)}" y2="{_number(z2)}"'
            color = '#258eaf' if opening['kind'] == 'window' else '#be753d'
            parts.append(f'<line {coords} stroke="#f7f8f4" stroke-width="0.09"/>')
            parts.append(f'<line {coords} stroke="{color}" stroke-width="0.025"/>')
    for index, obj in enumerate(plan['objects']):
        x, _, z = obj['center']
        parts.append(f'<text x="{_number(x)}" y="{_number(z)}" text-anchor="middle" '
                     'dominant-baseline="central" font-size="0.14" fill="#22383c" '
                     f'stroke="white" stroke-width="0.045" paint-order="stroke">{index+1}</text>')
    width, height = max_x - min_x, max_z - min_z
    parts.append(f'<text x="{_number((min_x+max_x)/2)}" y="{_number(min_z-.2)}" '
                 'text-anchor="middle" font-size="0.16" fill="#3b5356">'
                 f'{_number(width)} m × {_number(height)} m</text></svg>')
    return ''.join(parts) + '\n'


def build_model_candidates(plan: dict, occupancy: dict, occupancy_hash: str) -> dict:
    """Keep exact X/Z occupied-cell footprints separate from RoomPlan furniture."""
    if (occupancy.get('scanId') != plan['scanId'] or
            occupancy.get('transformHash') != plan['transformHash'] or
            occupancy.get('sourcePlySha256') != plan['sourcePlySha256'] or
            occupancy.get('frame') != 'room-local-m'):
        raise ValueError('model floor-plan candidates belong to another scan')
    grid = occupancy['grid']
    step, origin = grid['stepM'], grid['originM']
    _finite(origin, 3, 'model grid origin')
    if not isinstance(step, (int, float)) or not math.isfinite(step) or step <= 0:
        raise ValueError('invalid model grid step')
    xz: dict[str, set[tuple[int, int]]] = defaultdict(set)
    ys: dict[str, list[int]] = defaultdict(list)
    instance_ids = [instance['instanceId'] for instance in occupancy['instances']]
    if (any(not isinstance(value, str) or not value for value in instance_ids) or
            len(set(instance_ids)) != len(instance_ids)):
        raise ValueError('ambiguous model footprint instance IDs')
    valid_ids = set(instance_ids)
    for cell in occupancy['cells']:
        index = cell['indexXYZ']
        if (not isinstance(index, list) or len(index) != 3 or
                any(isinstance(x, bool) or not isinstance(x, int) for x in index)):
            raise ValueError('invalid model cell index')
        identifiers = cell.get('candidateInstanceIds')
        if (not isinstance(identifiers, list) or not identifiers or
                any(identifier not in valid_ids for identifier in identifiers)):
            raise ValueError('model footprint has an unknown instance ID')
        for identifier in identifiers:
            xz[identifier].add((index[0], index[2]))
            ys[identifier].append(index[1])
    candidates = []
    for instance in occupancy['instances']:
        identifier = instance['instanceId']
        cells = sorted(xz[identifier])
        if not cells:
            continue
        min_x, max_x = min(x for x, _ in cells), max(x for x, _ in cells)
        min_z, max_z = min(z for _, z in cells), max(z for _, z in cells)
        candidates.append({'instanceId': identifier, 'categoryClaim': instance.get('categoryClaim'),
                           'label': instance.get('label'),
                           'sourceRoomPlanObjectId': instance.get('sourceRoomPlanObjectId'),
                           'provenance': 'model-inferred', 'reviewState': 'unreviewed',
                           'ownerAcceptanceBlocked': True,
                           'occupiedXZ': [[x, z] for x, z in cells],
                           'footprintBoundsM': {'min': [_boundary(origin[0], step, min_x),
                                                        _boundary(origin[2], step, min_z)],
                                                'max': [_boundary(origin[0], step, max_x+1),
                                                        _boundary(origin[2], step, max_z+1)]},
                           'heightRangeM': [_boundary(origin[1], step, min(ys[identifier])),
                                            _boundary(origin[1], step, max(ys[identifier])+1)]})
    return {'schemaVersion': 1, 'kind': 'model-floor-plan-candidates',
            'scanId': plan['scanId'], 'frame': 'room-local-m', 'units': 'm',
            'transformHash': plan['transformHash'],
            'sourcePlySha256': plan['sourcePlySha256'],
            'occupancySha256': occupancy_hash, 'planSha256': occupancy['planSha256'],
            'grid': grid, 'provenance': 'model-inferred', 'reviewState': 'unreviewed',
            'ownerAcceptanceBlocked': True, 'candidates': candidates}
