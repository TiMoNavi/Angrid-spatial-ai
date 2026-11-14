#!/usr/bin/env python3
"""HouseCapture ZIP → independently reusable scan/model layers.

scan-evidence is offline. model-voxel additionally consumes a reviewed-input
voxel plan made by an AI or person; this runner never sends private scans to AI.
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
PRIVATE = EXPERIMENT / '.private'
IMPORTER = HERE / 'importer/import_bundle.py'
CLASSIFIER = HERE / 'classification/prepare_classified.py'
VIEW = HERE / 'view_assets/prepare.py'
INSTANCES = HERE / 'pipeline/instance_candidates.py'
BUILDER = HERE / 'voxel/voxel_plan_builder.py'
BINDER = HERE / 'voxel/bind_voxel_evidence.py'
LEDGER_DIR = 'derived-v3-e22-offline'
MODEL_DIR = 'model-voxel'
EVIDENCE_DIR = 'model-evidence'
STATE_NAME = 'e22-pipeline-state.json'
VERSION = 'e22-layers-v1'


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
                                     prefix='.e22-state-', delete=False) as stream:
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
                      'geometry': HERE / 'pipeline/geometry_v1.py',
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
    elif stage == 'model':
        files = [scan / MODEL_DIR / name for name in
                 ('reconstructed.glb', 'voxel-plan.json', 'voxel-occupancy.json', 'build-report.json')]
        files += [scan / EVIDENCE_DIR / name for name in
                  ('evidence-ledger.json', 'evidence-report.json')]
    else:
        raise PipelineError('unknown stage')
    if not files or any(not path.is_file() or path.is_symlink() or
                        not path.resolve().is_relative_to(scan.resolve()) for path in files):
        raise PipelineError(f'{stage} outputs are incomplete')
    return {str(path.relative_to(scan)): sha(path) for path in files}


def verify_classification(scan: Path, manifest: dict, source: Path, roomplan: Path) -> dict:
    sys.path.insert(0, str(HERE / 'pipeline'))
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
    sys.path.insert(0, str(HERE / 'pipeline'))
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


def validate_plan_identity(plan_path: Path, scan: Path, source: Path) -> dict:
    sys.path.insert(0, str(HERE / 'voxel'))
    sys.path.insert(0, str(HERE / 'pipeline'))
    from voxel_plan_builder import validate_plan
    from geometry_v1 import transform_hash
    plan, _ = validate_plan(read(plan_path))
    room = read(scan / 'converted.json')
    grid = read(scan / 'derived-v1/furniture-grid.json')['grids'].get(format(plan['grid']['stepM'], 'g'))
    if (plan['scanId'] != scan.name or plan['sourcePlySha256'] != sha(source) or
            plan['transformHash'] != transform_hash(room['transform']['worldToRoom'])):
        raise PipelineError('voxel plan belongs to a different scan, source PLY or transform')
    if (not grid or grid.get('stepM') != plan['grid']['stepM'] or
            grid.get('originM') != plan['grid']['originM'] or grid.get('cellEncoding') != 'index-xyz'):
        raise PipelineError('voxel plan grid differs from an available editor grid')
    if any(row['photoIndex'] >= len(room.get('photos', [])) for instance in plan['instances']
           for part in instance['parts'] for row in part['photoEvidence']):
        raise PipelineError('voxel plan photo evidence is not in this scan')
    return plan


def verify_model(plan_path: Path, scan: Path, source: Path) -> dict:
    validate_plan_identity(plan_path, scan, source)
    sys.path.insert(0, str(HERE / 'voxel'))
    from bind_voxel_evidence import verify_build
    model = scan / MODEL_DIR
    if sha(plan_path) != sha(model / 'voxel-plan.json'):
        raise PipelineError('model input plan changed')
    occupancy = verify_build(model / 'voxel-plan.json', model)
    ledger = read(scan / EVIDENCE_DIR / 'evidence-ledger.json')
    report = read(scan / EVIDENCE_DIR / 'evidence-report.json')
    expected = {'sourcePlySha256': sha(source),
                'faceAssignmentsSha256': sha(scan / 'derived-v1/face-assignments.json'),
                'segmentReportSha256': sha(scan / 'derived-v1/segment-report.json'),
                'planFileSha256': sha(plan_path),
                'occupancySha256': sha(model / 'voxel-occupancy.json')}
    if (ledger.get('scanId') != scan.name or ledger.get('inputs') != expected or
            ledger.get('transformHash') != occupancy['transformHash'] or
            ledger.get('modelGlbSha256') != sha(model / 'reconstructed.glb') or
            ledger.get('planSha256') != occupancy['planSha256'] or
            ledger.get('identityValidation') != 'verified-source-and-transform' or
            ledger.get('ownerAcceptanceBlocked') is not True or
            ledger.get('legacyOwnership') != 'unchanged' or
            ledger.get('reviewState') != 'unreviewed' or
            len(ledger.get('cells', [])) != len(occupancy['cells']) or
            report != {key: value for key, value in ledger.items() if key != 'cells'}):
        raise PipelineError('model evidence identity or immutable source assignment check failed')
    return report


def model_stage(state: dict, scan: Path, source: Path, roomplan: Path, plan_path: Path,
                adopt: bool) -> tuple[str, dict]:
    validate_plan_identity(plan_path, scan, source)
    current = {**inputs('instances', scan, source, roomplan),
               'plan': sha(plan_path), 'builder': sha(BUILDER), 'binder': sha(BINDER)}
    previous = state['stages'].get('model')
    if previous is not None:
        if previous.get('inputs') != current or previous.get('outputs') != outputs('model', scan):
            raise PipelineError('model checkpoint differs from current inputs or outputs')
        return 'verified', verify_model(plan_path, scan, source)
    exists = (scan / MODEL_DIR).exists() or (scan / EVIDENCE_DIR).exists()
    if exists and not adopt:
        raise PipelineError('model outputs exist without checkpoint; use --adopt-existing after inspection')
    if not exists:
        execute([sys.executable, str(BUILDER), str(plan_path), '--output', str(scan / MODEL_DIR)], 'model build')
        (scan / MODEL_DIR / 'voxel-plan.json').write_bytes(plan_path.read_bytes())
        execute([sys.executable, str(BINDER), '--scan-dir', str(scan), '--plan', str(plan_path),
                 '--build-dir', str(scan / MODEL_DIR), '--output', str(scan / EVIDENCE_DIR)], 'model binding')
    report = verify_model(plan_path, scan, source)
    if current['plan'] != sha(plan_path):
        raise PipelineError('voxel plan changed during model generation')
    state['stages']['model'] = {'inputs': current, 'outputs': outputs('model', scan)}
    write_state(scan, state)
    return ('adopted' if exists else 'generated'), report


def ai_job_stage(state: dict, scan: Path, source: Path, adopt: bool) -> tuple[str, dict]:
    from ai_handoff import prepare_ai_job
    sys.path.insert(0, str(HERE / 'pipeline'))
    from geometry_v1 import transform_hash
    skill = HERE / 'skill/room-scan-rebuild'
    destination = scan / 'ai-job'
    if destination.is_symlink():
        raise PipelineError('AI job destination must not be symlinked')
    current = {'sourcePlySha256': sha(source), 'convertedHash': sha(scan / 'converted.json'),
               'handoff': sha(HERE / 'ai_handoff.py'),
               'skill': {str(path.relative_to(skill)): sha(path)
                         for path in sorted(skill.rglob('*')) if path.is_file() and '__pycache__' not in path.parts},
               'baseline': {str(path.relative_to(HERE / 'skill-baseline')): sha(path)
                            for path in sorted((HERE / 'skill-baseline').rglob('*'))
                            if path.is_file() and '__pycache__' not in path.parts}}
    previous = state['stages'].get('ai-job')

    def hashes():
        files = sorted(path for path in destination.rglob('*') if path.is_file())
        if not files or any(path.is_symlink() for path in files):
            raise PipelineError('AI job outputs are incomplete or symlinked')
        return {str(path.relative_to(scan)): sha(path) for path in files}

    if previous is not None:
        packaged = previous.get('outputs')
        if (previous.get('inputs') != current or not isinstance(packaged, dict) or not packaged or
                any(not (scan / uri).is_file() or (scan / uri).is_symlink() or
                    not (scan / uri).resolve().is_relative_to(destination.resolve()) or
                    sha(scan / uri) != expected for uri, expected in packaged.items())):
            raise PipelineError('AI job checkpoint differs from current inputs or outputs')
        action = 'verified'
    elif destination.exists():
        if not adopt:
            raise PipelineError('AI job exists without checkpoint; use --adopt-existing after inspection')
        action = 'adopted'
    else:
        prepare_ai_job(scan, destination, skill)
        action = 'generated'
    job = read(destination / 'ai-job.json')
    expected_transform = transform_hash(read(scan / 'converted.json')['transform']['worldToRoom'])
    if (job.get('scanId') != scan.name or job.get('sourcePlySha256') != sha(source) or
            job.get('transformHash') != expected_transform or job.get('status') != 'awaiting-ai-plan' or
            job.get('aiInvoked') is not False):
        raise PipelineError('AI handoff belongs to a different scan or has invalid status')
    if previous is None:
        state['stages']['ai-job'] = {'inputs': current, 'outputs': hashes()}
        write_state(scan, state)
    return action, job


def existing_model_plan(scan: Path, state: dict) -> Path | None:
    """Resume a built model, but never advertise an uncheckpointed partial model."""
    if ('model' not in state['stages'] and not (scan / MODEL_DIR).exists() and
            not (scan / EVIDENCE_DIR).exists()):
        return None
    snapshot = scan / MODEL_DIR / 'voxel-plan.json'
    if (not snapshot.is_file() or snapshot.is_symlink() or
            not snapshot.resolve().is_relative_to(scan.resolve())):
        raise PipelineError('model output is partial or unsafe; provide its original --voxel-plan for verification')
    return snapshot


def run(zip_file: Path, scan_id: str, room_index: int | None, adopt: bool = False,
        mode: str = 'scan-evidence', voxel_plan: Path | None = None) -> dict:
    if mode not in ('scan-evidence', 'model-voxel'):
        raise PipelineError('mode must be scan-evidence or model-voxel')
    if mode == 'scan-evidence' and voxel_plan is not None:
        raise PipelineError('--voxel-plan requires --mode model-voxel')
    if voxel_plan is not None:
        voxel_plan = voxel_plan.resolve(strict=True)
        if not voxel_plan.is_file() or voxel_plan.stat().st_size > 20_000_000:
            raise PipelineError('voxel plan must be a JSON file within the 20 MB limit')
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
    model_action = None
    model_report = None
    job_action = None
    job = None
    if mode == 'model-voxel' and voxel_plan is None:
        voxel_plan = existing_model_plan(scan, state)
    if mode == 'model-voxel' and voxel_plan is not None:
        model_action, model_report = model_stage(state, scan, source, roomplan, voxel_plan, adopt)
    elif mode == 'model-voxel':
        job_action, job = ai_job_stage(state, scan, source, adopt)
    sys.path.insert(0, str(HERE / 'pipeline'))
    from package_layers import package, verify_manifest
    layer_path = package(scan, mode, LEDGER_DIR, MODEL_DIR, EVIDENCE_DIR)
    layer_manifest = verify_manifest(scan, layer_path)
    result = {'mode': mode, 'status': 'awaiting-ai-plan' if job is not None else 'completed',
              'scanId': scan_id, 'roomIndex': manifest['roomIndex'],
              'archiveSha256': archive_hash, 'sourcePlySha256': sha(source),
              'roomPlanObjectCount': manifest['roomPlanObjectCount'],
              'photoCount': manifest['photoIndex']['availableEntries'],
              'depthFrameCount': manifest['depthIndex']['availableEntries'],
              'sourceFaceCount': report['sourceFaces'], 'eligibleFaceCount': report['eligibleFaces'],
              'unknownFaceCount': report['assignments']['unknown'],
              'roomPlanCategories': [row['category'] for row in instances['roomPlanInstances']],
              'unreviewedInstanceProposalCount': len(instances['proposals']),
              'ownerAssignmentsChanged': False, 'aiInvoked': False,
              'scanDirectory': str(scan), 'layerManifest': str(layer_path),
              'availableRenderableLayerCount': sum(row['available'] and row['renderable'] for row in layer_manifest['layers']),
              'availableDataLayerCount': sum(row['available'] and not row['renderable'] for row in layer_manifest['layers']),
              'stageActions': {'classification': class_action, 'view': view_action,
                               'instances': ledger_action}}
    if model_action is not None:
        result['stageActions']['model'] = model_action
        result['model'] = {key: model_report[key] for key in
                           ('cellStates', 'identityValidation', 'ownerAcceptanceBlocked', 'legacyOwnership')}
    if job is not None:
        result['stageActions']['ai-job'] = job_action
        result['aiWorkPackage'] = {'jobDir': str(scan / 'ai-job'),
                                   'preferredPlanPath': job['preferredPlanPath']}
    state['summary'] = result
    write_state(scan, state)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip_file', type=Path)
    parser.add_argument('--scan-id', required=True)
    parser.add_argument('--room-index', type=int)
    parser.add_argument('--mode', choices=('scan-evidence', 'model-voxel'), default='scan-evidence')
    parser.add_argument('--voxel-plan', type=Path,
                        help='AI/person-authored integer plan; omitted in model mode to prepare an AI work package')
    parser.add_argument('--adopt-existing', action='store_true',
                        help='validate and checkpoint outputs previously made by E15 commands')
    args = parser.parse_args()
    try:
        result = run(args.zip_file, args.scan_id, args.room_index, args.adopt_existing,
                     args.mode, args.voxel_plan)
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        parser.exit(2, f'offline import failed: {exc}' + chr(10))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
