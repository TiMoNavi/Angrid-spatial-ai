import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import run_pipeline as pipeline

sys.path.insert(0, str(Path(__file__).resolve().parent / 'pipeline'))
from geometry_v1 import transform_hash
from floor_plan import build_model_candidates, render_svg
from package_layers import package, sha, verify_manifest


MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def put(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return path


def scan_fixture(root):
    scan = root / 'test-scan'
    scan.mkdir()
    source = scan / 'source/Room/mesh/room-0.ply'
    source.parent.mkdir(parents=True)
    source.write_text('original source, 100 faces in fixture ledger')
    converted = {'transform': {'worldToRoom': MATRIX}, 'polygon': [[0, 0], [2, 0], [2, 2]],
                 'walls': [], 'objects': [], 'photos': []}
    put(scan, 'converted.json', converted)
    put(scan, 'mesh-surface-grids.json', {'sources': {'ply': {'grids': {}}}})
    display = scan / 'mesh-voxels/raw-room.ply'
    display.parent.mkdir()
    display.write_text('different cropped display geometry, no source ordinal promise')
    put(scan, pipeline.LEDGER_DIR + '/instance-ledger.json', {})
    put(scan, 'derived-v1/face-assignments.json', {})
    put(scan, 'derived-v1/segment-report.json', {'scanId': scan.name,
        'transformHash': transform_hash(MATRIX), 'sourceFaces': 100, 'objects': []})
    entries = []
    for identifier in ('clean-structure-grid', 'furniture-classified-grid',
                       'furniture-corrected-grid', 'conflict-grid', 'unknown-grid',
                       'clutter-candidate-grid'):
        available = identifier != 'clutter-candidate-grid'
        name = identifier + '.json'
        if available:
            put(scan, 'derived-v1/' + name, {'grids': {'0.05': {
                'stepM': .05, 'originM': [0, 0, 0], 'cellEncoding': 'index-xyz'}}})
        entries.append({'id': identifier, 'kind': identifier, 'available': available,
                        'geometryUri': name if available else None,
                        'provenance': 'measured', 'recordCount': 0})
    # Identity validation uses the editor's existing furniture-grid filename.
    put(scan, 'derived-v1/furniture-grid.json', {'grids': {'0.05': {
        'stepM': .05, 'originM': [0, 0, 0], 'cellEncoding': 'index-xyz'}}})
    put(scan, 'derived-v1/layer-manifest.json', {
        'transformHash': transform_hash(MATRIX), 'layers': entries})
    put(scan, 'import-manifest.json', {'scanId': scan.name, 'roomIndex': 0,
         'assetPaths': {'rawMeshPly': 'source/Room/mesh/room-0.ply', 'photoIndex': None,
                        'depthIndex': None}, 'sourceArchive': {'sha256': 'a' * 64},
         'converted': {'sha256': sha(scan / 'converted.json')},
         'sourceMeshFrame': 'capture-session-world-m',
         'photoIndex': {'availableEntries': 0}, 'depthIndex': {'availableEntries': 0}})
    return scan, source


def plan_fixture(scan, source):
    return {'schemaVersion': 1, 'scanId': scan.name, 'frame': 'room-local-m',
            'transformHash': transform_hash(MATRIX), 'sourcePlySha256': sha(source),
            'grid': {'stepM': .05, 'originM': [0, 0, 0]},
            'instances': [{'instanceId': 'candidate-chair', 'parts': [{
                'partId': 'seat', 'role': 'seat', 'geometryState': 'model-inferred',
                'photoEvidence': [], 'kind': 'gridBox', 'minCell': [0, 0, 0],
                'sizeCells': [2, 1, 2]}]}]}


class PipelineTests(unittest.TestCase):
    def test_all_processing_paths_are_local_copies(self):
        for path in (pipeline.IMPORTER, pipeline.CLASSIFIER, pipeline.VIEW,
                     pipeline.INSTANCES, pipeline.BUILDER, pipeline.BINDER):
            self.assertTrue(path.is_relative_to(pipeline.HERE))
            self.assertTrue(path.is_file())

    def test_existing_stage_requires_explicit_verified_adoption(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            with patch.object(pipeline, 'inputs', return_value={'source': 'same'}), \
                    patch.object(pipeline, 'execute') as execute:
                with self.assertRaisesRegex(pipeline.PipelineError, 'adopt-existing'):
                    pipeline.stage(state={'stages': {}}, scan=scan, name='instances',
                                   source=scan / 'source', roomplan=scan / 'room', exists=True,
                                   command=['never'], verify=lambda: None, adopt=False)
                execute.assert_not_called()

    def test_resume_refuses_changed_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            output = scan / pipeline.LEDGER_DIR / 'instance-ledger.json'
            output.parent.mkdir()
            output.write_text('first')
            before = pipeline.outputs('instances', scan)
            output.write_text('changed')
            state = {'stages': {'instances': {'inputs': {'source': 'same'}, 'outputs': before}}}
            with patch.object(pipeline, 'inputs', return_value={'source': 'same'}), \
                    patch.object(pipeline, 'execute') as execute:
                with self.assertRaisesRegex(pipeline.PipelineError, 'checkpoint differs'):
                    pipeline.stage(state=state, scan=scan, name='instances',
                                   source=scan / 'source', roomplan=scan / 'room', exists=True,
                                   command=['never'], verify=lambda: None, adopt=True)
                execute.assert_not_called()

    def test_source_path_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            (scan / 'source/Room').mkdir(parents=True)
            (scan / 'escape.ply').write_text('outside source')
            with self.assertRaises(pipeline.PipelineError):
                pipeline.asset(scan, {'assetPaths': {'rawMeshPly': 'source/Room/../../escape.ply'}}, 'rawMeshPly')

    def test_scan_mode_rejects_model_plan_before_touching_zip(self):
        with self.assertRaisesRegex(pipeline.PipelineError, 'requires --mode'):
            pipeline.run(Path('not-read.zip'), 'test', None, mode='scan-evidence', voxel_plan=Path('plan'))

    def test_partial_model_does_not_silently_fall_back_to_awaiting(self):
        with tempfile.TemporaryDirectory() as directory:
            scan = Path(directory)
            state = {'stages': {}}
            self.assertIsNone(pipeline.existing_model_plan(scan, state))
            (scan / pipeline.MODEL_DIR).mkdir()
            with self.assertRaisesRegex(pipeline.PipelineError, 'partial'):
                pipeline.existing_model_plan(scan, state)
            snapshot = scan / pipeline.MODEL_DIR / 'voxel-plan.json'
            snapshot.write_text('{}')
            self.assertEqual(pipeline.existing_model_plan(scan, state), snapshot)

    def test_plan_checks_source_transform_grid_and_photo_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, source = scan_fixture(Path(directory))
            original = plan_fixture(scan, source)
            path = put(scan, 'plan.json', original)
            pipeline.validate_plan_identity(path, scan, source)
            for field, wrong in [('scanId', 'different-scan'), ('sourcePlySha256', 'b' * 64),
                                 ('transformHash', 'c' * 64)]:
                put(scan, 'plan.json', {**original, field: wrong})
                with self.assertRaisesRegex(pipeline.PipelineError, 'different scan'):
                    pipeline.validate_plan_identity(path, scan, source)
            put(scan, 'plan.json', {**original, 'grid': {'stepM': .1, 'originM': [0, 0, 0]}})
            with self.assertRaisesRegex(pipeline.PipelineError, 'grid differs'):
                pipeline.validate_plan_identity(path, scan, source)

    def test_scan_manifest_retains_sources_and_unavailable_derived_layers(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, source = scan_fixture(Path(directory))
            before = sha(source)
            path = package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            manifest = verify_manifest(scan, path)
            layers = {row['id']: row for row in manifest['layers']}
            self.assertEqual(manifest['sourceFaceCount'], 100)
            self.assertEqual(len(manifest['viewPresets']['scan-evidence']['coreLayerIds']), 9)
            for identifier in ('tsdf-fused-mesh', 'depth-projected-points', 'gaussian-splat', 'clutter-candidate-grid'):
                self.assertFalse(layers[identifier]['available'])
                self.assertIsNone(layers[identifier]['geometryUri'])
            for identifier in ('furniture-obb', 'furniture-slices', 'furniture-aabb'):
                self.assertFalse(layers[identifier]['available'])
            self.assertNotEqual(layers['raw-lidar-ply']['sha256'], before)
            self.assertEqual(layers['raw-lidar-ply']['sourcePlySha256'], before)
            self.assertFalse(layers['raw-lidar-ply']['displayFaceOrdinalsAreSourceFaceIds'])
            self.assertEqual(before, sha(source))
            self.assertEqual(layers['floor-plan-data']['dataUri'], 'floor-plan.json')
            self.assertEqual(layers['floor-plan-preview']['dataUri'], 'floor-plan.svg')
            self.assertEqual(manifest['floorPlan']['dataSha256'], sha(scan / 'floor-plan.json'))
            self.assertEqual(manifest['floorPlan']['previewSha256'], sha(scan / 'floor-plan.svg'))
            self.assertEqual(json.loads((scan / 'floor-plan.json').read_text())['polygon'],
                             json.loads((scan / 'converted.json').read_text())['polygon'])

    def test_model_mode_without_plan_advertises_no_fake_model(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, _ = scan_fixture(Path(directory))
            path = package(scan, 'model-voxel', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            manifest = verify_manifest(scan, path)
            self.assertEqual(manifest['status'], 'awaiting-ai-plan')
            model = [row for row in manifest['layers'] if row['id'] in (
                'reconstructed-model', 'model-voxel-grid', 'model-evidence-overlay')]
            self.assertEqual(len(model), 3)
            self.assertTrue(all(not row['available'] for row in model))

    def test_layer_manifest_rejects_tampered_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, _ = scan_fixture(Path(directory))
            path = package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            (scan / 'mesh-voxels/raw-room.ply').write_text('tampered')
            with self.assertRaisesRegex(ValueError, 'hash differs'):
                verify_manifest(scan, path)

    def test_layer_manifest_rejects_tampered_floor_plan_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, _ = scan_fixture(Path(directory))
            path = package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            (scan / 'floor-plan.svg').write_text('<svg/>')
            with self.assertRaisesRegex(ValueError, 'floor-plan geometry or preview'):
                verify_manifest(scan, path)
            with self.assertRaisesRegex(ValueError, 'floor-plan output changed'):
                package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)

    def test_collection_mesh_hashes_are_verified_individually(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, _ = scan_fixture(Path(directory))
            fragment = scan / 'derived-v1/object-00-chair.ply'
            fragment.write_text('observed chair fragment')
            converted = json.loads((scan / 'converted.json').read_text())
            converted['objects'] = [{'category': 'chair', 'center': [1, .5, 1],
                                     'size': [1, 1, 1], 'rotY': 0}]
            put(scan, 'converted.json', converted)
            imported = json.loads((scan / 'import-manifest.json').read_text())
            imported['converted']['sha256'] = sha(scan / 'converted.json')
            put(scan, 'import-manifest.json', imported)
            put(scan, 'derived-v1/segment-report.json', {'scanId': scan.name,
                'transformHash': transform_hash(MATRIX), 'sourceFaces': 100, 'objects': [{
                'convertedIndex': 0, 'sourceIdentifier': 'chair-raw',
                'objectId': 'test-scan:chair', 'category': 'chair', 'faceCount': 1,
                'sourceFaceIds': [0], 'meshUri': fragment.name,
                'aabb': {'min': [0, 0, 0], 'max': [1, 1, 1]}}]})
            path = package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            verify_manifest(scan, path)
            fragment.write_text('changed fragment')
            with self.assertRaisesRegex(ValueError, 'collection asset hash differs'):
                verify_manifest(scan, path)

    def test_layer_manifest_rejects_asset_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scan, _ = scan_fixture(root)
            path = package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            display = scan / 'mesh-voxels/raw-room.ply'
            external = root / 'external.ply'
            external.write_bytes(display.read_bytes())
            display.unlink()
            display.symlink_to(external)
            with self.assertRaisesRegex(ValueError, 'escaped'):
                verify_manifest(scan, path)

    def test_floor_plan_keeps_roomplan_object_ids_without_reinterpreting_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            scan, _ = scan_fixture(Path(directory))
            converted = json.loads((scan / 'converted.json').read_text())
            converted['objects'] = [{'category': 'chair', 'center': [1, .5, 1],
                                     'size': [.6, 1, .7], 'rotY': .25}]
            put(scan, 'converted.json', converted)
            imported = json.loads((scan / 'import-manifest.json').read_text())
            imported['converted']['sha256'] = sha(scan / 'converted.json')
            put(scan, 'import-manifest.json', imported)
            report = json.loads((scan / 'derived-v1/segment-report.json').read_text())
            report['objects'] = [{'convertedIndex': 0, 'objectId': 'test-scan:chair-uuid',
                                  'sourceIdentifier': 'chair-uuid', 'category': 'chair',
                                  'mappingState': 'verified'}]
            put(scan, 'derived-v1/segment-report.json', report)
            path = package(scan, 'scan-evidence', pipeline.LEDGER_DIR, pipeline.MODEL_DIR, pipeline.EVIDENCE_DIR)
            verify_manifest(scan, path)
            plan = json.loads((scan / 'floor-plan.json').read_text())
            self.assertEqual(plan['objects'], converted['objects'])
            self.assertEqual(plan['objectRefs'], [{'convertedIndex': 0,
                'objectId': 'test-scan:chair-uuid', 'sourceIdentifier': 'chair-uuid',
                'category': 'chair', 'mappingState': 'verified',
                'provenance': 'roomplan-inferred', 'reviewState': 'unreviewed'}])
            self.assertIn('data-object-id="test-scan:chair-uuid"', render_svg(plan))
            self.assertEqual(plan['transformHash'], transform_hash(MATRIX))

    def test_model_floor_plan_candidates_keep_exact_cells_and_inferred_state(self):
        plan = {'scanId': 'scan-1', 'transformHash': transform_hash(MATRIX),
                'sourcePlySha256': 'a' * 64}
        occupancy = {'scanId': 'scan-1', 'transformHash': transform_hash(MATRIX),
                     'sourcePlySha256': 'a' * 64, 'frame': 'room-local-m',
                     'planSha256': 'b' * 64,
                     'grid': {'stepM': .1, 'originM': [0, 0, 0], 'cellEncoding': 'index-xyz'},
                     'instances': [{'instanceId': 'chair-1', 'categoryClaim': 'chair', 'label': 'chair'}],
                     'cells': [{'indexXYZ': [2, 0, 3], 'candidateInstanceIds': ['chair-1']},
                               {'indexXYZ': [2, 1, 3], 'candidateInstanceIds': ['chair-1']},
                               {'indexXYZ': [4, 0, 3], 'candidateInstanceIds': ['chair-1']}]}
        result = build_model_candidates(plan, occupancy, 'c' * 64)
        candidate = result['candidates'][0]
        self.assertEqual(candidate['occupiedXZ'], [[2, 3], [4, 3]])
        self.assertEqual(candidate['footprintBoundsM'], {'min': [.2, .3], 'max': [.5, .4]})
        self.assertEqual(candidate['heightRangeM'], [0, .2])
        self.assertEqual(candidate['reviewState'], 'unreviewed')
        self.assertTrue(candidate['ownerAcceptanceBlocked'])
        occupancy['cells'][0]['candidateInstanceIds'] = ['unknown-instance']
        with self.assertRaisesRegex(ValueError, 'unknown instance ID'):
            build_model_candidates(plan, occupancy, 'c' * 64)


if __name__ == '__main__':
    unittest.main()
