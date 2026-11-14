#!/usr/bin/env python3
"""Run official MobileSAM on selected upright review photos, saving private masks.

Use the isolated Python environment documented in README.md. The model only
segments prompted pixels; it does not identify a class or accept an owner.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import Image
from PIL import ImageDraw

HERE = Path(__file__).resolve().parent
PRIVATE = HERE.parent / '.private'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def private_path(path: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(PRIVATE.resolve()) or path == PRIVATE.resolve():
        raise ValueError('model assets and outputs must remain under experiment/.private')
    return path


def pixel_prompts(hint: dict, width: int, height: int):
    box = np.array(hint['bboxNorm'], dtype=np.float32) * [width, height, width, height]
    coords = np.array(hint['positivePointsNorm'] + hint['negativePointsNorm'], dtype=np.float32)
    coords *= [width, height]
    labels = np.array([1] * len(hint['positivePointsNorm']) +
                      [0] * len(hint['negativePointsNorm']), dtype=np.int32)
    if len(labels) == 0 or not (labels == 1).any():
        raise ValueError('at least one positive point is required')
    return box, coords, labels


def corrected_hints(hints: list[dict], corrections: dict, scan_id: str,
                    hints_hash: str) -> tuple[list[dict], set[int]]:
    """Apply versioned agent review prompts without rewriting the E15 job."""
    if (corrections.get('schemaVersion') != 1 or corrections.get('scanId') != scan_id or
            corrections.get('photoHintsSha256') != hints_hash or
            corrections.get('reviewKind') != 'agent_review_correction'):
        raise ValueError('correction identity must match this original review job')
    result = list(hints)
    indices = set()
    for row in corrections.get('corrections', []):
        i = row.get('hintIndex')
        if not isinstance(i, int) or i < 0 or i >= len(hints) or i in indices:
            raise ValueError('invalid or duplicate correction hint index')
        if row.get('photoId') != hints[i]['photoId'] or not row.get('reason'):
            raise ValueError('correction needs original photo identity and visual reason')
        changed = {k: row[k] for k in ('bboxNorm', 'positivePointsNorm', 'negativePointsNorm')}
        bbox = changed['bboxNorm']
        points = changed['positivePointsNorm'] + changed['negativePointsNorm']
        if (len(bbox) != 4 or any(not 0 <= x <= 1 for x in bbox) or
                not bbox[0] < bbox[2] or not bbox[1] < bbox[3] or
                not changed['positivePointsNorm'] or
                any(len(p) != 2 or any(not 0 <= x <= 1 for x in p) for p in points)):
            raise ValueError('correction must have ordered normalized bbox and positive/negative points')
        result[i] = {**hints[i], **changed}
        indices.add(i)
    if not indices:
        raise ValueError('empty correction list')
    return result, indices


def run(job_dir: Path, model_repo: Path, checkpoint: Path, output: Path,
        hint_indices: list[int], threads: int = 4,
        prompt_corrections: Path | None = None) -> dict:
    job_dir, model_repo, checkpoint, output = map(private_path, (job_dir, model_repo, checkpoint, output))
    if output.exists() or not hint_indices or len(hint_indices) != len(set(hint_indices)):
        raise ValueError('new output directory and unique nonempty hint indices required')
    job = json.loads((job_dir / 'evidence.json').read_text(encoding='utf-8'))
    hints_path = job_dir / 'photo-hints.json'
    hints = json.loads(hints_path.read_text(encoding='utf-8'))['payload']['hints']
    correction_indices = set()
    if prompt_corrections is not None:
        prompt_corrections = private_path(prompt_corrections)
        corrections = json.loads(prompt_corrections.read_text(encoding='utf-8'))
        hints, correction_indices = corrected_hints(hints, corrections, job['scanId'], sha256(hints_path))
        if not correction_indices.issubset(set(hint_indices)):
            raise ValueError('each correction must be selected for this separate trial')
    if any(i < 0 or i >= len(hints) for i in hint_indices):
        raise ValueError('hint index outside original job')
    photos = {row['photoId']: row for row in job['photos']}
    if not (model_repo / 'mobile_sam/__init__.py').is_file() or not checkpoint.is_file():
        raise ValueError('official MobileSAM code or checkpoint unavailable')
    sys.path.insert(0, str(model_repo))
    import torch
    from mobile_sam import sam_model_registry, SamPredictor
    torch.set_num_threads(max(1, min(threads, 8)))
    model = sam_model_registry['vit_t'](checkpoint=str(checkpoint))
    model.to(device='cpu')
    model.eval()
    predictor = SamPredictor(model)
    output.mkdir(parents=True)
    rows = []
    previous = None
    for i in hint_indices:
        hint = hints[i]
        photo_id = hint['photoId']
        preview_info = photos[photo_id]
        preview = (job_dir / preview_info['previewFile']).resolve(strict=True)
        if not preview.is_relative_to(job_dir) or sha256(preview) != preview_info['previewSha256']:
            raise ValueError('preview identity mismatch')
        image = np.asarray(Image.open(preview).convert('RGB'))
        height, width = image.shape[:2]
        if previous != photo_id:
            t0 = time.perf_counter()
            predictor.set_image(image)
            encoding_seconds = time.perf_counter() - t0
            previous = photo_id
        else:
            encoding_seconds = 0.0
        box, points, labels = pixel_prompts(hint, width, height)
        t1 = time.perf_counter()
        masks, scores, _ = predictor.predict(
            point_coords=points, point_labels=labels, box=box, multimask_output=True)
        prediction_seconds = time.perf_counter() - t1
        chosen = int(np.argmax(scores))
        mask = masks[chosen].astype(np.uint8)
        mask_name = f'hint-{i:04d}.png'
        Image.fromarray(mask * 255).save(output / mask_name)
        # Overlay only for visual QA. No model mask is inserted into the editor.
        rgba = Image.fromarray(image).convert('RGBA')
        paint = Image.new('RGBA', (width, height), (0, 210, 140, 95))
        rgba.paste(paint, (0, 0), Image.fromarray(mask * 95))
        draw = ImageDraw.Draw(rgba)
        draw.rectangle(tuple(box.tolist()), outline=(255, 180, 0, 255), width=2)
        for (x, y), label in zip(points, labels):
            color = (0, 255, 0, 255) if label else (255, 40, 40, 255)
            draw.ellipse((x-6, y-6, x+6, y+6), outline=color, width=3)
        overlay_name = f'hint-{i:04d}-overlay.jpg'
        rgba.convert('RGB').save(output / overlay_name, quality=88)
        rows.append({'hintIndex': i, 'photoId': photo_id,
                     'categoryClaimUnreviewed': hint['category'],
                     'promptKind': 'agent_review_correction' if i in correction_indices else 'original_photo_hint',
                     'bboxNorm': hint['bboxNorm'],
                     'positivePointsNorm': hint['positivePointsNorm'],
                     'negativePointsNorm': hint['negativePointsNorm'],
                     'maskFile': mask_name, 'maskSha256': sha256(output / mask_name),
                     'previewSha256': sha256(preview),
                     'maskPixels': int(mask.sum()), 'maskPixelFraction': round(float(mask.mean()), 6),
                     'bestScore': round(float(scores[chosen]), 6),
                     'encodingSeconds': round(encoding_seconds, 3),
                     'predictionSeconds': round(prediction_seconds, 3),
                     'overlayFile': overlay_name, 'reviewState': 'unreviewed'})
    revision = subprocess.check_output(
        ['git', '-C', str(model_repo), 'rev-parse', 'HEAD'], text=True).strip()
    report = {'schemaVersion': 1, 'runnerId': 'official-mobile-sam-vit-t-cpu',
              'scanId': job['scanId'], 'modelRepoCommit': revision,
              'checkpointSha256': sha256(checkpoint),
              'photoHintsSha256': sha256(hints_path),
              'promptCorrectionsSha256': sha256(prompt_corrections) if prompt_corrections else None,
              'projectionCompatibleWithOriginalHints': not bool(correction_indices),
              'modelSemanticClassifier': False,
              'warning': 'Prompted pixel masks only; labels are unreviewed AI claims, not accepted 3D owners.',
              'results': rows}
    (output / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job-dir', type=Path, required=True)
    parser.add_argument('--model-repo', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--hint-indices', type=int, nargs='+', required=True)
    parser.add_argument('--prompt-corrections', type=Path,
                        help='separate agent_review_correction JSON; never modifies original hints')
    args = parser.parse_args()
    report = run(args.job_dir, args.model_repo, args.checkpoint, args.output, args.hint_indices,
                 prompt_corrections=args.prompt_corrections)
    print(json.dumps({'runnerId': report['runnerId'], 'results': report['results']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
