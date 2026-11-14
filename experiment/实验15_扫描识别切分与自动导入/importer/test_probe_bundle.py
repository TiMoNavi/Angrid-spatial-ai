"""Small synthetic ZIPs exercise the preflight without private scans."""

import json
from pathlib import Path
import tempfile
import unittest
import warnings
from zipfile import ZipFile

from probe_bundle import BundleError, probe


def make_zip(directory: Path, rooms=None, extra=None):
    rooms = rooms if rooms is not None else [{"index": 4, "file": "rooms/room-4.json",
                                               "mesh": {"file": "mesh/room-4.ply"}}]
    manifest = {"format": "house-capture/5", "rooms": rooms,
                "photos": "photos/photos.json", "depthFrames": "depth/frames.json",
                "photoCount": 2, "depthFrameCount": 3}
    entries = {"Room/manifest.json": json.dumps(manifest),
               "Room/rooms/room-4.json": json.dumps({"objects": []}),
               "Room/mesh/room-4.ply": "ply\n",
               "Room/photos/photos.json": "{}",
               "Room/depth/frames.json": "{}"}
    entries.update(extra or {})
    path = directory / "input.zip"
    with ZipFile(path, "w") as archive:
        for name, contents in entries.items():
            archive.writestr(name, contents)
    return path


class ProbeBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_keeps_original_nonzero_room_index_and_capabilities(self):
        report = probe(make_zip(self.directory))
        self.assertEqual(report["rooms"][0]["index"], 4)
        self.assertEqual(report["rooms"][0]["rawMeshPly"], "Room/mesh/room-4.ply")
        self.assertFalse(report["capabilities"]["appleRoomBuilderData"])
        self.assertEqual(report["strategy"], "own-ply-photo-depth-segmentation")
        self.assertEqual(report["scanIdSuggestion"], "scan-" + report["zipSha256"][:12])

    def test_raw_room_data_only_when_manifest_and_file_agree(self):
        path = make_zip(self.directory,
                        rooms=[{"index": 4, "file": "rooms/room-4.json",
                                "data": "rooms/room-4-data.json"}],
                        extra={"Room/rooms/room-4-data.json": "{}"})
        report = probe(path)
        self.assertTrue(report["capabilities"]["appleRoomBuilderData"])
        self.assertEqual(report["strategy"], "apple-raw-data-available")

    def test_rejects_missing_manifest_room(self):
        path = make_zip(self.directory, rooms=[{"index": 7, "file": "rooms/room-7.json"}])
        with self.assertRaisesRegex(BundleError, "missing room JSON"):
            probe(path)

    def test_rejects_traversal_or_alias_paths(self):
        for member in ("../escape", "Room/../escape", "Room//alias", "C:/drive"):
            with self.subTest(member=member):
                path = make_zip(self.directory, extra={member: "bad"})
                with self.assertRaises(BundleError):
                    probe(path)

    def test_rejects_case_colliding_entries(self):
        path = make_zip(self.directory, extra={"room/MANIFEST.json": "{}"})
        with self.assertRaisesRegex(BundleError, "case-colliding"):
            probe(path)

    def test_rejects_duplicate_entries(self):
        path = make_zip(self.directory)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with ZipFile(path, "a") as archive:
                archive.writestr("Room/manifest.json", "{}")
        with self.assertRaisesRegex(BundleError, "duplicate"):
            probe(path)

    def test_rejects_zip_without_room_manifest(self):
        path = self.directory / "input.zip"
        with ZipFile(path, "w") as archive:
            archive.writestr("room.json", "{}")
        with self.assertRaisesRegex(BundleError, "room manifest"):
            probe(path)


if __name__ == "__main__":
    unittest.main()
