import io
from pathlib import Path
import sys
import unittest

import numpy as np
from PIL import Image
import trimesh

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'voxel'))
import voxel_plan_builder as builder
import render_voxel_overlay as overlay
from test_voxel_plan_builder import plan


class ProjectionTests(unittest.TestCase):
    def photo(self):
        return {'position': [0, 0, 0], 'forward': [0, 0, -1], 'up': [0, 1, 0],
                'fovY': 60, 'aspect': 1}

    def test_camera_projects_right_and_up_without_mirroring(self):
        position, basis = overlay.camera(self.photo())
        view = overlay.view_points(np.array([[.5, .5, -2.]]), position, basis)
        pixel = overlay.project(view, 60, 200, 200)[0]
        self.assertGreater(pixel[0], 100)
        self.assertLess(pixel[1], 100)

    def test_clipping_near_plane_produces_front_triangles(self):
        faces = overlay.clip_near(np.array([[0, 0, -.1], [0, 0, .5], [.5, 0, .5]]))
        self.assertEqual(len(faces), 2)
        self.assertTrue(all(np.min(face[:, 2]) >= .03 - 1e-10 for face in faces))

    def test_voxel_model_renders_and_wire_is_visible(self):
        value = plan()
        value['grid']['originM'] = [0, 0, 0]
        value['instances'][0]['parts'][0].update(minCell=[-1, -1, -21], sizeCells=[2, 2, 2])
        occupancy, _, glb = builder.build_artifacts(value)
        scene = trimesh.load(io.BytesIO(glb), file_type='glb', force='scene', process=False)
        photo = Image.new('RGB', (240, 240), '#333333')
        composite, model_only, result = overlay.render_one(
            scene, occupancy, self.photo(), photo, 240, .5,
            overlay.rgb('#44d8c4'), overlay.rgb('#fff7db'))
        self.assertGreater(result['modelPixelCount'], 100)
        self.assertGreater(result['visibleWirePixelCount'], 0)
        self.assertIsNotNone(result['modelPixelBoundsXYXY'])
        self.assertNotEqual(composite.getpixel((120, 120)), photo.getpixel((120, 120)))
        self.assertEqual(model_only.size, photo.size)


if __name__ == '__main__':
    unittest.main()
