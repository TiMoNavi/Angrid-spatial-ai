#!/usr/bin/env python3
"""Prepare private, reproducible browser evidence from two House Capture ZIPs.

The ZIPs are read-only. .private/ holds display thumbnails, one untouched PLY,
and sparse depth projections. It is intentionally ignored by Git.
"""

import argparse
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile
import zlib

import numpy as np
from PIL import Image, ImageOps


EXPERIMENT = Path(__file__).resolve().parents[1]
REPO = EXPERIMENT.parent
CONVERTER = REPO / 'reference/3d-model-anything/.agents/skills/scan-to-threejs/scripts/bundle_to_room.py'
PRIVATE = EXPERIMENT / '.private'


def unpack(zf, name, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(zf.read(name))


def palette(depth):
    t = np.clip((depth.astype(np.float32) - 0.35) / 3.8, 0, 1)
    stops = np.array([[22, 51, 76], [45, 138, 147], [228, 186, 97], [222, 109, 72]], dtype=np.float32)
    v = t * 3
    lo = np.minimum(v.astype(np.int32), 2)
    rgb = stops[lo] * (1 - (v - lo))[..., None] + stops[lo + 1] * (v - lo)[..., None]
    return rgb.astype(np.uint8)


def read_depth(zf, frame):
    raw = zlib.decompress(zf.read('Room/' + frame['file']), -15)
    values = np.frombuffer(raw, dtype='<f2').reshape(frame['height'], frame['width']).astype(np.float32)
    confidence = np.frombuffer(zf.read('Room/' + frame['confidence']), dtype=np.uint8).reshape(values.shape)
    return values, confidence


def write_cloud(path, points, colors):
    points = np.asarray(points, dtype='<f4')
    colors = np.asarray(colors, dtype=np.uint8)
    header = chr(10).join([
        'ply', 'format binary_little_endian 1.0',
        'comment sparse projection of source depth samples; not a fused reconstruction',
        'element vertex ' + str(len(points)),
        'property float x', 'property float y', 'property float z',
        'property uchar red', 'property uchar green', 'property uchar blue',
        'end_header', '',
    ])
    rows = np.empty(len(points), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'),
                                        ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')])
    for index, field in enumerate(('x', 'y', 'z')):
        rows[field] = points[:, index]
    for index, field in enumerate(('red', 'green', 'blue')):
        rows[field] = colors[:, index]
    with path.open('wb') as handle:
        handle.write(header.encode('ascii'))
        handle.write(rows.tobytes())


def sparse_projection(zf, frames, output):
    indices = sorted(set(np.linspace(0, len(frames) - 1, 12, dtype=int).tolist()))
    all_points, all_colors = [], []
    for index in indices:
        frame = frames[index]
        depth, conf = read_depth(zf, frame)
        step = 4
        yy, xx = np.mgrid[0:frame['height']:step, 0:frame['width']:step]
        depth, conf = depth[::step, ::step], conf[::step, ::step]
        valid = np.isfinite(depth) & (depth > 0.3) & (depth < 4.5) & (conf >= 1)
        if not np.any(valid):
            continue
        d = depth[valid]
        fx, fy, cx, cy = (frame['intrinsics'][0], frame['intrinsics'][4],
                          frame['intrinsics'][6], frame['intrinsics'][7])
        camera = np.column_stack(((xx[valid] - cx) * d / fx, -(yy[valid] - cy) * d / fy, -d))
        matrix = np.array(frame['transform'], dtype=np.float32).reshape((4, 4), order='F')
        world = camera @ matrix[:3, :3].T + matrix[:3, 3]
        all_points.append(world)
        all_colors.append(palette(d))
    points = np.concatenate(all_points)
    colors = np.concatenate(all_colors)
    write_cloud(output, points, colors)
    return len(points), len(indices)


def prepare_one(id, archive):
    output = PRIVATE / id
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        manifest = json.loads(zf.read('Room/manifest.json'))
        room = json.loads(zf.read('Room/rooms/room-0.json'))
        photos = json.loads(zf.read('Room/photos/photos.json'))
        frames = json.loads(zf.read('Room/depth/frames.json'))
        names = [info for info in zf.infolist() if not info.is_dir()]
        for name in ('manifest.json', 'rooms/room-0.json', 'photos/photos.json', 'depth/frames.json'):
            unpack(zf, 'Room/' + name, output / 'source' / 'Room' / name)
        converted = output / 'converted.json'
        result = subprocess.run([sys.executable, str(CONVERTER), str(output / 'source' / 'Room'),
                                 '--room', '0', '-o', str(converted)], capture_output=True, text=True, check=True)
        (output / 'conversion.log').write_text(result.stdout, encoding='utf-8')
        geometry = json.loads(converted.read_text())

        samples = []
        for index in sorted(set(np.linspace(0, len(photos) - 1, 8, dtype=int).tolist())):
            source = Image.open(io.BytesIO(zf.read('Room/' + photos[index]['file'])))
            image = ImageOps.exif_transpose(source)
            image.thumbnail((920, 720))
            filename = 'photo-' + str(index).zfill(3) + '.jpg'
            image.convert('RGB').save(output / filename, quality=85, optimize=True)
            samples.append({'index': index, 'file': id + '/' + filename, 'blur': photos[index].get('blurPixels')})

        candidate_indices = sorted(set(np.linspace(0, len(frames) - 1, 9, dtype=int).tolist()))
        selected = max(candidate_indices, key=lambda i: np.mean((lambda d, c: np.isfinite(d) & (d > 0.3) & (d < 4.5) & (c >= 1))(*read_depth(zf, frames[i]))))
        depth, conf = read_depth(zf, frames[selected])
        valid = np.isfinite(depth) & (depth > 0.3) & (depth < 4.5) & (conf >= 1)
        heat = palette(depth)
        heat[~valid] = [23, 32, 40]
        Image.fromarray(heat).resize((1024, 768), Image.Resampling.NEAREST).save(output / 'depth-heat.png')
        unpack(zf, 'Room/' + frames[selected]['rgb'], output / 'depth-rgb.jpg')
        point_count, sample_count = sparse_projection(zf, frames, output / 'depth-cloud.ply')

        has_mesh = 'Room/mesh/room-0.ply' in zf.namelist()
        if has_mesh:
            unpack(zf, 'Room/mesh/room-0.ply', output / 'raw-mesh.ply')
        all_suffixes = {Path(info.filename).suffix.lower() for info in names}
        folders = {}
        for info in names:
            parts = Path(info.filename).parts
            group = parts[1] if len(parts) > 2 else 'root'
            folders[group] = folders.get(group, 0) + 1
        polygon = geometry['polygon']
        xs, zs = zip(*polygon)
        mesh = manifest.get('mesh') or (manifest['rooms'][0].get('mesh') if manifest.get('rooms') else None)
        return {
            'id': id, 'label': 'Office 第一次' if id == 'office-1' else 'Office 第二次',
            'archive': archive.name, 'archiveBytes': archive.stat().st_size,
            'createdAt': manifest.get('createdAt'), 'format': manifest.get('format'),
            'fileCount': len(names), 'folders': folders, 'photoCount': len(photos),
            'depthFrameCount': len(frames), 'walls': len(room.get('walls', [])),
            'windows': len(room.get('windows', [])), 'doors': len(room.get('doors', [])),
            'objects': len(room.get('objects', [])), 'polygonBounds': [round(max(xs)-min(xs), 3), round(max(zs)-min(zs), 3)],
            'wallHeight': round(max(x['height'] for x in geometry['walls']), 3),
            'photoCoverage': manifest['rooms'][0].get('photoCoverage'),
            'hasMesh': has_mesh, 'mesh': mesh, 'hasGaussianAsset': bool(all_suffixes & {'.splat', '.ksplat', '.sog'}),
            'samples': samples, 'depthSampleIndex': selected, 'depthValidFraction': round(float(valid.mean()), 3),
            'projectedPoints': point_count, 'projectedFrames': sample_count,
            'files': [{'name': info.filename.removeprefix('Room/'), 'bytes': info.file_size}
                      for info in names if info.filename in {
                          'Room/manifest.json', 'Room/rooms/room-0.json', 'Room/rooms/room-0.usdz',
                          'Room/mesh/room-0.ply', 'Room/photos/photos.json', 'Room/depth/frames.json'}],
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--first', type=Path, default=Path.home() / 'Downloads/Office.zip')
    parser.add_argument('--second', type=Path, default=Path.home() / 'Downloads/Office 2.zip')
    args = parser.parse_args()
    PRIVATE.mkdir(exist_ok=True)
    summary = {'scans': [prepare_one('office-1', args.first), prepare_one('office-2', args.second)]}
    (PRIVATE / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    for scan in summary['scans']:
        print(scan['archive'], scan['fileCount'], 'files', scan['photoCount'], 'photos',
              scan['depthFrameCount'], 'depth frames', 'mesh:', scan['hasMesh'])
    print('private browser evidence:', PRIVATE)


if __name__ == '__main__':
    main()
