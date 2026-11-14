#!/usr/bin/env python3
"""Project every captured depth frame into a room-local sparse surface grid.

Original ZIPs are read-only. This is point-evidence accumulation, not TSDF fusion,
watertight reconstruction, or proof that unmarked cells are empty.
"""

import argparse
import json
from pathlib import Path
import zipfile
import zlib

import numpy as np


EXPERIMENT = Path(__file__).resolve().parents[1]
PRIVATE = EXPERIMENT / '.private'
BASE_STEP = 0.025
PIXEL_STRIDE = 4
MARGIN = 0.15


def room_grid(room):
    polygon = np.asarray(room['polygon'], dtype=np.float64)
    height = max(wall['height'] for wall in room['walls'])
    origin = np.array([polygon[:, 0].min() - MARGIN, -MARGIN,
                       polygon[:, 1].min() - MARGIN], dtype=np.float64)
    limits = np.array([polygon[:, 0].max() + MARGIN, height + MARGIN,
                       polygon[:, 1].max() + MARGIN], dtype=np.float64)
    counts = np.ceil((limits - origin) / BASE_STEP).astype(np.int32)
    return origin, limits, counts


def project_frame(zf, frame, world_to_room):
    shape = (frame['height'], frame['width'])
    raw = zf.read('Room/' + frame['file'])
    if frame['file'].endswith('.f16z'):
        raw = zlib.decompress(raw, -15)
    depth = np.frombuffer(raw, dtype='<f2').reshape(shape)[::PIXEL_STRIDE, ::PIXEL_STRIDE].astype(np.float32)
    conf = np.frombuffer(zf.read('Room/' + frame['confidence']), dtype=np.uint8).reshape(shape)[::PIXEL_STRIDE, ::PIXEL_STRIDE]
    # Match the reference fusion's confidence / maximum depth defaults.
    valid = np.isfinite(depth) & (depth > 0) & (depth < 3.5) & (conf >= 1)
    if not valid.any():
        return np.empty((0, 3), dtype=np.float32)
    rows, cols = np.nonzero(valid)
    x = cols * PIXEL_STRIDE
    y = rows * PIXEL_STRIDE
    d = depth[valid]
    k = frame['intrinsics']
    camera = np.column_stack(((x - k[6]) * d / k[0], -(y - k[7]) * d / k[4], -d))
    camera_to_world = np.asarray(frame['transform'], dtype=np.float64).reshape((4, 4), order='F')
    camera_to_room = world_to_room @ camera_to_world
    return (camera @ camera_to_room[:3, :3].T + camera_to_room[:3, 3]).astype(np.float32)


def write_ply(path, centers, hits):
    strength = np.minimum(1.0, np.log1p(hits) / np.log1p(8))
    rows = np.empty(len(centers), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
                                         ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')])
    for i, axis in enumerate(('x', 'y', 'z')):
        rows[axis] = centers[:, i]
    rows['red'] = 46 + strength * 58
    rows['green'] = 107 + strength * 100
    rows['blue'] = 117 + strength * 72
    header = '\n'.join([
        'ply', 'format binary_little_endian 1.0',
        'comment all captured depth frames, every fourth pixel, projected into room-local 2.5 cm cells',
        'comment diagnostic color indicates repeated depth hits; not photographic texture',
        'element vertex ' + str(len(rows)),
        'property float x', 'property float y', 'property float z',
        'property uchar red', 'property uchar green', 'property uchar blue',
        'end_header', '',
    ])
    with path.open('wb') as output:
        output.write(header.encode('ascii'))
        output.write(rows.tobytes())


def prepare(scan_id, archive):
    output = PRIVATE / scan_id
    room = json.loads((output / 'converted.json').read_text(encoding='utf-8'))
    origin, limits, counts = room_grid(room)
    world_to_room = np.asarray(room['transform']['worldToRoom'], dtype=np.float64).reshape((4, 4), order='F')
    all_keys = []
    valid_samples = 0
    included_samples = 0
    with zipfile.ZipFile(archive) as zf:
        frames = json.loads(zf.read('Room/depth/frames.json'))
        for frame in frames:
            points = project_frame(zf, frame, world_to_room)
            valid_samples += len(points)
            indices = np.floor((points - origin) / BASE_STEP).astype(np.int32)
            inside = np.all((indices >= 0) & (indices < counts), axis=1)
            indices = indices[inside]
            included_samples += len(indices)
            if len(indices):
                keys = (indices[:, 0].astype(np.int64) * counts[1] + indices[:, 1]) * counts[2] + indices[:, 2]
                all_keys.append(keys)
    if not all_keys:
        raise RuntimeError(scan_id + ': no valid depth samples inside candidate room bounds')
    keys, hits = np.unique(np.concatenate(all_keys), return_counts=True)
    iz = keys % counts[2]
    iy = (keys // counts[2]) % counts[1]
    ix = keys // (counts[1] * counts[2])
    centers = origin + (np.column_stack((ix, iy, iz)) + 0.5) * BASE_STEP
    write_ply(output / 'full-depth-surface-025.ply', centers.astype(np.float32), hits)
    report = {
        'scanId': scan_id,
        'sourceArchive': archive.name,
        'method': 'all depth frames; confidence >= 1; 0 < depth < 3.5 m; every fourth pixel; repeated room-local surface hits',
        'maxDepthM': 3.5,
        'minConfidence': 1,
        'meshSurfaceCacheAvailable': (output / 'mesh-surface-grids.json').exists(),
        'depthFramesProcessed': len(frames),
        'pixelStride': PIXEL_STRIDE,
        'validSampledPixels': valid_samples,
        'insideCandidateBounds': included_samples,
        'baseVoxelStepM': BASE_STEP,
        'surfaceCells': len(keys),
        'cellsWithTwoOrMoreHits': int(np.count_nonzero(hits >= 2)),
        'origin': origin.tolist(),
        'limits': limits.tolist(),
        'counts': counts.tolist(),
        'caveat': 'Unmarked cells are not confirmed empty. Source PLY, if present, is independent comparison evidence.',
    }
    (output / 'full-depth-surface-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(scan_id, len(frames), 'frames ->', included_samples, 'in-bounds samples ->', len(keys), 'surface cells')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first', type=Path, default=Path.home() / 'Downloads/Office.zip')
    parser.add_argument('--second', type=Path, default=Path.home() / 'Downloads/Office 2.zip')
    parser.add_argument('--scan', choices=('both', 'office-1', 'office-2'), default='both')
    args = parser.parse_args()
    if args.scan in ('both', 'office-1'):
        prepare('office-1', args.first)
    if args.scan in ('both', 'office-2'):
        prepare('office-2', args.second)


if __name__ == '__main__':
    main()
