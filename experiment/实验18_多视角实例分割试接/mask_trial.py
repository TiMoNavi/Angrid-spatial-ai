#!/usr/bin/env python3
"""Review-only pixel-mask adapter for E15 depth-validated original PLY faces.

The default OpenCV GrabCut provider is a CPU geometry/color baseline, NOT a
semantic model. --mask-dir accepts provenance-checked PNG masks from a model runner.
Neither mode accepts an owner nor edits the input scan or E15 ledger.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
PRIVATE = EXPERIMENT / '.private'
E15_PIPELINE = EXPERIMENT / '实验15_扫描识别切分与自动导入' / 'pipeline'
sys.path.insert(0, str(E15_PIPELINE))
from photo_projection import project_session_points, sensor_to_upright_norm  # noqa: E402


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def require_hash(path: Path, expected: str, description: str) -> None:
    if not expected or sha256(path) != expected:
        raise ValueError(f'{description} identity changed')


def require_private(path: Path) -> Path:
    resolved = path.resolve()
    root = PRIVATE.resolve()
    if not resolved.is_relative_to(root) or resolved == root:
        raise ValueError('input/output must remain inside experiment/.private')
    return resolved


def inherited_review(hint_index: int, photo_id: str, provenance: dict) -> dict:
    """Carry existing visual rejection forward, independently of mask counts.

    Older E15 QA records have an explicit rejection in their issue text rather
    than a structured field. Preserve that instruction without case-specific
    indices or treating a high mask score as category confirmation.
    """
    warnings = [row for row in provenance.get('visualReviewWarnings', [])
                if row.get('hintIndex') == hint_index and row.get('photoId') == photo_id]
    rejected = any(row.get('reviewRecommendation') == 'reject-category-claim' or
                   'do not accept' in str(row.get('issue', '')).casefold()
                   for row in warnings)
    return {'reviewRecommendation': 'reject-category-claim' if rejected else 'review-mask-and-category',
            'reviewReasons': [row['issue'] for row in warnings if isinstance(row.get('issue'), str)],
            'ownerAcceptanceBlocked': True}


def prompt_pixels(hint: dict, width: int, height: int):
    box = hint.get('bboxNorm')
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError('a normalized bbox is required')
    x0 = max(0, min(width - 2, int(np.floor(box[0] * width))))
    y0 = max(0, min(height - 2, int(np.floor(box[1] * height))))
    x1 = max(x0 + 2, min(width, int(np.ceil(box[2] * width))))
    y1 = max(y0 + 2, min(height, int(np.ceil(box[3] * height))))
    positive = [(min(width - 1, int(u * width)), min(height - 1, int(v * height)))
                for u, v in hint.get('positivePointsNorm', [])]
    negative = [(min(width - 1, int(u * width)), min(height - 1, int(v * height)))
                for u, v in hint.get('negativePointsNorm', [])]
    return (x0, y0, x1, y1), positive, negative


def grabcut_mask(image: np.ndarray, hint: dict, iterations: int = 5) -> np.ndarray:
    """Use the hint as a bounded color-segmentation prompt; never infer class."""
    height, width = image.shape[:2]
    (x0, y0, x1, y1), positive, negative = prompt_pixels(hint, width, height)
    if not positive:
        raise ValueError('GrabCut trial requires at least one positive point')
    labels = np.full((height, width), cv2.GC_BGD, dtype=np.uint8)
    labels[y0:y1, x0:x1] = cv2.GC_PR_FGD
    for x, y in positive:
        cv2.circle(labels, (x, y), 5, cv2.GC_FGD, -1)
    for x, y in negative:
        cv2.circle(labels, (x, y), 7, cv2.GC_BGD, -1)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(image, labels, None, bgd, fgd, iterations, cv2.GC_INIT_WITH_MASK)
    mask = np.isin(labels, [cv2.GC_FGD, cv2.GC_PR_FGD]).astype(np.uint8)
    # Remove unrelated foreground islands, but retain all islands touched by a
    # positive seed; a split visible surface may have several prompt points.
    _, components = cv2.connectedComponents(mask, connectivity=8)
    keep = {int(components[y, x]) for x, y in positive if components[y, x] > 0}
    if not keep:
        return np.zeros_like(mask)
    return np.isin(components, list(keep)).astype(np.uint8)


def external_mask(path: Path, shape: tuple[int, int]) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape != shape:
        raise ValueError('external mask missing or wrong upright preview size')
    if not np.array_equal(image, image.astype(bool) * 255):
        raise ValueError('external mask must be binary 0/255 PNG')
    return (image > 0).astype(np.uint8)


def sample_upright_mask(mask: np.ndarray, sensor_u: np.ndarray, sensor_v: np.ndarray,
                        sensor_width: int, sensor_height: int, valid: np.ndarray) -> np.ndarray:
    """Match E15's clockwise-upright preview transform without cropping."""
    nu, nv = sensor_to_upright_norm(sensor_u, sensor_v, sensor_width, sensor_height)
    height, width = mask.shape
    good = valid & np.isfinite(nu) & np.isfinite(nv) & (nu >= 0) & (nu < 1) & (nv >= 0) & (nv < 1)
    result = np.zeros(len(sensor_u), dtype=bool)
    indices = np.flatnonzero(good)
    if len(indices):
        x = np.minimum((nu[indices] * width).astype(int), width - 1)
        y = np.minimum((nv[indices] * height).astype(int), height - 1)
        result[indices] = mask[y, x] != 0
    return result


def overlay(image: np.ndarray, mask: np.ndarray, hint: dict) -> np.ndarray:
    view = image.copy()
    tint = np.zeros_like(view)
    tint[:, :, 1] = 220
    view[mask > 0] = cv2.addWeighted(view, .55, tint, .45, 0)[mask > 0]
    height, width = mask.shape
    (x0, y0, x1, y1), positive, negative = prompt_pixels(hint, width, height)
    cv2.rectangle(view, (x0, y0), (x1 - 1, y1 - 1), (0, 180, 255), 2)
    for point in positive:
        cv2.circle(view, point, 7, (0, 255, 0), 2)
    for point in negative:
        cv2.circle(view, point, 7, (0, 0, 255), 2)
    return view


def run(scan_dir: Path, job_dir: Path, output: Path, hint_indices: list[int],
        mask_dir: Path | None = None, runner_id: str = 'opencv-grabcut-v1') -> dict:
    scan_dir, job_dir, output = map(require_private, (scan_dir, job_dir, output))
    if mask_dir is not None:
        mask_dir = require_private(mask_dir)
        if not runner_id or runner_id == 'opencv-grabcut-v1':
            raise ValueError('external masks require a specific runner ID')
    if output.exists() or not hint_indices or len(set(hint_indices)) != len(hint_indices):
        raise ValueError('output must be new and hint indices unique/nonempty')
    hints_path = job_dir / 'photo-hints.json'
    evidence_path = job_dir / 'evidence.json'
    projection_path = scan_dir / 'derived-v4-photo-ai-fresh/photo-face-proposals.json'
    hints = load_json(hints_path)['payload']['hints']
    evidence = load_json(evidence_path)
    projection = load_json(projection_path)
    qa_path = scan_dir / 'derived-v4-photo-ai-fresh/qa/provenance.json'
    provenance = load_json(qa_path) if qa_path.is_file() else {}
    manifest = load_json(scan_dir / 'import-manifest.json')
    if any(i < 0 or i >= len(hints) for i in hint_indices):
        raise ValueError('hint index out of range')
    if (projection['scanId'] != scan_dir.name or evidence['scanId'] != scan_dir.name or
            manifest['scanId'] != scan_dir.name or len(projection['proposals']) != len(hints) or
            projection['photoHintsHash'] != sha256(hints_path)):
        raise ValueError('scan identity or original hint hash mismatch')
    if provenance and (provenance.get('scanId') != scan_dir.name or
                       provenance.get('sources', {}).get('photoHintsSha256') != sha256(hints_path) or
                       provenance.get('sources', {}).get('photoProjectionSha256') != sha256(projection_path) or
                       provenance.get('sources', {}).get('originalPlySha256') != projection['sourceHash']):
        raise ValueError('inherited QA does not match source, photo hints or projection')
    external_manifest = None
    external_rows = {}
    if mask_dir is not None:
        external_manifest = load_json(mask_dir / 'manifest.json')
        if (external_manifest.get('runnerId') != runner_id or
                external_manifest.get('scanId') != scan_dir.name or
                external_manifest.get('photoHintsSha256') != sha256(hints_path)):
            raise ValueError('external model runner manifest does not match this scan or hint job')
        if external_manifest.get('promptCorrectionsSha256') is not None:
            raise ValueError('corrected prompt masks need a fresh depth/source-face proposal; this adapter only filters original proposals')
        external_rows = {row['hintIndex']: row for row in external_manifest['results']}
    source = (scan_dir / manifest['assetPaths']['rawMeshPly']).resolve(strict=True)
    if not source.is_relative_to(scan_dir / 'source') or sha256(source) != projection['sourceHash']:
        raise ValueError('raw original PLY source hash mismatch')
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) != projection['sourceFaceCount']:
        raise ValueError('raw original PLY face count mismatch')
    centers = np.asarray(mesh.triangles_center)
    photo_index = scan_dir / 'source/Room/photos/photos.json'
    require_hash(photo_index, projection.get('inputHashes', {}).get('photos.json'),
                 'photo calibration index')
    raw_photos = load_json(photo_index)
    photos = {row['file']: row for row in raw_photos}
    previews = {row['photoId']: row for row in evidence['photos']}
    output.mkdir(parents=True)
    results = []
    for i in hint_indices:
        hint, proposal = hints[i], projection['proposals'][i]
        photo_id = hint['photoId']
        if proposal['hintIndex'] != i or proposal['photoId'] != photo_id:
            raise ValueError('proposal/hint index mismatch')
        if photo_id not in photos or photo_id not in previews:
            raise ValueError('photo missing in source or review job')
        original = (scan_dir / 'source/Room' / photo_id).resolve(strict=True)
        if not original.is_relative_to(scan_dir / 'source/Room'):
            raise ValueError('original photo escapes imported bundle')
        require_hash(original, projection['inputHashes'].get('photo:' + photo_id), 'original photo')
        require_hash(original, previews[photo_id].get('sourceSha256'), 'review source photo')
        preview = (job_dir / previews[photo_id]['previewFile']).resolve(strict=True)
        if not preview.is_relative_to(job_dir) or sha256(preview) != previews[photo_id]['previewSha256']:
            raise ValueError('upright preview hash mismatch')
        image = cv2.imread(str(preview), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError('preview cannot be decoded')
        started = time.perf_counter()
        if mask_dir is None:
            mask = grabcut_mask(image, hint)
            provider = 'opencv-grabcut-v1'
        else:
            row = external_rows.get(i)
            if (row is None or row.get('photoId') != photo_id or
                    row.get('previewSha256') != sha256(preview) or
                    row.get('maskFile') != f'hint-{i:04d}.png'):
                raise ValueError('external mask identity does not match original photo hint')
            mask_path = (mask_dir / f'hint-{i:04d}.png').resolve(strict=True)
            if not mask_path.is_relative_to(mask_dir) or sha256(mask_path) != row.get('maskSha256'):
                raise ValueError('external mask escapes runner directory or hash mismatches')
            mask = external_mask(mask_path, image.shape[:2])
            provider = runner_id
        elapsed = time.perf_counter() - started
        ids = np.asarray(proposal['sourceFaceIds'], dtype=np.int64)
        if np.any(ids < 0) or np.any(ids >= len(mesh.faces)):
            raise ValueError('proposal sourceFaceId out of range')
        photo = photos[photo_id]
        u, v, _, visible = project_session_points(
            centers[ids], photo['transform'], photo['intrinsics'],
            int(photo['width']), int(photo['height']))
        inside = sample_upright_mask(mask, u, v, int(photo['width']), int(photo['height']), visible)
        kept = ids[inside]
        mask_name = f'hint-{i:04d}.png'
        overlay_name = f'hint-{i:04d}-overlay.jpg'
        cv2.imwrite(str(output / mask_name), mask * 255)
        cv2.imwrite(str(output / overlay_name), overlay(image, mask, hint), [cv2.IMWRITE_JPEG_QUALITY, 88])
        results.append({'hintIndex': i, 'photoId': photo_id,
                        'categoryClaimUnreviewed': hint['category'],
                        'baselineDepthConnectedSourceFaceCount': int(len(ids)),
                        'maskKeptSourceFaceCount': int(len(kept)),
                        'maskRemovedSourceFaceCount': int(len(ids) - len(kept)),
                        'maskKeptSourceFaceIds': kept.tolist(),
                        'maskPixelCount': int(mask.sum()),
                        'maskPixelFraction': round(float(mask.mean()), 6),
                        'maskRuntimeSeconds': round(elapsed, 3),
                        'maskFile': mask_name, 'maskSha256': sha256(output / mask_name),
                        'overlayFile': overlay_name,
                        'previewSha256': sha256(preview),
                        'provider': provider, 'reviewState': 'unreviewed',
                        **inherited_review(i, photo_id, provenance)})
    report = {'schemaVersion': 1, 'algorithm': 'pixel-mask-filter-on-depth-validated-source-faces-v1',
              'scanId': scan_dir.name, 'sourceHash': projection['sourceHash'],
              'photoHintsHash': sha256(hints_path), 'projectionHash': sha256(projection_path),
              'provider': runner_id if mask_dir else 'opencv-grabcut-v1',
              'modelIsSemantic': False if mask_dir is None else external_manifest.get('modelSemanticClassifier'),
              'modelCheckpointSha256': None if mask_dir is None else external_manifest.get('checkpointSha256'),
              'modelRepoCommit': None if mask_dir is None else external_manifest.get('modelRepoCommit'),
              'runnerManifestSha256': None if mask_dir is None else sha256(mask_dir / 'manifest.json'),
              'inheritedQaSha256': sha256(qa_path) if provenance else None,
              'ownerAssignmentsChanged': False,
              'warning': 'Mask faces remain review-only subsets of E15 candidates; false semantic categories are not corrected.',
              'results': results}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-dir', type=Path, required=True)
    parser.add_argument('--job-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--hint-indices', type=int, nargs='+', required=True)
    parser.add_argument('--mask-dir', type=Path)
    parser.add_argument('--runner-id', default='opencv-grabcut-v1')
    args = parser.parse_args()
    result = run(args.scan_dir, args.job_dir, args.output, args.hint_indices,
                 mask_dir=args.mask_dir, runner_id=args.runner_id)
    print(json.dumps({'scanId': result['scanId'], 'provider': result['provider'],
                      'results': [{k: row[k] for k in ('hintIndex', 'photoId',
                         'baselineDepthConnectedSourceFaceCount', 'maskKeptSourceFaceCount',
                         'maskRuntimeSeconds')} for row in result['results']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
