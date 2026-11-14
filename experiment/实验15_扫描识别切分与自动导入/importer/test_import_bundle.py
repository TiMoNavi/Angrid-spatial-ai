"""General import tests use synthetic captures and no personal scan payloads."""

import json
from pathlib import Path
import tempfile
import unittest

from import_bundle import import_bundle
from probe_bundle import BundleError, sha256
from test_probe_bundle import make_zip


class ImportBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private = self.root / ".private"

    def test_import_preserves_source_and_nonzero_room_index(self):
        zip_file = make_zip(self.root, extra={
            "Room/photos/photos.json": "[]", "Room/depth/frames.json": "[]"})
        source_sha = sha256(zip_file)
        result = import_bundle(zip_file, "example-4", private_root=self.private)
        dest = self.private / "example-4"
        self.assertEqual(result["roomIndex"], 4)
        self.assertEqual(result["sourceArchive"]["sha256"], source_sha)
        self.assertEqual(sha256(dest / "source-archive.zip"), source_sha)
        self.assertEqual(result["assetPaths"]["rawMeshPly"], "source/Room/mesh/room-4.ply")
        self.assertEqual((dest / result["assetPaths"]["rawMeshPly"]).read_bytes(), b"ply\n")
        self.assertEqual(result["sourceMeshFrame"], "capture-session-world-m")
        self.assertFalse(result["capabilities"]["posedPhotos"])
        self.assertFalse(result["capabilities"]["depthFrames"])
        self.assertEqual(result["converted"]["status"], "unavailable")
        self.assertEqual(sha256(zip_file), source_sha)
        self.assertEqual(import_bundle(zip_file, "example-4", private_root=self.private), result)

    def test_copied_skill_converts_a_valid_nonzero_room(self):
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        room = {"walls": [{"identifier": "wall-1", "transform": identity,
                           "dimensions": [4, 2.5, 0.1], "confidence": {"high": {}}}],
                "floors": [], "objects": [], "doors": [], "windows": [], "openings": []}
        zip_file = make_zip(self.root, extra={
            "Room/rooms/room-4.json": json.dumps(room),
            "Room/photos/photos.json": "[]", "Room/depth/frames.json": "[]"})
        result = import_bundle(zip_file, "example-room", private_root=self.private)
        self.assertEqual(result["converted"]["status"], "available")
        converted = json.loads((self.private / "example-room" / "converted.json").read_text())
        self.assertEqual(len(converted["transform"]["worldToRoom"]), 16)
        self.assertEqual(len(converted["walls"]), 1)
        self.assertEqual(result["roomIndex"], 4)

    def test_global_ply_is_used_when_room_has_no_mesh_reference(self):
        manifest = {"format": "house-capture/5",
                    "rooms": [{"index": 4, "file": "rooms/room-4.json"}],
                    "mesh": {"file": "mesh/room-4.ply"},
                    "photos": "photos/photos.json", "depthFrames": "depth/frames.json"}
        zip_file = make_zip(self.root, extra={"Room/manifest.json": json.dumps(manifest)})
        result = import_bundle(zip_file, "global-mesh", private_root=self.private)
        self.assertTrue(result["capabilities"]["rawMeshPly"])
        self.assertEqual(result["assetPaths"]["rawMeshPly"], "source/Room/mesh/room-4.ply")

    def test_rejects_zip_traversal_and_scan_id_escape(self):
        zip_file = make_zip(self.root, extra={"Room/../escape.txt": "bad"})
        with self.assertRaises(BundleError):
            import_bundle(zip_file, "unsafe-zip", private_root=self.private)
        self.assertFalse((self.private / "unsafe-zip").exists())
        with self.assertRaises(BundleError):
            import_bundle(zip_file, "../escape", private_root=self.private)
        self.assertFalse((self.root / "escape").exists())

    def test_scan_id_cannot_be_reused_for_different_zip(self):
        first = make_zip(self.root, extra={"Room/photos/photos.json": "[]",
                                           "Room/depth/frames.json": "[]"})
        import_bundle(first, "same-id", private_root=self.private)
        other = self.root / "other"
        other.mkdir()
        changed = make_zip(other, extra={"Room/mesh/room-4.ply": "different",
                                          "Room/photos/photos.json": "[]",
                                          "Room/depth/frames.json": "[]"})
        with self.assertRaisesRegex(BundleError, "different import"):
            import_bundle(changed, "same-id", private_root=self.private)

    def test_repeat_import_detects_tampered_extracted_asset(self):
        zip_file = make_zip(self.root, extra={"Room/photos/photos.json": "[]",
                                               "Room/depth/frames.json": "[]"})
        import_bundle(zip_file, "tamper", private_root=self.private)
        target = self.private / "tamper" / "source" / "Room" / "mesh" / "room-4.ply"
        target.write_bytes(b"changed")
        with self.assertRaisesRegex(BundleError, "altered source assets"):
            import_bundle(zip_file, "tamper", private_root=self.private)


if __name__ == "__main__":
    unittest.main()
