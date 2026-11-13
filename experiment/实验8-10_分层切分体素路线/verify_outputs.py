#!/usr/bin/env python3
"""Read-only acceptance invariants for locally generated experiment 9 assets."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def verify(root):
    manifest = read(root / 'layer-manifest.json')
    report = read(root / 'segment-report.json')
    domains = read(root / 'structure-domains.json')
    assignments = read(root / 'face-assignments.json')
    assert manifest['schemaVersion'] == 1 and manifest['frame'] == 'room-local-m'
    assert report['transformHash'] == manifest['transformHash']
    assert report['conservation']['passes']
    assert report['conservation']['sum'] == report['eligibleFaces']
    partitions = assignments['sourceFaceIdsByAssignment']
    faces = [index for indices in partitions.values() for index in indices]
    assert len(faces) == len(set(faces)) == report['sourceFaces'], 'Source faces lost or double-assigned'
    assert set(faces) == set(range(report['sourceFaces']))
    objects = manifest['objectMappings']
    assert len(objects) == len({obj['objectId'] for obj in objects})
    assert all(obj['mappingState'] == 'verified' for obj in objects)
    assert all(wall['unknownThickness'] and wall['thicknessM'] is None
               and wall['layoutProxyThicknessM'] == .1 for wall in domains['walls'])
    cases = 0
    for layer in manifest['layers']:
        if not layer['available']:
            continue
        path = (root / layer['geometryUri']).resolve()
        assert path.is_relative_to(root.resolve()), 'Derived geometry escaped its directory'
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == layer['sha256'], 'Geometry hash mismatch'
        payload = json.loads(data)
        assert payload['frame'] == 'room-local-m'
        for step_text, grid in payload['grids'].items():
            step = float(step_text)
            assert grid['stepM'] == step and grid['originM'] == [0, 0, 0]
            cells = grid['cells']
            assert len(cells) == grid['recordCount'] == len({tuple(cell) for cell in cells})
            assert all(len(cell) == 3 and all(type(value) is int for value in cell) for cell in cells)
            for group in grid.get('groups', []):
                assert all(0 <= index < len(cells) for index in group['cellIndices'])
                if layer['kind'] != 'clean-structure-grid':
                    continue
                selected = [cells[index] for index in group['cellIndices']]
                if group['category'] == 'floor':
                    assert all(cell[1] == -1 for cell in selected), 'Floor top must remain y=0'
                    continue
                wall_id = int(group['objectId'].rsplit('-', 1)[-1])
                wall = domains['walls'][wall_id]
                normal_axis = 0 if abs(wall['n'][0]) > .9 else 2
                assert len({cell[normal_axis] for cell in selected}) == 1, 'Wall shell gained spines'
                for cell in selected:
                    center = [(index + .5) * step for index in cell]
                    u = sum((center[k] - wall['origin'][k]) * wall['u'][k] for k in range(3))
                    assert not any(opening['u0'] < u < opening['u1']
                                   and opening['v0'] < center[1] < opening['v1']
                                   for opening in wall.get('openings', [])), 'Opening filled with cells'
            cases += 1
    if not manifest['clutter']['computed']:
        assert not (root / 'clutter-grid.json').exists(), 'Skipped clutter left a misleading stale cache'
    return {'status': 'passed', 'sourceFaces': report['sourceFaces'],
            'eligibleFaces': report['eligibleFaces'], 'stableObjects': len(objects),
            'gridCasesChecked': cases, 'clutterComputed': manifest['clutter']['computed'],
            'scope': 'Conservation, hashes and geometric invariants; not segmentation accuracy.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', type=Path,
                        default=Path(__file__).resolve().parents[1] / '.private/office-2/derived-v1')
    print(json.dumps(verify(parser.parse_args().root), ensure_ascii=False, indent=2))
