#!/usr/bin/env python3
"""Prepare a local, auditable Codex work package; never invoke an AI service."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

from PIL import Image, ImageDraw


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def safe_file(root: Path, relative: str) -> Path:
    """Resolve importer paths without allowing traversal or symlink escapes."""
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('source reference must be a nonempty POSIX relative path')
    parts = PurePosixPath(relative)
    if parts.is_absolute() or '..' in parts.parts:
        raise ValueError(f'unsafe source reference: {relative}')
    result = (root / relative).resolve(strict=True)
    if not result.is_relative_to(root.resolve()) or not result.is_file():
        raise ValueError(f'source reference escapes its root or is not a file: {relative}')
    return result


def transform_hash(values: list) -> str:
    if not isinstance(values, list) or len(values) != 16 or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in values):
        raise ValueError('worldToRoom must be a finite column-major 4x4 matrix')
    if any(abs(values[i] - expected) > 1e-6
           for i, expected in ((3, 0), (7, 0), (11, 0), (15, 1))):
        raise ValueError('worldToRoom must be a rigid transform')
    axes = [values[i:i + 3] for i in (0, 4, 8)]
    for i in range(3):
        for j in range(3):
            if abs(sum(a * b for a, b in zip(axes[i], axes[j])) - int(i == j)) > 1e-5:
                raise ValueError('worldToRoom must be a rigid transform')
    a, b, c = axes
    det = (a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] *
           (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]))
    if abs(det - 1) > 1e-5:
        raise ValueError('worldToRoom must be a proper rigid transform')
    normalized = [int(v) if float(v).is_integer() else float(v) for v in values]
    return hashlib.sha256(json.dumps(normalized, separators=(',', ':')).encode()).hexdigest()


def sampled_indices(count: int, limit: int = 12) -> list[int]:
    if count <= limit:
        return list(range(count))
    return sorted({round(i * (count - 1) / (limit - 1)) for i in range(limit)})


def checked_tree(path: Path) -> None:
    if not path.is_dir() or path.is_symlink():
        raise ValueError(f'skill resource is not a real directory: {path}')
    if any(p.is_symlink() for p in path.rglob('*')):
        raise ValueError(f'symlinks are not allowed in bundled skill resources: {path}')


def _task(job: dict) -> str:
    identity = {key: job[key] for key in
                ('scanId', 'frame', 'sourcePlySha256', 'transformHash', 'grid')}
    identity['schemaVersion'] = 1
    identity['instances'] = []
    return '''# 扫描到 AI 模型与同源体素任务

此目录仅完成证据准备，状态为 `awaiting-ai-plan`。尚未调用 AI，也没有模型生成或语义识别成功的承诺。后续 Codex 在本地读取本任务并执行建模；不需要读取 API 密钥。

先读 `skill/room-scan-rebuild/SKILL.md` 和其 `references/voxel-alignment.md`，再看 `contact.jpg`、`photos/` 和 `room.json`。完整照片顺序、机位及原文件引用见 `photo-index.json`。这里只复制最多 12 张预览照片，其他照片和原始 PLY 仍位于 `ai-job.json` 的 `sourceRefs` 指向的本机导入目录；这不是整个扫描 ZIP 的便携副本。更多照片也必须按 converted 数组索引使用，原始传感器照片只做一次 ROTATE_270 得到 upright 图，不再次 EXIF 旋转。

## 工作方式

根据照片识别、RoomPlan 尺寸和 LiDAR 空间分布编写有稳定名称的几何提案，不必先完成 PLY 逐面实例切分。RoomPlan 漏报或类别错误不得阻止新增有证据的家具。保持原始 RoomPlan 声明，并记录修正依据。先建立模型，再回绑扫描证据；不要为了覆盖点云把椅子、沙发或邻近物体合并。

生成 `voxel-plan.json`，使用下方真实身份和固定网格。每个 instance 有稳定 `instanceId`、name、categoryClaim；每个 part 有稳定 `partId`、role、`photoEvidence`、`geometryState`。已有 RoomPlan 对象沿用导入 ID；新假设使用 scanId 范围内的 AI ID。观察可见部分用 photo-guided，隐藏腿、侧面等补全保持 inferred。不得把生成内容标成 measured 或 accepted。

几何使用整数 `gridBox`（minCell 与正整数 sizeCells）或 `gridCells`（显式整数 cells）；格子最大边界半开，不给最大面多采一层。米制坐标为 room-local-m、+Y 向上、地面为零。不要改变 origin、step、transform，也不要对已转换坐标重复转换。保留表面平整、落地关系、开口与邻物间隙；细化模型意图，不追逐 PLY 毛刺。

同一个 plan 交给 bundled `voxel_plan_builder.py` 同源生成 `reconstructed.glb` 与 `voxel-occupancy.json`。**命名 3D 实体 GLB 必须保留为独立、可开关层**；它与模型体素是推断模型，原扫描表面层继续保留。对照多张匹配机位照片与正交扫描视图，必要时修正局部。不得在 plan 中伪造 accepted owner、sourceFaceIds 或审核通过标记。扫描同格支持只是空间证据，不证明语义归属；无扫描支持也不代表空无一物。

''' + '```json\n' + json.dumps(identity, ensure_ascii=False, indent=2) + '\n```\n\n' + '''上方 instances 留空只是身份说明，不是可交付模型。请写入实际照片理解所得的命名实例、部件和证据，同时写 `decisions.md` 记录照片索引、可见与脑补结构、未解决冲突。

## 本地生成与接回

从本任务目录运行（所有输出使用新目录）：

```sh
python3 skill/room-scan-rebuild/scripts/voxel_plan_builder.py voxel-plan.json --output model-build-v1
```

回到本实验根目录，用 `run_pipeline.py` 对同一 ZIP、同一 scan-id 运行 `--mode model-voxel --voxel-plan 本任务目录/voxel-plan.json`，由流水线校验身份并生成扫描绑定侧车和分层 manifest。CLI 完整参数见实验 README。工作包不会自动执行外部 AI。保持 `unreviewed`、`ownerAcceptanceBlocked: true`，不修改旧 owner 或用户编辑。
'''


def prepare_ai_job(scan_dir: Path, output_dir: Path, skill_dir: Path) -> dict:
    """Create a new local evidence handoff without altering imported evidence."""
    scan = Path(scan_dir).expanduser().resolve(strict=True)
    skill = Path(skill_dir).expanduser().resolve(strict=True)
    requested = Path(output_dir).expanduser().absolute()
    if os.path.lexists(requested):
        raise FileExistsError(f'AI job output already exists: {requested}')
    parent = requested.parent.resolve(strict=True)
    output = parent / requested.name
    if output.is_relative_to(skill) or skill.is_relative_to(output):
        raise ValueError('AI job output must not overlap its skill source')
    checked_tree(skill)
    if not (skill / 'SKILL.md').is_file():
        raise ValueError('skill source requires SKILL.md')
    baseline = skill.parent.parent / 'skill-baseline'
    if baseline.exists():
        checked_tree(baseline)

    manifest_path = safe_file(scan, 'import-manifest.json')
    manifest = read(manifest_path)
    converted_ref = manifest.get('converted', {})
    if converted_ref.get('frame') != 'room-local-m':
        raise ValueError('converted frame must be room-local-m')
    converted_path = safe_file(scan, converted_ref.get('path'))
    converted_hash = digest(converted_path)
    if converted_hash != converted_ref.get('sha256'):
        raise ValueError('converted JSON hash does not match import manifest')
    room = read(converted_path)
    transform = room.get('transform', {}).get('worldToRoom')
    transform_id = transform_hash(transform)
    scan_id = manifest.get('scanId')
    if not isinstance(scan_id, str) or not scan_id or scan_id != scan.name:
        raise ValueError('scanId must match the imported scan directory name')
    source_files = manifest.get('sourceFiles')
    if not isinstance(source_files, dict):
        raise ValueError('import manifest sourceFiles must be a mapping')
    by_path = {}
    for row in source_files.values():
        if not isinstance(row, dict) or not isinstance(row.get('path'), str):
            raise ValueError('invalid sourceFiles entry')
        if row['path'] in by_path:
            raise ValueError('duplicate sourceFiles path')
        by_path[row['path']] = row
    ply_ref = manifest.get('assetPaths', {}).get('rawMeshPly')
    ply_path = safe_file(scan, ply_ref)
    ply_hash = digest(ply_path)
    if ply_hash != by_path.get(ply_ref, {}).get('sha256'):
        raise ValueError('original PLY hash does not match import manifest')
    bundle_manifest = safe_file(scan, manifest.get('manifestPath'))
    bundle = bundle_manifest.parent
    photos = room.get('photos')
    if not isinstance(photos, list):
        raise ValueError('converted photos must be an ordered array')
    grid = {'stepM': 0.05, 'originM': [0, 0, 0]}
    furniture_path = scan / 'derived-v1/furniture-grid.json'
    if furniture_path.exists():
        furniture = read(safe_file(scan, 'derived-v1/furniture-grid.json'))
        active = furniture.get('grids', {}).get('0.05')
        if (furniture.get('frame') != 'room-local-m' or not isinstance(active, dict) or
                active.get('stepM') != 0.05 or active.get('originM') != [0, 0, 0] or
                active.get('cellEncoding') != 'index-xyz'):
            raise ValueError('existing furniture grid does not match the AI plan grid')
    selected = sampled_indices(len(photos))
    photo_rows, photo_sources = [], {}
    for index, photo in enumerate(photos):
        if not isinstance(photo, dict):
            raise ValueError('invalid converted photo entry')
        source = safe_file(bundle, photo.get('file'))
        source_relative = source.relative_to(scan).as_posix()
        recorded = by_path.get(source_relative, {})
        recorded_hash = recorded.get('sha256')
        if not isinstance(recorded_hash, str) or len(recorded_hash) != 64:
            raise ValueError(f'photo {index} has no recorded source identity')
        copied = index in selected
        if copied and digest(source) != recorded_hash:
            raise ValueError(f'photo {index} hash does not match import manifest')
        photo_rows.append({'photoIndex': index, 'converted': photo,
                           'originalRelativePath': source_relative,
                           'sourceSha256': recorded_hash,
                           'hashVerification': 'verified-file' if copied else 'import-manifest-recorded',
                           'uprightPreview': f'photos/{index:04d}.jpg' if copied else None})
        if copied:
            photo_sources[index] = source

    job = {'schemaVersion': 1, 'kind': 'scan-model-ai-handoff',
           'status': 'awaiting-ai-plan', 'aiInvoked': False,
           'scanId': scan_id, 'frame': 'room-local-m',
           'sourcePlySha256': ply_hash, 'transformHash': transform_id,
           'convertedSha256': converted_hash,
           'sourceArchiveSha256': manifest.get('sourceArchive', {}).get('sha256'),
           'grid': grid, 'worldToRoom': transform,
           'jobDir': str(output), 'preferredPlanPath': str(output / 'voxel-plan.json'),
           'photoCount': len(photos), 'previewPhotoIndices': selected,
           'skillPath': 'skill/room-scan-rebuild/SKILL.md',
           'sourceRefs': {'scanDirectory': str(scan), 'originalPly': str(ply_path),
                          'bundleDirectory': str(bundle), 'converted': str(converted_path),
                          'importManifest': str(manifest_path)},
           'importManifestSha256': digest(manifest_path),
           'skillResources': {str(p.relative_to(skill)): digest(p)
                              for p in sorted(skill.rglob('*'))
                              if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'},
           'inputIdentityVerified': ['sourcePlySha256', 'convertedSha256', 'transformHash'],
           'ownerAcceptanceBlocked': True, 'reviewState': 'unreviewed',
           'portableFullScanCopy': False}
    stage = Path(tempfile.mkdtemp(prefix=f'.{output.name}.tmp-', dir=parent))
    try:
        (stage / 'photos').mkdir()
        tiles = []
        for index in selected:
            with Image.open(photo_sources[index]) as raw:
                upright = raw.convert('RGB').transpose(Image.Transpose.ROTATE_270)
                upright.thumbnail((1600, 1600))
                upright.save(stage / 'photos' / f'{index:04d}.jpg', quality=90)
                tile = Image.new('RGB', (320, 264), '#15191d')
                thumb = upright.copy()
                thumb.thumbnail((312, 232))
                tile.paste(thumb, ((320 - thumb.width) // 2, 4 + (232 - thumb.height) // 2))
                ImageDraw.Draw(tile).text((8, 244), f'photoIndex {index} / {index:04d}.jpg', fill='white')
                tiles.append(tile)
        if tiles:
            cols = min(4, len(tiles))
            contact = Image.new('RGB', (320 * cols, 264 * math.ceil(len(tiles) / cols)), '#15191d')
            for slot, tile in enumerate(tiles):
                contact.paste(tile, ((slot % cols) * 320, (slot // cols) * 264))
        else:
            contact = Image.new('RGB', (640, 80), '#15191d')
            ImageDraw.Draw(contact).text((16, 28), 'No capture photos available; report missing visual evidence.', fill='white')
        contact.save(stage / 'contact.jpg', quality=90)
        shutil.copy2(converted_path, stage / 'room.json')
        shutil.copytree(skill, stage / 'skill/room-scan-rebuild',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        if baseline.exists():
            shutil.copytree(baseline, stage / 'skill-baseline',
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        write(stage / 'photo-index.json', {'schemaVersion': 1, 'scanId': scan_id,
              'convertedSha256': converted_hash, 'arrayOrder': 'converted-photos',
              'previewRotation': 'ROTATE_270-once-no-exif-transpose', 'photos': photo_rows})
        write(stage / 'ai-job.json', job)
        (stage / 'AI_TASK.md').write_text(_task(job), encoding='utf-8')
        # Claim the final directory atomically. rename alone can replace a directory
        # another process created after the earlier existence check on POSIX.
        output.mkdir(exist_ok=False)
        try:
            # Publish the status record last; a visible directory is not a completed job.
            children = sorted(stage.iterdir(), key=lambda p: p.name == 'ai-job.json')
            for child in children:
                child.rename(output / child.name)
            stage.rmdir()
        except BaseException:
            shutil.rmtree(output, ignore_errors=True)
            raise
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return job


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--skill-dir', type=Path, required=True)
    args = parser.parse_args()
    result = prepare_ai_job(args.scan_dir, args.output, args.skill_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
