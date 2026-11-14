"""Publish a renderer-neutral, hash-verified manifest for one imported scan.

Display PLY face ordinals are never source-face IDs. All source evidence keeps
the original immutable PLY URI/hash and its capture-session coordinate frame.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read(path: Path) -> dict:
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'expected object: {path.name}')
    return value


def write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':'), allow_nan=False) + '\n').encode()
    if path.is_file() and not path.is_symlink() and path.read_bytes() == payload:
        return
    if path.is_symlink():
        raise ValueError('refusing to publish through a symlink')
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.layers-', delete=False) as stream:
        stream.write(payload)
        temporary = Path(stream.name)
    os.replace(temporary, path)


def local_file(scan: Path, relative: str) -> Path:
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError('asset URI must be relative')
    path = (scan / relative).resolve(strict=True)
    if not path.is_relative_to(scan) or not path.is_file() or (scan / relative).is_symlink():
        raise ValueError('asset URI escaped the scan or is not a file')
    return path


def package(scan: Path, mode: str, ledger_dir: str, model_dir: str, evidence_dir: str) -> Path:
    scan = scan.resolve(strict=True)
    if mode not in ('scan-evidence', 'model-voxel'):
        raise ValueError('unknown package mode')
    imported = read(scan / 'import-manifest.json')
    room = read(scan / 'converted.json')
    classified = read(scan / 'derived-v1/layer-manifest.json')
    report = read(scan / 'derived-v1/segment-report.json')
    transform = classified['transformHash']
    source_uri = imported['assetPaths']['rawMeshPly']
    source_hash = sha(local_file(scan, source_uri))
    common = {'schemaVersion': 1, 'scanId': scan.name, 'units': 'm',
              'frame': 'room-local-m', 'transformHash': transform}
    shared = {**common, 'sourcePlySha256': source_hash}
    refs = {'sourceGeometryUri': source_uri, 'sourcePlySha256': source_hash,
            'sourceGeometryFrame': imported['sourceMeshFrame'],
            'sourceFaceIdSpace': 'original-source-ply-face-order',
            'displayFaceOrdinalsAreSourceFaceIds': False}
    layers = []

    def add(identifier, label, kind, provenance, uri=None, *, group='scan', renderable=True,
            available=True, reason=None, visible=False, opacity=.1, color='#7dd3fc',
            order=50, wireframe=False, **extra):
        path = local_file(scan, uri) if available and uri else None
        if available and path is None:
            raise ValueError(f'available layer {identifier} needs an asset')
        row = {'id': identifier, 'label': label, 'kind': kind, 'group': group,
               'provenance': provenance, 'available': available, 'renderable': renderable,
               'reason': reason or ('Asset generated and verified.' if available else 'Not generated.'),
               'geometryUri': uri if available and renderable else None,
               'dataUri': uri if available and not renderable else None,
               'sha256': sha(path) if path else None, 'units': 'm', 'frame': 'room-local-m',
               'transformHash': transform, 'renderOrder': order,
               'visual': {'visible': visible and available, 'opacity': opacity, 'color': color,
                          'wireframe': wireframe, 'depthTest': True, 'depthWrite': opacity >= 1,
                          'transparent': opacity < 1, 'polygonOffset': True}, **extra}
        layers.append(row)
        return row

    write(scan / 'layers/roomplan-structure.json', {**shared, 'kind': 'roomplan-structure',
          'polygon': room['polygon'], 'walls': room['walls'],
          'meaning': 'RoomPlan structure reference; not a TSDF or observed full wall mesh.'})
    objects = [{key: value for key, value in row.items()
                if key in ('objectId', 'sourceIdentifier', 'convertedIndex', 'category',
                           'mappingState', 'roomPlanObb')} for row in report['objects']]
    write(scan / 'layers/furniture-boxes.json', {**shared, 'kind': 'roomplan-furniture-obb',
          'objects': objects, 'meaning': 'RoomPlan hypotheses; box overlaps remain ambiguous.'})
    slices, aabbs = [], []
    for obj in report['objects']:
        if obj.get('meshUri') and obj.get('faceCount', 0):
            mesh_uri = 'derived-v1/' + obj['meshUri']
            path = local_file(scan, mesh_uri)
            slices.append({'objectId': obj['objectId'], 'category': obj['category'],
                           'geometryUri': mesh_uri, 'sha256': sha(path),
                           'sourceFaceIds': obj['sourceFaceIds'], 'faceCount': obj['faceCount']})
        if obj.get('aabb'):
            aabbs.append({'objectId': obj['objectId'], 'category': obj['category'], 'aabb': obj['aabb']})
    write(scan / 'layers/furniture-slices.json', {**shared, **refs,
          'kind': 'observed-furniture-mesh-collection', 'meshes': slices,
          'meaning': 'Incomplete observed source surfaces; not reconstructed closed furniture.'})
    write(scan / 'layers/furniture-aabb.json', {**shared, 'kind': 'observed-slice-aabb',
          'objects': aabbs, 'meaning': 'Bounds of retained observed fragments; not true full object bounds.'})

    add('raw-lidar-ply', '原始 LiDAR PLY（房间局部显示）', 'triangle-mesh', 'measured',
        'mesh-voxels/raw-room.ply', visible=True, opacity=.25, color='#b9c7d1', order=20, **refs)
    add('roomplan-structure', 'RoomPlan 房间结构', 'roomplan-structure', 'roomplan-inferred',
        'layers/roomplan-structure.json', group='structure', opacity=.5, wireframe=True,
        color='#7dd3fc', order=80)
    add('furniture-obb', 'RoomPlan 家具 OBB', 'oriented-boxes', 'roomplan-inferred',
        'layers/furniture-boxes.json', group='furniture', opacity=.5, wireframe=True,
        color='#facc82', order=82, available=bool(objects),
        reason='RoomPlan furniture boxes retained.' if objects else 'No valid RoomPlan furniture objects.')
    add('scan-surface-grid', '原始 PLY 表面体素', 'packed-surface-grid', 'measured',
        'mesh-surface-grids.json', color='#a3bbd5', order=50,
        gridSelector='sources.ply.grids', meaning='Surface cells only, not solid furniture.', **refs)
    labels = {'clean-structure-grid': ('平整结构体素', 'structure', '#61d5e7', True),
              'furniture-classified-grid': ('大件平整家具表面体素', 'furniture', '#e5ba77', True),
              'furniture-corrected-grid': ('家具几何修正体素（平面规则）', 'furniture', '#b0d99c', True),
              'conflict-grid': ('物体归属冲突体素', 'review', '#ff8a9d', False),
              'unknown-grid': ('未归属观察体素', 'review', '#beacf4', False),
              'clutter-candidate-grid': ('杂物候选体素（可选计算）', 'review', '#f1aa75', False)}
    for item in classified['layers']:
        label, group, color, visible = labels[item['id']]
        add(item['id'], label, item['kind'], item['provenance'],
            'derived-v1/' + item['geometryUri'] if item['available'] else None,
            available=item['available'], reason=item.get('warning'), group=group, visible=visible,
            color=color, recordCount=item.get('recordCount', 0), order=60)
    add('furniture-slices', '家具扫描切片', 'mesh-collection', 'measured',
        'layers/furniture-slices.json', group='furniture', color='#e5ba77', opacity=.65,
        order=30, meshCount=len(slices), available=bool(slices),
        reason='Observed source mesh slices retained.' if slices else 'No valid observed furniture slices.', **refs)
    add('furniture-aabb', '切片观察范围 AABB', 'axis-aligned-boxes', 'measured-bounds',
        'layers/furniture-aabb.json', group='furniture', color='#94e6af', opacity=.6,
        order=85, wireframe=True, available=bool(aabbs),
        reason='Bounds of observed slices retained.' if aabbs else 'No valid observed slice bounds.',
        meaning='Observed bounds; never treated as complete object bounds.')
    add('depth-projected-points', '深度投影点', 'point-cloud', 'measured', available=False,
        reason='Depth frame evidence is retained, but no calibrated point-display asset has been generated.', order=25)
    add('tsdf-fused-mesh', 'TSDF 融合网格', 'triangle-mesh', 'depth-fused', available=False,
        reason='No TSDF fusion ran in this workflow; depth frames do not constitute a TSDF mesh.',
        visible=True, opacity=1, order=10)
    add('gaussian-splat', '高斯泼溅', 'gaussian-splat', 'photo-reconstructed', available=False,
        reason='No Gaussian-splat reconstruction was generated or imported.', order=15)
    add('photo-evidence', '带机位照片索引', 'photo-index', 'measured',
        imported['assetPaths']['photoIndex'], renderable=False,
        available=bool(imported['photoIndex']['availableEntries']), opacity=1,
        recordCount=imported['photoIndex']['availableEntries'], assetFrame='capture-session-world-m')
    add('depth-evidence', '原始深度帧索引', 'depth-index', 'measured',
        imported['assetPaths']['depthIndex'], renderable=False,
        available=bool(imported['depthIndex']['availableEntries']), opacity=1,
        recordCount=imported['depthIndex']['availableEntries'], assetFrame='capture-session-world-m')
    add('instance-candidates', '待复核实例候选账本', 'instance-ledger', 'geometry-proposal',
        ledger_dir + '/instance-ledger.json', group='review', renderable=False,
        reviewState='unreviewed', ownerAcceptanceBlocked=True, **refs)
    add('source-face-partition', '原始源面归属账本', 'source-face-ledger', 'measured-assignment',
        'derived-v1/face-assignments.json', group='review', renderable=False, **refs)
    model_available = mode == 'model-voxel' and all((scan / name).is_file() for name in
          (model_dir + '/build-report.json', evidence_dir + '/evidence-report.json'))
    if model_available:
        build = read(scan / model_dir / 'build-report.json')
        evidence = read(scan / evidence_dir / 'evidence-report.json')
        if (build.get('scanId') != scan.name or evidence.get('scanId') != scan.name or
                build.get('transformHash') != transform or evidence.get('transformHash') != transform or
                build.get('sourcePlySha256') != source_hash or evidence.get('sourcePlySha256') != source_hash or
                evidence.get('identityValidation') != 'verified-source-and-transform' or
                evidence.get('ownerAcceptanceBlocked') is not True):
            raise ValueError('model layers have unverified or mismatched scan identity')
        model_meta = {'planSha256': build['planSha256'], 'modelGlbSha256': build['modelGlbSha256'],
                      'reviewState': 'unreviewed', 'ownerAcceptanceBlocked': True,
                      'legacyOwnership': 'unchanged', 'sourcePlySha256': source_hash,
                      'identityValidation': evidence['identityValidation']}
        add('reconstructed-model', 'AI 重建命名实体 GLB', 'named-glb', 'model-inferred',
            model_dir + '/reconstructed.glb', group='model', opacity=.55, color='#96d9ce',
            order=35, nodeNaming='instanceId::partId', **model_meta)
        add('model-voxel-grid', 'AI 家具脑补修正体素', 'instance-voxel-grid', 'model-inferred',
            model_dir + '/voxel-occupancy.json', group='model', opacity=.1, color='#8addc7',
            visible=True, order=65, instancesInSingleLayer=True, grid=build['grid'],
            cellCount=build['uniqueCellCount'], **model_meta)
        add('model-evidence-overlay', '模型与扫描证据回绑', 'voxel-evidence-overlay', 'comparison',
            evidence_dir + '/evidence-ledger.json', group='review', opacity=.4, color='#ffa7c1',
            order=75, cellStates=evidence['cellStates'], **model_meta)
    elif mode == 'model-voxel':
        for identifier, label, kind in (
                ('reconstructed-model', 'AI 重建命名实体 GLB', 'named-glb'),
                ('model-voxel-grid', 'AI 家具脑补修正体素', 'instance-voxel-grid'),
                ('model-evidence-overlay', '模型与扫描证据回绑', 'voxel-evidence-overlay')):
            add(identifier, label, kind, 'model-inferred', group='model', available=False,
                reason='Awaiting a scan-bound AI/person-authored voxel-plan; no modeled asset has been generated.',
                reviewState='unreviewed', ownerAcceptanceBlocked=True)
    manifest = {**shared, 'kind': 'dual-mode-scan-assets', 'workflowVersion': 'e22-layers-v1',
                'mode': mode, 'status': 'awaiting-ai-plan' if mode == 'model-voxel' and not model_available else 'completed',
                'roomIndex': imported['roomIndex'],
                'sourceArchiveSha256': imported['sourceArchive']['sha256'],
                'convertedHash': sha(scan / 'converted.json'),
                'sourceGeometryUri': source_uri, 'sourceGeometryFrame': imported['sourceMeshFrame'],
                'sourceFaceCount': report['sourceFaces'], 'worldToRoom': room['transform']['worldToRoom'],
                'grid': {'stepsM': [.2, .1, .05, .025], 'originM': [0, 0, 0],
                         'axisConvention': '+Y up', 'modelCellEncoding': 'index-xyz'},
                'coordinatePolicy': 'Apply worldToRoom exactly once to capture-session assets. Room-local assets are ready to render.',
                'defaultFallback': 'raw-lidar-ply', 'layers': layers,
                'viewPresets': {
                    'scan-evidence': {'label': '扫描证据模式', 'coreLayerIds': [
                        'raw-lidar-ply', 'roomplan-structure', 'furniture-obb', 'scan-surface-grid',
                        'furniture-classified-grid', 'conflict-grid', 'unknown-grid',
                        'furniture-slices', 'furniture-aabb'],
                        'optionalLayerIds': ['clean-structure-grid', 'furniture-corrected-grid',
                                             'clutter-candidate-grid', 'depth-projected-points',
                                             'tsdf-fused-mesh', 'gaussian-splat']},
                    'model-voxel': {'label': '语义模型与体素模式', 'groups': [
                        {'id': 'structure', 'layerIds': ['clean-structure-grid']},
                        {'id': 'planar-correction', 'layerIds': ['furniture-corrected-grid']},
                        {'id': 'entity-model', 'layerIds': ['reconstructed-model']},
                        {'id': 'native-voxel', 'layerIds': ['model-voxel-grid']},
                        {'id': 'evidence-overlay', 'layerIds': ['model-evidence-overlay']},
                        {'id': 'scan-reference', 'layerIds': ['raw-lidar-ply', 'tsdf-fused-mesh']}]}},
                'sourceEvidence': refs, 'aiInvokedByRunner': False,
                'limitations': ['RoomPlan can miss or misclassify objects; these hypotheses are retained as evidence.',
                               'Unknown observed cells are not automatically clutter or scan error.',
                               'Modeled geometry remains inferred even with same-cell scan support.',
                               'Transparent layers need independent toggles; avoid enabling every dense layer at once.']}
    path = scan / ('layer-manifest.' + mode + '.json')
    write(path, manifest)
    write(scan / 'layer-manifest.json', manifest)
    return path


def verify_manifest(scan: Path, path: Path) -> dict:
    scan = scan.resolve(strict=True)
    manifest = read(path)
    imported = read(scan / 'import-manifest.json')
    if (manifest.get('scanId') != scan.name or manifest.get('frame') != 'room-local-m' or
            manifest.get('sourceArchiveSha256') != imported['sourceArchive']['sha256'] or
            manifest.get('sourcePlySha256') != sha(local_file(scan, imported['assetPaths']['rawMeshPly'])) or
            manifest.get('convertedHash') != sha(scan / 'converted.json')):
        raise ValueError('layer manifest source identity mismatch')
    seen = set()
    for layer in manifest['layers']:
        if layer['id'] in seen or layer['transformHash'] != manifest['transformHash']:
            raise ValueError('duplicate layer or wrong layer transform')
        seen.add(layer['id'])
        if layer['available']:
            uri = layer['geometryUri'] if layer['renderable'] else layer['dataUri']
            if sha(local_file(scan, uri)) != layer['sha256']:
                raise ValueError('layer asset hash differs from its manifest')
            if layer['kind'] == 'mesh-collection':
                for item in read(local_file(scan, uri))['meshes']:
                    if sha(local_file(scan, item['geometryUri'])) != item['sha256']:
                        raise ValueError('mesh collection asset hash differs from its manifest')
        elif layer['geometryUri'] is not None or layer['dataUri'] is not None or layer['sha256'] is not None:
            raise ValueError('unavailable layer cannot advertise a generated asset')
    return manifest
