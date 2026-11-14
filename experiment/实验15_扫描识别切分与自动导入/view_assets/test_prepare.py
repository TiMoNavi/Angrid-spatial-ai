#!/usr/bin/env python3
"""Tiny, deterministic checks for measured-view assets."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import trimesh

from prepare import PRIVATE, derive, pack_grid, surface_cells


PLY = """ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property uchar inroom
element face 2
property list uchar int vertex_indices
end_header
0 0 0 255 0 0 1
0.1 0 0 255 0 0 1
0 0 0.1 255 0 0 1
0.1 0 0.1 0 0 255 0
3 0 1 2
3 1 3 2
"""


class ViewAssetTests(unittest.TestCase):
    def test_surface_cells_are_nested_and_not_solid_volume(self):
        vertices = np.array([[0, 0, 0], [0.1, 0, 0], [0, 0, 0.1]], dtype=float)
        faces = np.array([[0, 1, 2]])
        fine = surface_cells(vertices, faces)
        self.assertGreater(len(fine), 0)
        self.assertLess(len(fine), 200)
        coarse = pack_grid(fine, 0.2)
        self.assertEqual(coarse["surfaceCells"], 1)
        self.assertEqual(pack_grid(fine, 0.025)["surfaceCells"], len(fine))

    def test_derive_filters_inroom_and_keeps_source_immutable(self):
        PRIVATE.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=PRIVATE, prefix="e15-view-test-") as folder:
            scan = Path(folder)
            raw = scan / "source/Room/mesh/room-0.ply"
            raw.parent.mkdir(parents=True)
            raw.write_text(PLY, encoding="ascii")
            (scan / "converted.json").write_text(json.dumps({
                "transform": {"worldToRoom": [1, 0, 0, 0, 0, 1, 0, 0,
                                               0, 0, 1, 0, 1, 0, 0, 1]}}))
            before = raw.read_bytes()
            result = derive(scan, raw)
            self.assertEqual(raw.read_bytes(), before)
            self.assertEqual(result["sourceFaceCount"], 2)
            self.assertEqual(result["inroomSourceFaceCount"], 1)
            view = trimesh.load(scan / "mesh-voxels/raw-room.ply", process=False)
            self.assertEqual(len(view.faces), 1)
            self.assertGreaterEqual(float(view.bounds[0, 0]), 0.999)
            cache = json.loads((scan / "mesh-surface-grids.json").read_text())
            self.assertEqual(cache["sources"]["ply"]["viewTriangles"], 1)


if __name__ == "__main__":
    unittest.main()
