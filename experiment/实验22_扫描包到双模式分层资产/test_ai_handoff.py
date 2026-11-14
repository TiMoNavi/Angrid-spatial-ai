"""Non-private handoff fixtures: source identity, photo order and no AI claims."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from ai_handoff import digest, prepare_ai_job, sampled_indices, transform_hash


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.scan = self.root / 'test-scan'
        self.bundle = self.scan / 'source/Room'
        (self.bundle / 'photos').mkdir(parents=True)
        (self.bundle / 'mesh').mkdir()
        (self.bundle / 'manifest.json').write_text('{}')
        (self.bundle / 'mesh/room.ply').write_text('ply\nformat ascii 1.0\nelement vertex 0\nend_header\n')
        self.skill = self.root / 'experiment/skill/room-scan-rebuild'
        self.skill.mkdir(parents=True)
        (self.skill / 'SKILL.md').write_text('---\nname: room-scan-rebuild\ndescription: test\n---\n')
        (self.skill / '__pycache__').mkdir()
        (self.skill / '__pycache__/skip.pyc').write_bytes(b'no')
        (self.skill / 'scripts').mkdir()
        (self.skill / 'scripts/builder.py').write_text('pass\n')
        baseline = self.skill.parent.parent / 'skill-baseline/scan-to-threejs'
        baseline.mkdir(parents=True)
        (baseline / 'SKILL.md').write_text('# upstream baseline\n')
        # Intentionally reverse filenames: array order, not filename order, is authoritative.
        photos = []
        for i, name in enumerate(('b.jpg', 'a.jpg')):
            Image.new('RGB', (80, 40), (30 + i * 60, 80, 110)).save(self.bundle / 'photos' / name)
            photos.append({'file': f'photos/{name}', 'position': [i, 1.5, 0],
                           'forward': [0, 0, -1], 'up': [0, 1, 0], 'fovY': 70, 'aspect': .5})
        self.room = {'transform': {'worldToRoom': IDENTITY}, 'objects': [], 'photos': photos}
        self.converted = self.scan / 'converted.json'
        self.converted.write_text(json.dumps(self.room))
        self.manifest = {'scanId': self.scan.name, 'manifestPath': 'source/Room/manifest.json',
                         'converted': {'path': 'converted.json', 'frame': 'room-local-m',
                                       'sha256': digest(self.converted)},
                         'sourceArchive': {'sha256': 'a' * 64},
                         'assetPaths': {'rawMeshPly': 'source/Room/mesh/room.ply'},
                         'sourceFiles': {}}
        for path in self.bundle.rglob('*'):
            if path.is_file():
                relative = path.relative_to(self.scan).as_posix()
                self.manifest['sourceFiles'][relative] = {'path': relative, 'sha256': digest(path)}
        self.save_manifest()
        self.output = self.root / 'job'

    def tearDown(self):
        self.temp.cleanup()

    def save_manifest(self):
        (self.scan / 'import-manifest.json').write_text(json.dumps(self.manifest))

    def run_job(self):
        return prepare_ai_job(self.scan, self.output, self.skill)

    def test_real_job_preserves_order_pose_upright_and_source(self):
        before = {str(p): digest(p) for p in self.scan.rglob('*') if p.is_file()}
        job = self.run_job()
        self.assertEqual(job['status'], 'awaiting-ai-plan')
        self.assertIs(job['aiInvoked'], False)
        self.assertIs(job['ownerAcceptanceBlocked'], True)
        self.assertEqual(job['transformHash'], transform_hash(IDENTITY))
        index = json.loads((self.output / 'photo-index.json').read_text())
        self.assertEqual([p['converted']['file'] for p in index['photos']], ['photos/b.jpg', 'photos/a.jpg'])
        self.assertEqual(index['photos'][1]['converted']['position'], [1, 1.5, 0])
        self.assertEqual(index['photos'][0]['hashVerification'], 'verified-file')
        with Image.open(self.output / 'photos/0000.jpg') as image:
            self.assertEqual(image.size, (40, 80))
        self.assertTrue((self.output / 'contact.jpg').is_file())
        self.assertEqual((self.output / 'room.json').read_bytes(), self.converted.read_bytes())
        self.assertTrue((self.output / 'skill/room-scan-rebuild/scripts/builder.py').is_file())
        self.assertFalse((self.output / 'skill/room-scan-rebuild/__pycache__').exists())
        self.assertTrue((self.output / 'skill-baseline/scan-to-threejs/SKILL.md').is_file())
        self.assertFalse((self.output / 'voxel-plan.json').exists())
        self.assertEqual(before, {str(p): digest(p) for p in self.scan.rglob('*') if p.is_file()})

    def test_refuses_existing_and_dangling_symlink(self):
        self.output.mkdir()
        with self.assertRaises(FileExistsError):
            self.run_job()
        self.output.rmdir()
        self.output.symlink_to(self.root / 'missing')
        with self.assertRaises(FileExistsError):
            self.run_job()

    def test_changed_ply_is_rejected_without_partial_output(self):
        (self.bundle / 'mesh/room.ply').write_text('modified')
        with self.assertRaisesRegex(ValueError, 'PLY hash'):
            self.run_job()
        self.assertFalse(self.output.exists())

    def test_changed_converted_is_rejected(self):
        self.converted.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'converted JSON hash'):
            self.run_job()

    def test_changed_photo_is_rejected(self):
        Image.new('RGB', (2, 2)).save(self.bundle / 'photos/b.jpg')
        with self.assertRaisesRegex(ValueError, 'photo 0 hash'):
            self.run_job()

    def test_traversal_and_symlink_photo_are_rejected(self):
        original = copy.deepcopy(self.room)
        for reference in ('../../../outside.jpg', '/tmp/outside.jpg', 'photos\\outside.jpg'):
            self.room['photos'][0]['file'] = reference
            self.converted.write_text(json.dumps(self.room))
            self.manifest['converted']['sha256'] = digest(self.converted)
            self.save_manifest()
            with self.assertRaises(ValueError):
                self.run_job()
        self.room = original
        self.room['photos'][0]['file'] = 'photos/escape.jpg'
        (self.bundle / 'photos/escape.jpg').symlink_to(self.root / 'outside.jpg')
        Image.new('RGB', (3, 3)).save(self.root / 'outside.jpg')
        self.converted.write_text(json.dumps(self.room))
        self.manifest['converted']['sha256'] = digest(self.converted)
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.run_job()

    def test_bad_grid_and_nonrigid_transform_are_rejected(self):
        derived = self.scan / 'derived-v1'
        derived.mkdir()
        grid = {'frame': 'room-local-m', 'grids': {'0.05': {'stepM': .05,
                'originM': [1, 0, 0], 'cellEncoding': 'index-xyz'}}}
        (derived / 'furniture-grid.json').write_text(json.dumps(grid))
        with self.assertRaisesRegex(ValueError, 'grid'):
            self.run_job()
        bad = IDENTITY[:]
        bad[0] = 2
        with self.assertRaisesRegex(ValueError, 'rigid'):
            transform_hash(bad)

    def test_sample_is_bounded_and_covers_ends(self):
        indices = sampled_indices(206)
        self.assertEqual(len(indices), 12)
        self.assertEqual((indices[0], indices[-1]), (0, 205))
        self.assertEqual(indices, sorted(set(indices)))
        self.assertEqual(sampled_indices(0), [])


if __name__ == '__main__':
    unittest.main()
