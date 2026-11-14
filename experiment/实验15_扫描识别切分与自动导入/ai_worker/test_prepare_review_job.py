"""Synthetic checks for bounded, provenance-preserving photo job preparation."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from ai_worker.prepare_review_job import prepare_review_job


class PrepareReviewJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="e15-prepare-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / ".private"
        self.private.mkdir()
        self.bundle = self.root / "bundle"
        (self.bundle / "photos").mkdir(parents=True)
        self.photo_id = "photos/0001.jpg"
        self.photo = self.bundle / self.photo_id
        Image.new("RGB", (400, 300), "blue").save(self.photo)
        (self.bundle / "photos/photos.json").write_text(json.dumps([
            {"file": self.photo_id, "width": 400, "height": 300,
             "intrinsics": [1] * 9, "transform": [1] * 16}]))
        self.converted = self.root / "converted.json"
        self.converted.write_text(json.dumps({"photos": [{
            "file": self.photo_id, "position": [1, 2, 3], "forward": [0, 0, -1],
            "up": [0, 1, 0], "fovY": 70, "aspect": 0.75}]}))
        self.output = self.private / "job"

    def prepare(self, **kwargs):
        params = dict(bundle=self.bundle, converted=self.converted,
                      output=self.output, indices=[0], scan_id="synthetic",
                      private_root=self.private)
        params.update(kwargs)
        return prepare_review_job(**params)

    def test_one_upright_photo_retains_original_id_pose_and_source_hash(self):
        before = hashlib.sha256(self.photo.read_bytes()).hexdigest()
        manifest = self.prepare()
        evidence = json.loads((self.output / "evidence.json").read_text())
        entry = evidence["photos"][0]
        self.assertEqual(manifest["selectedPhotoCount"], 1)
        self.assertEqual(entry["photoId"], self.photo_id)
        self.assertEqual(entry["sourceSha256"], before)
        self.assertEqual(entry["convertedPose"]["position"], [1, 2, 3])
        self.assertEqual(entry["rawIntrinsics"], [1] * 9)
        self.assertEqual(hashlib.sha256(self.photo.read_bytes()).hexdigest(), before)
        with Image.open(self.output / entry["previewFile"]) as preview:
            self.assertEqual(preview.size, (300, 400))
        self.assertTrue((self.output / "skill-baseline/scan-to-threejs/SKILL.md").is_file())
        self.assertTrue((self.output / ".agents/skills/scan-to-instance-proposals/SKILL.md").is_file())

    def test_refuses_unbounded_or_public_output(self):
        with self.assertRaises(ValueError):
            self.prepare(indices=list(range(13)))
        with self.assertRaises(ValueError):
            prepare_review_job(bundle=self.bundle, converted=self.converted,
                               output=self.root / "public-job", indices=[0],
                               scan_id="synthetic", private_root=self.private)

    def test_refuses_photo_path_escape(self):
        outside = self.root / "outside.jpg"
        Image.new("RGB", (4, 4)).save(outside)
        self.converted.write_text(json.dumps({"photos": [{"file": "../outside.jpg"}]}))
        (self.bundle / "photos/photos.json").write_text(json.dumps([
            {"file": "../outside.jpg"}]))
        with self.assertRaises(ValueError):
            self.prepare()

    def test_refuses_unposed_selected_photo(self):
        (self.bundle / "photos/photos.json").write_text(json.dumps([
            {"file": self.photo_id, "width": 400, "height": 300,
             "intrinsics": None, "transform": [1] * 16}]))
        with self.assertRaises(ValueError):
            self.prepare()


if __name__ == "__main__":
    unittest.main()
