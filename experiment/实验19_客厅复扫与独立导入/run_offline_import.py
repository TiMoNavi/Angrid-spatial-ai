#!/usr/bin/env python3
"""Offline HouseCapture ZIP → measured grids → unreviewed instance candidates.

This composes the pinned E15 stages without calling AI or changing source scans.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
E15 = EXPERIMENT / '实验15_扫描识别切分与自动导入'
PRIVATE = EXPERIMENT / '.private'
IMPORTER = E15 / 'importer/import_bundle.py'
CLASSIFIER = E15 / 'classification/prepare_classified.py'
VIEW = E15 / 'view_assets/prepare.py'
INSTANCES = E15 / 'pipeline/instance_candidates.py'
LEDGER_DIR = 'derived-v3-e19-offline'
STATE_NAME = 'e19-offline-import-state.json'
VERSION = 'e19-offline-v1'


class PipelineError(ValueError):
    pass


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError) as exc:
        raise PipelineError(f'missing or invalid JSON: {path}') from exc
    if not isinstance(data, dict):
        raise PipelineError(f'expected JSON object: {path}')
    return data


def write_state(scan: Path, state: dict) -> None:
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=scan,
                                     prefix='.e19-state-', delete=False) as stream:
        json.dump(state, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write(chr(10))
        temp = Path(stream.name)
    os.replace(temp, scan / STATE_NAME)


def execute(command: list[str], label: str) -> None:
    result = subprocess.run(command, cwd=EXPERIMENT.parent, capture_output=True,
                            text=True, timeout=900, check=False)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()[-1200:]
        raise PipelineError(f'{label} failed ({result.returncode}): {detail}')


def asset(scan: Path, manifest: dict, key: str) -> Path:
    relative = manifest.get('assetPaths', {}).get(key)
    if not isinstance(relative, str) or not relative.startswith('source/Room/'):
        raise PipelineError(f'import has no {key}')
    path = (scan / relative).resolve(strict=True)
    if not path.is_relative_to(scan / 'source') or not path.is_file():
        raise PipelineError(f'unsafe or missing {key}')
    return path


def inputs(stage: str, scan: Path, source: Path, roomplan: Path) -> dict:
    files = {'source': source, 'converted': scan / 'converted.json',
             'roomplan': roomplan, 'wrapper': Path(__file__)}
    if stage == 'classification':
        files['code'] = CLASSIFIER
    elif stage == 'view':
        files['code'] = VIEW
    elif stage == 'instances':
        files.update({'code': INSTANCES,
                      'geometry': E15 / 'pipeline/geometry_v1.py',
                      'assignments': scan / 'derived-v1/face-assignments.json',
                      'layerManifest': scan / 'derived-v1/layer-manifest.json',
                      'segmentReport': scan / 'derived-v1/segment-report.json'})
    else:
        raise PipelineError('unknown stage')
    result = {key: sha(path) for key, path in files.items()}
    result['defaultParameters'] = 'e15-defaults-no-clutter-v1'
    return result


def outputs(stage: str, scan: Path) -> dict:
    if stage == 'classification':
        folder = scan / 'derived-v1'
        files = sorted(path for path in folder.rglob('*') if path.is_file()) if folder.is_dir() else []
    elif stage == 'view':
        files = [scan / 'mesh-surface-grids.json', scan / 'mesh-voxels/raw-room.ply']
    elif stage == 'instances':
        files = [scan / LEDGER_DIR / 'instance-ledger.json']
    else:
        raise PipelineError('unknown stage')
    if not files or any(not path.is_file() or path.is_symlink() for path in files):
        raise PipelineError(f'{stage} outputs are incomplete')
    return {str(path.relative_to(scan)): sha(path) for path in files}


def verify_classification(scan: Path, manifest: dict, source: Path, roomplan: Path) -> dict:
    sys.path.insert(0, str(E15 / 'pipeline'))
    from geometry_v1 import transform_hash
    from instance_candidates import validate_v1_assignments
    folder = scan / 'derived-v1'
    layer, report, face = (read(folder / name) for name in
                           ('layer-manifest.json', 'segment-report.json', 'face-assignments.json'))
    transform = transform_hash(read(scan / 'converted.json')['transform']['worldToRoom'])
    if (layer.get('scanId') != scan.name or report.get('scanId') != scan.name or
            layer.get('frame') != 'room-local-m' or
            layer.get('transformHash') != transform or report.get('transformHash') != transform or
            layer.get('reportHash') != sha(folder / 'segment-report.json') or
            report.get('sourceFaces', 0) < 1 or report.get('conservation', {}).get('passes') is not True or
            report['conservation'].get('sum') != report.get('eligibleFaces')):
        raise PipelineError('classification manifest/report identity or conservation mismatch')
    expected = {'converted.json': scan / 'converted.json',
                str(roomplan.relative_to(scan)): roomplan,
                str(source.relative_to(scan)): source}
    observed = {row.get('uri'): row.get('sha256') for row in layer.get('sourceFiles', [])}
    if observed != {name: sha(path) for name, path in expected.items()}:
        raise PipelineError('classification source hashes differ from import')
    buckets = validate_v1_assignments(face, sha(source), report['sourceFaces'])
    if any(len(buckets.get(name, [])) != count for name, count in report['assignments'].items()):
        raise PipelineError('classification assignment counts differ from source-face ledger')
    for row in layer.get('layers', []):
        if row.get('available'):
            name = row.get('geometryUri')
            if not isinstance(name, str) or '/' in name or sha(folder / name) != row.get('sha256'):
                raise PipelineError('classification layer asset hash mismatch')
    if sha(scan / 'converted.json') != manifest['converted']['sha256']:
        raise PipelineError('converted room differs from import')
    return report


def verify_view(scan: Path, source: Path, report: dict) -> None:
    data = read(scan / 'mesh-surface-grids.json')
    ply = data.get('sources', {}).get('ply', {})
    display = scan / 'mesh-voxels/raw-room.ply'
    if (data.get('schemaVersion') != 1 or ply.get('sourcePlySha256') != sha(source) or
            ply.get('sourceFaceCount') != report['sourceFaces'] or
            ply.get('viewTriangles', 0) < 1 or
            ply.get('viewTriangles') != ply.get('inroomSourceFaceCount') or
            not display.is_file() or display.stat().st_size == 0):
        raise PipelineError('display geometry does not match original source')


def verify_instances(scan: Path, source: Path, report: dict) -> dict:
    sys.path.insert(0, str(E15 / 'pipeline'))
    from geometry_v1 import transform_hash
    ledger = read(scan / LEDGER_DIR / 'instance-ledger.json')
    room = read(scan / 'converted.json')
    conservation = ledger.get('conservation', {})
    if (ledger.get('scanId') != scan.name or ledger.get('sourceHash') != sha(source) or
            ledger.get('transformHash') != transform_hash(room['transform']['worldToRoom']) or
            ledger.get('sourceFaceCount') != report['sourceFaces'] or
            conservation.get('passes') is not True or
            conservation.get('originalOwnerAssignmentsPreserved') is not True or
            len(ledger.get('roomPlanInstances', [])) != len(room.get('objects', [])) or
            any(row.get('reviewState') != 'unreviewed' or row.get('ownershipState') != 'unchanged-v1'
                for row in ledger.get('proposals', []))):
        raise PipelineError('instance candidate ledger changed or accepted an owner')
    return ledger


def stage(*, state: dict, scan: Path, name: str, source: Path, roomplan: Path,
          exists: bool, command: list[str], verify, adopt: bool) -> str:
    actual_inputs = inputs(name, scan, source, roomplan)
    previous = state['stages'].get(name)
    if previous is not None:
        if previous.get('inputs') != actual_inputs or previous.get('outputs') != outputs(name, scan):
            raise PipelineError(f'{name} checkpoint differs from current inputs or outputs')
        verify()
        return 'verified'
    if exists and not adopt:
        raise PipelineError(f'{name} already exists without checkpoint; use --adopt-existing to verify it')
    if not exists:
        execute(command, name)
    verify()
    state['stages'][name] = {'inputs': actual_inputs, 'outputs': outputs(name, scan)}
    write_state(scan, state)
    return 'adopted' if exists else 'generated'


def run(zip_file: Path, scan_id: str, room_index: int | None, adopt: bool = False) -> dict:
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', scan_id):
        raise PipelineError('scan-id must be lowercase ASCII letters, digits, hyphens')
    zip_file = zip_file.resolve(strict=True)
    if not zip_file.is_file() or zip_file.suffix.lower() != '.zip':
        raise PipelineError('input must be a HouseCapture ZIP')
    archive_hash = sha(zip_file)
    command = [sys.executable, str(IMPORTER), str(zip_file), '--scan-id', scan_id]
    if room_index is not None:
        command += ['--room-index', str(room_index)]
    # The importer checks every existing extracted member on every resume.
    execute(command, 'safe import')
    scan = (PRIVATE / scan_id).resolve(strict=True)
    if not scan.is_relative_to(PRIVATE.resolve()) or scan == PRIVATE.resolve():
        raise PipelineError('import escaped private storage')
    manifest = read(scan / 'import-manifest.json')
    if (manifest.get('scanId') != scan_id or
            manifest.get('sourceArchive', {}).get('sha256') != archive_hash or
            (room_index is not None and manifest.get('roomIndex') != room_index)):
        raise PipelineError('imported ZIP/room identity mismatch')
    checkpoint = scan / STATE_NAME
    if checkpoint.exists():
        state = read(checkpoint)
        if (state.get('schemaVersion') != 1 or state.get('workflowVersion') != VERSION or
                state.get('scanId') != scan_id or state.get('roomIndex') != manifest['roomIndex'] or
                state.get('archiveSha256') != archive_hash or not isinstance(state.get('stages'), dict)):
            raise PipelineError('checkpoint belongs to different ZIP, scan ID or room')
    else:
        state = {'schemaVersion': 1, 'workflowVersion': VERSION, 'scanId': scan_id,
                 'roomIndex': manifest['roomIndex'], 'archiveSha256': archive_hash, 'stages': {}}
    if manifest.get('converted', {}).get('status') != 'available':
        raise PipelineError('room-local transform unavailable; import succeeded, later stages unavailable')
    source = asset(scan, manifest, 'rawMeshPly')
    roomplan = asset(scan, manifest, 'roomPlanJson')
    converted = scan / 'converted.json'
    folder = scan / 'derived-v1'
    class_action = stage(state=state, scan=scan, name='classification', source=source,
                         roomplan=roomplan, exists=folder.exists(), adopt=adopt,
                         command=[sys.executable, str(CLASSIFIER), '--scan-id', scan_id,
                                  '--source', str(source), '--room', str(converted),
                                  '--roomplan', str(roomplan), '--out', str(folder)],
                         verify=lambda: verify_classification(scan, manifest, source, roomplan))
    report = read(folder / 'segment-report.json')
    view_action = stage(state=state, scan=scan, name='view', source=source,
                        roomplan=roomplan,
                        exists=(scan / 'mesh-surface-grids.json').exists() or
                               (scan / 'mesh-voxels/raw-room.ply').exists(), adopt=adopt,
                        command=[sys.executable, str(VIEW), '--scan-dir', str(scan),
                                 '--source-ply', str(source)],
                        verify=lambda: verify_view(scan, source, report))
    ledger = scan / LEDGER_DIR
    ledger_action = stage(state=state, scan=scan, name='instances', source=source,
                          roomplan=roomplan, exists=ledger.exists(), adopt=adopt,
                          command=[sys.executable, str(INSTANCES), '--scan-dir', str(scan),
                                   '--source', str(source), '--roomplan', str(roomplan),
                                   '--out', str(ledger)],
                          verify=lambda: verify_instances(scan, source, report))
    instances = read(ledger / 'instance-ledger.json')
    result = {'scanId': scan_id, 'roomIndex': manifest['roomIndex'],
              'archiveSha256': archive_hash, 'sourcePlySha256': sha(source),
              'roomPlanObjectCount': manifest['roomPlanObjectCount'],
              'photoCount': manifest['photoIndex']['availableEntries'],
              'depthFrameCount': manifest['depthIndex']['availableEntries'],
              'sourceFaceCount': report['sourceFaces'], 'eligibleFaceCount': report['eligibleFaces'],
              'unknownFaceCount': report['assignments']['unknown'],
              'roomPlanCategories': [row['category'] for row in instances['roomPlanInstances']],
              'unreviewedInstanceProposalCount': len(instances['proposals']),
              'ownerAssignmentsChanged': False, 'aiInvoked': False,
              'editorRoute': f'/editor?scan={scan_id}',
              'stageActions': {'classification': class_action, 'view': view_action,
                               'instances': ledger_action}}
    state['summary'] = result
    write_state(scan, state)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip_file', type=Path)
    parser.add_argument('--scan-id', required=True)
    parser.add_argument('--room-index', type=int)
    parser.add_argument('--adopt-existing', action='store_true',
                        help='validate and checkpoint outputs previously made by E15 commands')
    args = parser.parse_args()
    try:
        result = run(args.zip_file, args.scan_id, args.room_index, args.adopt_existing)
    except (PipelineError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        parser.exit(2, f'offline import failed: {exc}' + chr(10))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
