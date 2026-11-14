#!/usr/bin/env python3
"""Software-render a grid-native GLB on prepared photos at converted camera poses.

This is visual QA only: it does not model photo occlusion or accept scan ownership.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image
import trimesh

import voxel_plan_builder as builder
from bind_voxel_evidence import transform_hash


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def rgb(value: str) -> np.ndarray:
    if len(value) != 7 or value[0] != '#':
        raise ValueError('color must be #RRGGBB')
    try:
        return np.array([int(value[i:i + 2], 16) for i in (1, 3, 5)], dtype=float)
    except ValueError as exc:
        raise ValueError('color must be #RRGGBB') from exc


def camera(photo: dict) -> tuple[np.ndarray, np.ndarray]:
    position = np.asarray(photo['position'], dtype=float)
    forward = np.asarray(photo['forward'], dtype=float)
    up = np.asarray(photo['up'], dtype=float)
    if (position.shape != (3,) or forward.shape != (3,) or up.shape != (3,) or
            not np.isfinite(np.r_[position, forward, up]).all() or
            np.linalg.norm(forward) < .5 or np.linalg.norm(up) < .5):
        raise ValueError('invalid converted photo pose')
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, up)
    if np.linalg.norm(right) < .1:
        raise ValueError('photo forward and up are parallel')
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    return position, np.stack((right, up, forward))


def view_points(points: np.ndarray, position: np.ndarray, basis: np.ndarray) -> np.ndarray:
    return (points - position) @ basis.T


def project(points: np.ndarray, fov_y: float, width: int, height: int) -> np.ndarray:
    if not 1 < fov_y < 179:
        raise ValueError('fovY must be between 1 and 179 degrees')
    focal = height / (2 * math.tan(math.radians(fov_y) / 2))
    return np.column_stack((width / 2 + focal * points[:, 0] / points[:, 2],
                            height / 2 - focal * points[:, 1] / points[:, 2]))


def clip_near(triangle: np.ndarray, near: float = .03) -> list[np.ndarray]:
    polygon = []
    previous = triangle[-1]
    for current in triangle:
        was, now = previous[2] >= near, current[2] >= near
        if was != now:
            t = (near - previous[2]) / (current[2] - previous[2])
            polygon.append(previous + t * (current - previous))
        if now:
            polygon.append(current)
        previous = current
    return [np.stack((polygon[0], polygon[i], polygon[i + 1]))
            for i in range(1, len(polygon) - 1)] if len(polygon) >= 3 else []


def raster_triangle(zbuffer: np.ndarray, view: np.ndarray, fov_y: float) -> None:
    height, width = zbuffer.shape
    screen = project(view, fov_y, width, height)
    x0, x1 = max(0, int(math.floor(screen[:, 0].min()))), min(width, int(math.ceil(screen[:, 0].max())) + 1)
    y0, y1 = max(0, int(math.floor(screen[:, 1].min()))), min(height, int(math.ceil(screen[:, 1].max())) + 1)
    if x0 >= x1 or y0 >= y1:
        return
    (ax, ay), (bx, by), (cx, cy) = screen
    denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denom) < 1e-8:
        return
    x, y = np.meshgrid(np.arange(x0, x1) + .5, np.arange(y0, y1) + .5)
    wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
    wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
    wc = 1 - wa - wb
    inside = (wa >= -1e-7) & (wb >= -1e-7) & (wc >= -1e-7)
    if not inside.any():
        return
    depth = 1 / np.maximum(wa / view[0, 2] + wb / view[1, 2] + wc / view[2, 2], 1e-12)
    region = zbuffer[y0:y1, x0:x1]
    closer = inside & (depth < region)
    region[closer] = depth[closer]


def render_depth(scene: trimesh.Scene, photo: dict, width: int, height: int) -> np.ndarray:
    position, basis = camera(photo)
    zbuffer = np.full((height, width), np.inf, dtype=np.float32)
    for node in scene.graph.nodes_geometry:
        transform, name = scene.graph[node]
        mesh = scene.geometry[name]
        world = trimesh.transform_points(np.asarray(mesh.vertices), transform)
        view = view_points(world, position, basis)
        for face in mesh.faces:
            for clipped in clip_near(view[face]):
                raster_triangle(zbuffer, clipped, float(photo['fovY']))
    return zbuffer


def clip_line(a: np.ndarray, b: np.ndarray, near: float = .03):
    a_inside, b_inside = a[2] >= near, b[2] >= near
    if not a_inside and not b_inside:
        return None
    if a_inside != b_inside:
        t = (near - a[2]) / (b[2] - a[2])
        crossing = a + t * (b - a)
        a, b = (a, crossing) if a_inside else (crossing, b)
    return a, b


def render_wire(occupancy: dict, photo: dict, zbuffer: np.ndarray) -> np.ndarray:
    height, width = zbuffer.shape
    position, basis = camera(photo)
    step = float(occupancy['grid']['stepM'])
    origin = np.asarray(occupancy['grid']['originM'], dtype=float)
    cells = {tuple(row['indexXYZ']) for row in occupancy['cells']}
    wire = np.zeros((height, width), dtype=bool)
    for cell in cells:
        index = np.asarray(cell, dtype=float)
        for direction, corners in builder.SIDES:
            if tuple(cell[i] + direction[i] for i in range(3)) in cells:
                continue
            points = origin + (index + np.asarray(corners, dtype=float)) * step
            view = view_points(points, position, basis)
            for i in range(4):
                clipped = clip_line(view[i], view[(i + 1) % 4])
                if clipped is None:
                    continue
                a, b = clipped
                screen = project(np.stack((a, b)), float(photo['fovY']), width, height)
                span = int(np.ceil(np.max(np.abs(screen[1] - screen[0]))))
                if span < 1 or span > 10000:
                    continue
                t = np.linspace(0, 1, span + 1)
                pixels = np.rint(screen[0] + t[:, None] * (screen[1] - screen[0])).astype(int)
                x, y = pixels[:, 0], pixels[:, 1]
                inside = (x >= 0) & (x < width) & (y >= 0) & (y < height)
                x, y, t = x[inside], y[inside], t[inside]
                if not len(x):
                    continue
                depth = 1 / ((1 - t) / a[2] + t / b[2])
                visible = depth <= zbuffer[y, x] + max(.012, step * .24)
                wire[y[visible], x[visible]] = True
    return wire


def render_one(scene: trimesh.Scene, occupancy: dict, photo: dict, source: Image.Image,
               max_width: int, alpha: float, fill: np.ndarray, line: np.ndarray):
    if source.width > max_width:
        source = source.resize((max_width, round(source.height * max_width / source.width)), Image.Resampling.LANCZOS)
    width, height = source.size
    if abs(width / height - photo['aspect']) > .015:
        raise ValueError('prepared photo aspect differs from converted camera')
    zbuffer = render_depth(scene, photo, width, height)
    wire = render_wire(occupancy, photo, zbuffer)
    mask = np.isfinite(zbuffer)
    original = np.asarray(source.convert('RGB'), dtype=float)
    overlay = original.copy()
    overlay[mask] = (1 - alpha) * original[mask] + alpha * fill
    overlay[wire] = .2 * overlay[wire] + .8 * line
    model_only = np.empty_like(original)
    model_only[:] = [28, 31, 40]
    model_only[mask] = fill
    model_only[wire] = line
    pixels = np.argwhere(mask)
    bounds = None if not len(pixels) else [int(pixels[:, 1].min()), int(pixels[:, 0].min()),
                                          int(pixels[:, 1].max()), int(pixels[:, 0].max())]
    stats = {'imageSize': [width, height], 'modelPixelCount': int(mask.sum()),
             'modelPixelFraction': round(float(mask.mean()), 6),
             'visibleWirePixelCount': int(wire.sum()), 'modelPixelBoundsXYXY': bounds}
    return (Image.fromarray(np.uint8(np.clip(overlay, 0, 255))),
            Image.fromarray(np.uint8(np.clip(model_only, 0, 255))), stats)


def run(room_json: Path, photo_dir: Path, build_dir: Path, photo_indices: list[int],
        output: Path, max_width: int = 960, alpha: float = .32) -> dict:
    if not photo_indices or len(set(photo_indices)) != len(photo_indices):
        raise ValueError('provide distinct photo indices')
    if max_width < 128 or max_width > 2048 or not 0 < alpha <= 1:
        raise ValueError('max-width or opacity outside supported range')
    if os.path.lexists(output) or not output.parent.is_dir():
        raise ValueError('output must be a new path under an existing parent')
    room = json.loads(room_json.read_text(encoding='utf-8'))
    occupancy = json.loads((build_dir / 'voxel-occupancy.json').read_text(encoding='utf-8'))
    glb = build_dir / 'reconstructed.glb'
    if (occupancy.get('frame') != 'room-local-m' or
            transform_hash(room['transform']['worldToRoom']) != occupancy['transformHash'] or
            digest(glb) != occupancy['modelGlbSha256']):
        raise ValueError('room transform or GLB differs from voxel occupancy')
    if any(i < 0 or i >= len(room['photos']) for i in photo_indices):
        raise ValueError('photo index outside converted room order')
    scene = trimesh.load(glb, force='scene', process=False)
    if set(scene.graph.nodes_geometry) != {part['glbNodeName'] for part in occupancy['parts']}:
        raise ValueError('named GLB parts differ from voxel plan')
    fill, line = rgb('#44d8c4'), rgb('#fff7db')
    images, stats = [], []
    for index in photo_indices:
        photo_path = photo_dir / f'{index:04d}.jpg'
        with Image.open(photo_path) as image:
            overlay, model_only, details = render_one(scene, occupancy, room['photos'][index],
                                                       image.convert('RGB'), max_width, alpha, fill, line)
        images.extend([(f'photo-{index:04d}-overlay.png', overlay),
                       (f'photo-{index:04d}-model-only.png', model_only)])
        stats.append({'photoIndex': index, 'preparedPhotoSha256': digest(photo_path), **details})
    report = {'schemaVersion': 1, 'scanId': occupancy['scanId'], 'frame': 'room-local-m',
              'planSha256': occupancy['planSha256'], 'modelGlbSha256': occupancy['modelGlbSha256'],
              'transformHash': occupancy['transformHash'], 'sourcePlySha256': occupancy['sourcePlySha256'],
              'roomJsonSha256': digest(room_json), 'opacity': alpha,
              'fillColor': '#44d8c4', 'wireColor': '#fff7db', 'photos': stats,
              'reviewState': 'unreviewed', 'ownerAcceptanceBlocked': True,
              'limitation': 'Photo depth occlusion is not modeled; overlay is visual QA, not instance validation.'}
    output.mkdir()
    for name, image in images:
        image.save(output / name)
    (output / 'render-report.json').write_bytes(builder.canonical_bytes(report))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--room-json', type=Path, required=True)
    parser.add_argument('--photo-dir', type=Path, required=True)
    parser.add_argument('--build-dir', type=Path, required=True)
    parser.add_argument('--photo-index', type=int, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-width', type=int, default=960)
    parser.add_argument('--opacity', type=float, default=.32)
    args = parser.parse_args()
    try:
        result = run(args.room_json, args.photo_dir, args.build_dir, args.photo_index,
                     args.output, args.max_width, args.opacity)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(2, f'voxel-overlay: {exc}\n')
    print(json.dumps({'scanId': result['scanId'], 'photos': result['photos'],
                      'ownerAcceptanceBlocked': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
