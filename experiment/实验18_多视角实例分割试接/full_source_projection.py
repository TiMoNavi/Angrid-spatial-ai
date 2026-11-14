#!/usr/bin/env python3
"""Project prompted pixel masks onto ALL original PLY faces for review.

Unlike mask_trial.py this does not restrict masks to E15's bbox/shared-edge
components. Depth, room structure and the immutable assignment partition still
constrain the result. No semantic class, accepted instance or owner is inferred.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import cv2
import numpy as np
import trimesh

from mask_trial import (E15_PIPELINE, external_mask, inherited_review, load_json,
                        require_hash, require_private, sample_upright_mask, sha256)
from mobile_sam_masks import corrected_hints
from geometry_v1 import transform_hash, transform_points
from instance_candidates import (FURNITURE_PRIOR_CLASSES, bounds_of_faces,
                                 face_geometry, hard_structure_mask,
                                 parse_face_classes, validate_v1_assignments)
from photo_projection import (column_major_matrix, depth_supported_faces,
                              load_depth_frame, nearest_depth_frame,
                              project_session_points)


def select_mask_faces(mask, centers_session, photo, depth_frame, depth_map,
                      confidence_map, eligible):
    """Return original indices, without a shared-edge or old bbox restriction."""
    u, v, _, in_frame = project_session_points(
        centers_session, photo['transform'], photo['intrinsics'],
        int(photo['width']), int(photo['height']))
    mask_hit = sample_upright_mask(mask, u, v, int(photo['width']),
                                   int(photo['height']), in_frame)
    supported, _ = depth_supported_faces(centers_session, depth_frame,
                                         depth_map, confidence_map)
    ids = np.flatnonzero(mask_hit & supported & eligible)
    return ids, {'maskProjectedFaceCountBeforeDepthAndStructure': int(mask_hit.sum()),
                 'depthSupportedMaskFaceCountBeforeStructure': int((mask_hit & supported).sum())}


def run(scan_dir: Path, job_dir: Path, mask_dir: Path, output: Path,
        hint_indices: list[int], prompt_corrections: Path | None = None) -> dict:
    scan_dir, job_dir, mask_dir, output = map(require_private, (scan_dir, job_dir, mask_dir, output))
    if output.exists() or not hint_indices or len(hint_indices) != len(set(hint_indices)):
        raise ValueError('new output and unique nonempty hint indices required')
    started = time.perf_counter()
    job_path = job_dir / 'evidence.json'
    hints_path = job_dir / 'photo-hints.json'
    runner_path = mask_dir / 'manifest.json'
    baseline_path = scan_dir / 'derived-v4-photo-ai-fresh/photo-face-proposals.json'
    manifest = load_json(scan_dir / 'import-manifest.json')
    job, runner, baseline = map(load_json, (job_path, runner_path, baseline_path))
    hints = load_json(hints_path)['payload']['hints']
    if (any(x.get('scanId') != scan_dir.name for x in (manifest, job, runner, baseline)) or
            runner.get('photoHintsSha256') != sha256(hints_path) or
            baseline.get('photoHintsHash') != sha256(hints_path) or
            any(i < 0 or i >= len(hints) for i in hint_indices)):
        raise ValueError('scan or original photo hint identity mismatch')
    if runner.get('modelSemanticClassifier') is not False:
        raise ValueError('this prototype requires a prompted nonsemantic mask runner')
    if runner.get('promptCorrectionsSha256'):
        if prompt_corrections is None:
            raise ValueError('corrected masks require the versioned correction input')
        prompt_corrections = require_private(prompt_corrections)
        require_hash(prompt_corrections, runner['promptCorrectionsSha256'], 'prompt correction')
        hints, _ = corrected_hints(hints, load_json(prompt_corrections), scan_dir.name, sha256(hints_path))
    elif prompt_corrections is not None:
        raise ValueError('runner did not use these prompt corrections')
    rows = {row['hintIndex']: row for row in runner['results']}
    if len(rows) != len(runner['results']) or not set(hint_indices).issubset(rows):
        raise ValueError('duplicate or missing mask rows')
    bundle = require_private(scan_dir / 'source/Room')
    source = (scan_dir / manifest['assetPaths']['rawMeshPly']).resolve(strict=True)
    if not source.is_relative_to(scan_dir / 'source'):
        raise ValueError('raw PLY escapes imported source')
    require_hash(source, baseline.get('sourceHash'), 'original PLY')
    converted = scan_dir / 'converted.json'
    assignments = scan_dir / 'derived-v1/face-assignments.json'
    photo_index, depth_index = bundle / 'photos/photos.json', bundle / 'depth/frames.json'
    hashes = baseline['inputHashes']
    for path, key in ((converted, 'converted.json'), (assignments, 'face-assignments.json'),
                      (photo_index, 'photos.json'), (depth_index, 'frames.json')):
        require_hash(path, hashes.get(key), key)
    mesh = trimesh.load(source, process=False)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) != baseline['sourceFaceCount']:
        raise ValueError('original source face order/count unavailable')
    source_hash = sha256(source)
    buckets = validate_v1_assignments(load_json(assignments), source_hash, len(mesh.faces))
    room = load_json(converted)
    transform_id = transform_hash(room['transform']['worldToRoom'])
    if transform_id != baseline['transformHash']:
        raise ValueError('room transform differs from pinned E15 source')
    vertices_room = transform_points(np.asarray(mesh.vertices), column_major_matrix(
        room['transform']['worldToRoom'], (4, 4)))
    centers, _ = face_geometry(np.asarray(mesh.vertices), np.asarray(mesh.faces))
    room_centers, room_normals = face_geometry(vertices_room, np.asarray(mesh.faces))
    hard_structure, structure_warning = hard_structure_mask(room_centers, room_normals, room, .06)
    if structure_warning:
        raise ValueError('room structure is required for this furniture-only trial')
    eligible = np.zeros(len(mesh.faces), dtype=bool)
    existing_owner = np.zeros_like(eligible)
    for name in ('unknown', 'one-owner', 'conflict'):
        eligible[buckets.get(name, [])] = True
    for name in ('one-owner', 'conflict'):
        existing_owner[buckets.get(name, [])] = True
    eligible &= ~hard_structure
    # Raw ARKit semantic classes are reported, not used as a furniture veto.
    classes, has_classes = parse_face_classes(mesh, len(mesh.faces))
    photos = {row['file']: row for row in load_json(photo_index)}
    previews = {row['photoId']: row for row in job['photos']}
    frames = load_json(depth_index)
    qa_path = scan_dir / 'derived-v4-photo-ai-fresh/qa/provenance.json'
    qa = load_json(qa_path) if qa_path.is_file() else {}
    inputs = {key: sha256(path) for key, path in (
        ('rawMeshPly', source), ('converted', converted), ('assignments', assignments),
        ('photoIndex', photo_index), ('depthIndex', depth_index), ('photoHints', hints_path),
        ('reviewEvidence', job_path), ('runnerManifest', runner_path), ('baselineProjection', baseline_path))}
    if qa_path.is_file():
        inputs['inheritedQA'] = sha256(qa_path)
    inputs['projectionCode'] = sha256(Path(__file__))
    for name in ('photo_projection.py', 'instance_candidates.py', 'geometry_v1.py'):
        inputs['e15Helper:' + name] = sha256(E15_PIPELINE / name)
    if prompt_corrections:
        inputs['promptCorrections'] = sha256(prompt_corrections)
    proposals = []
    for i in hint_indices:
        hint, row = hints[i], rows[i]
        photo_id = hint['photoId']
        if row['photoId'] != photo_id or photo_id not in photos or photo_id not in previews:
            raise ValueError('mask/photo identity mismatch')
        info, photo = previews[photo_id], photos[photo_id]
        original = (bundle / photo_id).resolve(strict=True)
        preview = (job_dir / info['previewFile']).resolve(strict=True)
        mask_path = (mask_dir / f'hint-{i:04d}.png').resolve(strict=True)
        if (not original.is_relative_to(bundle) or not preview.is_relative_to(job_dir) or
                not mask_path.is_relative_to(mask_dir) or row['maskFile'] != mask_path.name):
            raise ValueError('photo or mask path escaped its input directory')
        for path, expected in ((original, hashes.get('photo:' + photo_id)),
                               (original, info.get('sourceSha256')), (preview, info['previewSha256']),
                               (preview, row['previewSha256']), (mask_path, row['maskSha256'])):
            require_hash(path, expected, 'photo/mask')
        if (info['sensorSize'] != [photo['width'], photo['height']] or
                info['rawIntrinsics'] != photo['intrinsics'] or
                info['rawCameraTransform'] != photo['transform'] or
                info['previewTransform'] != 'sensor rotate clockwise 90 degrees, then thumbnail'):
            raise ValueError('review preview calibration/convention differs from source photo')
        for key in ('bboxNorm', 'positivePointsNorm', 'negativePointsNorm'):
            if key in row and row[key] != hint[key]:
                raise ValueError('runner prompts differ from versioned input')
        image = cv2.imread(str(preview))
        if image is None or [image.shape[1], image.shape[0]] != info['previewSize']:
            raise ValueError('upright preview dimensions mismatch')
        mask = external_mask(mask_path, image.shape[:2])
        match = nearest_depth_frame(photo, frames)
        ids = np.empty(0, dtype=np.int64)
        flags = ['unreviewed-mask-boundary', 'category-unconfirmed', 'no-instance-fusion']
        stats = {}
        depth_file = None
        pose_delta = None
        if match is None:
            flags.append('no-nearby-calibrated-depth-frame')
        else:
            _, frame, delta, translation, angle = match
            depth_map, confidence_map = load_depth_frame(bundle, frame)
            depth_file = frame['file']
            pose_delta = {'seconds': delta, 'translationM': translation, 'angleRad': angle}
            ids, stats = select_mask_faces(mask, centers, photo, frame, depth_map, confidence_map, eligible)
            for relative in (frame['file'], frame['confidence']):
                path = (bundle / relative).resolve(strict=True)
                if not path.is_relative_to(bundle):
                    raise ValueError('depth asset escapes bundle')
                require_hash(path, hashes.get('depth:' + relative), 'matched depth evidence')
                inputs[relative] = sha256(path)
        old_ids = np.asarray(baseline['proposals'][i]['sourceFaceIds'], dtype=np.int64)
        conflicts = ids[existing_owner[ids]]
        if len(conflicts):
            flags.append('overlaps-existing-owner')
        review = inherited_review(i, photo_id, qa)
        if review['reviewRecommendation'] == 'reject-category-claim':
            flags.append('prior-visual-review-rejects-category')
        raw_classes, counts = np.unique(classes[ids], return_counts=True)
        prior_supported = np.isin(classes[ids], FURNITURE_PRIOR_CLASSES)
        if has_classes and not prior_supported.all():
            flags.append('raw-arkit-class-disagrees-with-furniture-prior')
        proposals.append({
            'hintIndex': i, 'photoId': photo_id, 'categoryClaimUnreviewed': hint['category'],
            'reviewState': 'unreviewed', 'ownershipState': 'unchanged-v1',
            'sourceFaceIds': ids.tolist(), 'sourceFaceCount': int(len(ids)),
            'beyondOldConnectedProposalFaceCount': int(len(np.setdiff1d(ids, old_ids))),
            'retainedOldConnectedProposalFaceCount': int(len(np.intersect1d(ids, old_ids))),
            'existingOwnerConflictSourceFaceIds': conflicts.tolist(),
            'existingOwnerConflictFaceCount': int(len(conflicts)),
            'aabbRoomLocalM': bounds_of_faces(vertices_room, np.asarray(mesh.faces), ids),
            'rawArkitClassCounts': {str(int(k)): int(v) for k, v in zip(raw_classes, counts)} if has_classes else None,
            'furniturePriorSourceFaceCount': int(prior_supported.sum()) if has_classes else None,
            'nonFurniturePriorSourceFaceCount': int((~prior_supported).sum()) if has_classes else None,
            'maskSha256': sha256(mask_path), 'depthFrameFile': depth_file, 'depthPoseDelta': pose_delta,
            'reviewFlags': flags, **stats, **review})
    all_ids = np.unique(np.concatenate([np.asarray(row['sourceFaceIds'], dtype=np.int64)
                                       for row in proposals]))
    report = {'schemaVersion': 1, 'algorithmVersion': 'all-source-mask-depth-e18-v1',
              'scanId': scan_dir.name, 'sourceHash': source_hash, 'sourceFaceCount': len(mesh.faces),
              'frame': 'room-local-m', 'transformHash': transform_id,
              'originalOwnerAssignmentsPreserved': True, 'acceptedOwnerCount': 0,
              'instanceAssociation': 'none; categories must not be used as instance identity',
              'rawSemanticClassIsSelectionGate': False, 'sharedEdgeConnectivityIsSelectionGate': False,
              'furniturePriorClassesForComparisonOnly': list(FURNITURE_PRIOR_CLASSES),
              'uniqueCandidateSourceFaceCount': int(len(all_ids)),
              'uniqueExistingOwnerConflictFaceCount': int(existing_owner[all_ids].sum()),
              'protectedBucketLeakCount': int((~eligible[all_ids]).sum()),
              'runnerId': runner['runnerId'], 'modelRepoCommit': runner['modelRepoCommit'],
              'checkpointSha256': runner['checkpointSha256'], 'inputHashes': inputs,
              'warning': 'Visible measured source-face proposals only. More faces do not prove better boundaries. '
                         'Depth tolerance is inherited from E15; this is not a precise occlusion raycast. '
                         'Hidden surfaces and accepted editable voxels are not generated.',
              'elapsedSeconds': round(time.perf_counter() - started, 3), 'proposals': proposals}
    output.mkdir(parents=True)
    import json
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('scan-dir', 'job-dir', 'mask-dir', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--hint-indices', type=int, nargs='+', required=True)
    parser.add_argument('--prompt-corrections', type=Path)
    args = parser.parse_args()
    report = run(args.scan_dir, args.job_dir, args.mask_dir, args.output,
                 args.hint_indices, args.prompt_corrections)
    print(json.dumps({key: report[key] for key in ('scanId', 'uniqueCandidateSourceFaceCount',
          'uniqueExistingOwnerConflictFaceCount', 'protectedBucketLeakCount', 'elapsedSeconds')}))


if __name__ == '__main__':
    main()
