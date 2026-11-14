import unittest
from unittest.mock import patch

import numpy as np

from full_source_projection import select_mask_faces


class FullSourceProjectionTests(unittest.TestCase):
    def test_mask_depth_and_protected_buckets_keep_original_face_ids(self):
        centers = np.zeros((5, 3))
        photo = {'transform': [0] * 16, 'intrinsics': [0] * 9,
                 'width': 4, 'height': 4}
        projected = (np.zeros(5), np.zeros(5), np.ones(5), np.ones(5, bool))
        mask_hits = np.array([True, True, True, False, True])
        supported = np.array([True, False, True, True, True])
        eligible = np.array([True, True, False, True, True])
        with (patch('full_source_projection.project_session_points', return_value=projected),
              patch('full_source_projection.sample_upright_mask', return_value=mask_hits),
              patch('full_source_projection.depth_supported_faces',
                    return_value=(supported, np.zeros(5)))):
            ids, stats = select_mask_faces(np.ones((4, 4)), centers, photo, {},
                                           np.zeros((4, 4)), np.zeros((4, 4)), eligible)
        np.testing.assert_array_equal(ids, [0, 4])
        self.assertEqual(stats['maskProjectedFaceCountBeforeDepthAndStructure'], 4)
        self.assertEqual(stats['depthSupportedMaskFaceCountBeforeStructure'], 3)


if __name__ == '__main__':
    unittest.main()
