#!/usr/bin/env python3
"""Cache triangle/surface voxel intersections for private comparison meshes.

This is the experiment's adapter after the unchanged official reconstruction,
not an official output and not a filled volume or a free-space map.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import open3d as o3d

from prepare_voxel_evidence import PRIVATE, room_grid


STEPS = (0.2, 0.1, 0.05, 0.025)


def read_inroom(path):
    """Read the vertex flag without discarding triangle topology or other fields."""
    types = {'float': '<f4', 'double': '<f8', 'uchar': 'u1', 'uint': '<u4', 'int': '<i4'}
    with path.open('rb') as stream:
        properties = []
        element = None
        count = None
        while True:
            line = stream.readline().decode('ascii').strip()
            if not line:
                raise ValueError('Unexpected PLY header ending')
            fields = line.split()
            if fields[:1] == ['format'] and fields[1] != 'binary_little_endian':
                raise ValueError('Expected little-endian binary PLY')
            if fields[:1] == ['element']:
                element = fields[1]
                if element == 'vertex':
                    count = int(fields[2])
            elif fields[:1] == ['property'] and element == 'vertex':
                properties.append((fields[2], types[fields[1]]))
            elif line == 'end_header':
                break
        vertices = np.frombuffer(stream.read(count * np.dtype(properties).itemsize), dtype=properties)
    if 'inroom' not in vertices.dtype.names:
        raise ValueError('Original PLY is missing the inroom flag')
    return vertices['inroom'] == 1


def surface_grids(mesh, room):
    origin, limits, _ = room_grid(room)
    grids = {}
    for step in STEPS:
        counts = np.ceil((limits - origin) / step).astype(np.int64)
        grid = o3d.geometry.VoxelGrid.create_from_triangle_mesh_within_bounds(
            mesh, step, origin, origin + counts * step)
        if not np.allclose(grid.origin, origin, atol=1e-9):
            raise ValueError('Mesh and room grid origins differ')
        indices = np.asarray([voxel.grid_index for voxel in grid.get_voxels()], dtype=np.int64).reshape(-1, 3)
        indices = indices[np.all((indices >= 0) & (indices < counts), axis=1)]
        keys = np.unique((indices[:, 0] * counts[1] + indices[:, 1]) * counts[2] + indices[:, 2])
        grids[str(step)] = {'step': step, 'origin': origin.tolist(), 'counts': counts.tolist(),
                            'surfaceCells': len(keys), 'keys': keys.tolist()}
    return grids


def prepare(scan_id):
    output = PRIVATE / scan_id
    room = json.loads((output / 'converted.json').read_text())
    sources = {}
    fusion = output / 'reference-depth/scan_room.ply'
    if fusion.exists():
        mesh = o3d.io.read_triangle_mesh(str(fusion))
        sources['fusion'] = {'geometry': 'reference-depth/scan_room.ply',
                             'vertices': len(mesh.vertices), 'triangles': len(mesh.triangles),
                             'grids': surface_grids(mesh, room)}
    raw = output / 'raw-mesh.ply'
    if raw.exists():
        inroom = read_inroom(raw)
        mesh = o3d.io.read_triangle_mesh(str(raw))
        if len(inroom) != len(mesh.vertices):
            raise ValueError('PLY flag/vertex count mismatch')
        mesh.remove_vertices_by_mask(~inroom)
        transform = np.asarray(room['transform']['worldToRoom']).reshape(4, 4, order='F')
        mesh.transform(transform)
        target = output / 'mesh-voxels/raw-room.ply'
        target.parent.mkdir(parents=True, exist_ok=True)
        if not o3d.io.write_triangle_mesh(str(target), mesh):
            raise RuntimeError('Could not save filtered room mesh')
        sources['ply'] = {'geometry': 'mesh-voxels/raw-room.ply',
                          'originalVertices': len(inroom), 'inroomVertices': int(inroom.sum()),
                          'vertices': len(mesh.vertices), 'triangles': len(mesh.triangles),
                          'grids': surface_grids(mesh, room)}
    cache = {'method': 'Open3D triangle / voxel-box intersections; surface only; no solid fill',
             'coordinates': 'room-local, +Y up, meters; no further worldToRoom transform',
             'sources': sources}
    (output / 'mesh-surface-grids.json').write_text(json.dumps(cache, separators=(',', ':')) + '\n')
    report_path = output / 'full-depth-surface-report.json'
    if report_path.exists():
        report = json.loads(report_path.read_text())
        report['meshSurfaceCacheAvailable'] = True
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(scan_id, {name: {'triangles': value['triangles'],
                           'cells': {step: grid['surfaceCells'] for step, grid in value['grids'].items()}}
                    for name, value in sources.items()}, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan', choices=('both', 'office-1', 'office-2'), default='both')
    args = parser.parse_args()
    for scan_id in ('office-2', 'office-1'):
        if args.scan in ('both', scan_id):
            prepare(scan_id)


if __name__ == '__main__':
    main()
