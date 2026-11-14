"""Publish copied E4 depth points and the bundled reference TSDF as E22 evidence.

Jobs build into temporary directories and never replace E22's verified raw
display mesh or surface-grid cache. Only identity-bound outputs are published.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent.parent
E4 = HERE / 'legacy_e4'
DEPTH_DIR = 'depth-evidence'
FUSION_DIR = 'reference-depth'
IDENTITY = 'asset-identity.json'


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read(path: Path) -> dict:
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'expected JSON object: {path}')
    return value


def e4_module(name: str):
    spec = importlib.util.spec_from_file_location('e22_' + name, E4 / (name + '.py'))
    if spec is None or spec.loader is None:
        raise ValueError('E4 evidence module unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ply_count(path: Path, element: str) -> int:
    with path.open('rb') as stream:
        if stream.readline().strip() != b'ply':
            raise ValueError('derived evidence is not PLY')
        count = None
        for _ in range(200):
            line = stream.readline()
            if not line or len(line) > 4096:
                raise ValueError('invalid PLY header')
            words = line.decode('ascii').split()
            if words[:2] == ['element', element] and len(words) == 3:
                count = int(words[2])
            if words == ['end_header']:
                break
        else:
            raise ValueError('PLY header is too long')
    if count is None or count < 1:
        raise ValueError('derived evidence has no ' + element)
    return count


def expected(scan: Path, imported: dict) -> dict:
    sys.path.insert(0, str(HERE))
    from geometry_v1 import transform_hash
    converted = scan / 'converted.json'
    room = read(converted)
    source = (scan / imported['assetPaths']['rawMeshPly']).resolve(strict=True)
    if not source.is_relative_to((scan / 'source').resolve()) or not source.is_file():
        raise ValueError('derived evidence source PLY escapes scan')
    return {'schemaVersion': 1, 'scanId': scan.name, 'frame': 'room-local-m',
            'units': 'm', 'transformHash': transform_hash(room['transform']['worldToRoom']),
            'convertedSha256': sha(converted),
            'archiveSha256': imported['sourceArchive']['sha256'],
            'sourcePlySha256': sha(source),
            'depthFrames': imported['depthIndex']['availableEntries']}


def verified_asset(scan: Path, imported: dict, kind: str) -> dict | None:
    """Return a hash-checked room-local publication, never a bare legacy file."""
    if kind not in ('depth', 'fusion'):
        raise ValueError('unknown derived evidence kind')
    folder = scan / (DEPTH_DIR if kind == 'depth' else FUSION_DIR)
    identity_path = folder / IDENTITY
    if not identity_path.is_file():
        return None
    if folder.is_symlink() or identity_path.is_symlink() or not folder.resolve().is_relative_to(scan.resolve()):
        raise ValueError('derived evidence path escaped scan')
    identity = read(identity_path)
    base = expected(scan, imported)
    if any(identity.get(key) != value for key, value in base.items()) or identity.get('kind') != kind:
        raise ValueError('derived evidence source or coordinate identity mismatch')
    uri = identity.get('geometryUri')
    expected_uri = (DEPTH_DIR + '/full-depth-surface-025.ply' if kind == 'depth'
                    else FUSION_DIR + '/scan_room.ply')
    if uri != expected_uri:
        raise ValueError('derived evidence geometry URI mismatch')
    path = scan / uri
    if path.is_symlink() or not path.is_file() or sha(path) != identity.get('geometrySha256'):
        raise ValueError('derived evidence geometry hash mismatch')
    vertices = ply_count(path, 'vertex')
    if kind == 'depth':
        report = folder / 'full-depth-surface-report.json'
        if report.is_symlink() or not report.is_file() or sha(report) != identity.get('reportSha256'):
            raise ValueError('depth report hash mismatch')
        data = read(report)
        if (data.get('scanId') != scan.name or data.get('depthFramesProcessed') != base['depthFrames'] or
                data.get('surfaceCells') != vertices or data.get('baseVoxelStepM') != 0.025):
            raise ValueError('depth report does not match projected point PLY')
        count = vertices
    else:
        faces = ply_count(path, 'face')
        glb = folder / 'scan_room.glb'
        config = folder / 'run-config.json'
        if (glb.is_symlink() or not glb.is_file() or glb.stat().st_size < 20 or
                sha(glb) != identity.get('glbSha256') or
                config.is_symlink() or not config.is_file() or sha(config) != identity.get('configSha256')):
            raise ValueError('TSDF GLB or run config hash mismatch')
        run_config = read(config)
        bundled_tsdf = HERE.parent / 'skill-baseline/scan-to-threejs/scripts/reconstruct_bundle.py'
        if (identity.get('vertices') != vertices or identity.get('faces') != faces or
                run_config.get('outputCoordinates') != 'room-local-m' or
                run_config.get('sourceScriptSha256') != sha(bundled_tsdf)):
            raise ValueError('TSDF report does not match room-local mesh')
        count = faces
    return {'geometryUri': uri, 'sha256': identity['geometrySha256'],
            'recordCount': count, 'identityUri': str(identity_path.relative_to(scan)),
            'identitySha256': sha(identity_path)}


def generate_depth(scan: Path, archive: Path, imported: dict) -> None:
    target = scan / DEPTH_DIR
    if target.exists():
        raise ValueError('depth evidence already exists; verify or inspect before rerun')
    with tempfile.TemporaryDirectory(dir=scan, prefix='.e22-depth-') as temporary:
        workspace = Path(temporary)
        staged = workspace / scan.name
        staged.mkdir()
        shutil.copyfile(scan / 'converted.json', staged / 'converted.json')
        upstream = e4_module('prepare_voxel_evidence')
        upstream.PRIVATE = workspace
        upstream.prepare(scan.name, archive)
        report = read(staged / 'full-depth-surface-report.json')
        points = staged / 'full-depth-surface-025.ply'
        if report.get('surfaceCells') != ply_count(points, 'vertex'):
            raise ValueError('E4 depth points do not match their report')
        identity = {**expected(scan, imported), 'kind': 'depth',
                    'geometryUri': DEPTH_DIR + '/full-depth-surface-025.ply',
                    'geometrySha256': sha(points),
                    'reportSha256': sha(staged / 'full-depth-surface-report.json')}
        (staged / IDENTITY).write_text(json.dumps(identity, sort_keys=True) + '\n', encoding='utf-8')
        os.rename(staged, target)
    verified_asset(scan, imported, 'depth')


def generate_fusion(scan: Path, archive: Path, imported: dict) -> None:
    target = scan / FUSION_DIR
    if target.exists():
        raise ValueError('TSDF evidence already exists; verify or inspect before rerun')
    upstream = e4_module('prepare_reference')
    script = HERE.parent / 'skill-baseline/scan-to-threejs/scripts/reconstruct_bundle.py'
    if not script.is_file():
        raise ValueError('unchanged reference TSDF script unavailable')
    with tempfile.TemporaryDirectory(dir=scan, prefix='.e22-fusion-') as temporary:
        workspace = Path(temporary)
        bundle = workspace / 'bundle' / 'Room'
        frame_count, photo_count, _ = upstream.extract_inputs(archive, bundle)
        if frame_count != imported['depthIndex']['availableEntries'] or photo_count != imported['photoIndex']['availableEntries']:
            raise ValueError('TSDF source frames differ from import manifest')
        staged = workspace / FUSION_DIR
        staged.mkdir()
        command = [sys.executable, '-B', '-u', str(script), str(bundle), '--room',
                   str(scan / 'converted.json'), '--voxel', '0.02', '--max-depth', '3.5',
                   '--min-confidence', '1', '-o', str(staged)]
        with (staged / 'reconstruction.log').open('w', encoding='utf-8') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=840)
        mesh = staged / 'scan_room.ply'
        glb = staged / 'scan_room.glb'
        vertices, faces = ply_count(mesh, 'vertex'), ply_count(mesh, 'face')
        if not glb.is_file() or glb.stat().st_size < 20:
            raise ValueError('reference TSDF has no room-local GLB')
        config = {'sourceScript': str(script.relative_to(EXPERIMENT.parent)),
                  'sourceScriptSha256': sha(script), 'depthFrames': frame_count,
                  'photos': photo_count, 'voxelM': 0.02, 'maxDepthM': 3.5,
                  'minConfidence': 1, 'outputCoordinates': 'room-local-m'}
        (staged / 'run-config.json').write_text(json.dumps(config, sort_keys=True) + '\n', encoding='utf-8')
        identity = {**expected(scan, imported), 'kind': 'fusion',
                    'geometryUri': FUSION_DIR + '/scan_room.ply',
                    'geometrySha256': sha(mesh), 'glbSha256': sha(glb),
                    'configSha256': sha(staged / 'run-config.json'),
                    'vertices': vertices, 'faces': faces}
        (staged / IDENTITY).write_text(json.dumps(identity, sort_keys=True) + '\n', encoding='utf-8')
        os.rename(staged, target)
    verified_asset(scan, imported, 'fusion')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=('depth', 'fusion'))
    parser.add_argument('--scan-dir', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    args = parser.parse_args()
    scan, archive = args.scan_dir.resolve(strict=True), args.archive.resolve(strict=True)
    imported = read(scan / 'import-manifest.json')
    if imported.get('scanId') != scan.name or imported['sourceArchive']['sha256'] != sha(archive):
        raise ValueError('derived evidence ZIP does not match imported scan')
    if args.kind == 'depth':
        generate_depth(scan, archive, imported)
    else:
        generate_fusion(scan, archive, imported)


if __name__ == '__main__':
    main()
