import unittest

import numpy as np

from review_mask_components import (PRIVATE, assert_unprotected_candidate_scope,
                                    run, spatial_components, summarize_components)


class ReviewMaskComponentTests(unittest.TestCase):
    def test_distant_background_and_original_ids_remain_separate(self):
        centers = np.array([[0., 0., 0.], [.02, 0., 0.], [.04, 0., 0.],
                            [1., 0., 0.], [1.02, 0., 0.], [3., 0., 0.]])
        components = spatial_components(np.array([5, 2, 1, 4, 0, 3]), centers, .04)
        self.assertEqual([row.tolist() for row in components], [[0, 1, 2], [3, 4], [5]])
        classes = np.array([5, 5, 5, 0, 1, 2])
        buckets = {'unknown': np.array([0, 1, 2, 3]),
                   'one-owner': np.array([4]), 'conflict': np.array([5])}
        photos = {'photos/a.jpg': {0, 1, 3}, 'photos/b.jpg': {1, 2, 4}}
        rows = summarize_components(components, centers, classes, buckets, photos)
        self.assertEqual(rows[0]['sourceFaceCount'], 3)
        self.assertEqual(rows[0]['rawArkitClassCounts'], {'5': 3})
        self.assertEqual(rows[0]['supportedByTwoOrMorePhotosFaceCount'], 1)
        self.assertEqual(rows[0]['existingOwnerConflictFaceCount'], 0)
        self.assertEqual(rows[1]['existingOwnerConflictFaceCount'], 1)
        self.assertEqual(rows[1]['photoSourceFaceCounts'],
                         {'photos/a.jpg': 1, 'photos/b.jpg': 1})

    def test_nonunique_ids_and_unbounded_radius_rejected(self):
        centers = np.zeros((3, 3))
        with self.assertRaises(ValueError):
            spatial_components(np.array([0, 0]), centers, .04)
        with self.assertRaises(ValueError):
            spatial_components(np.array([0]), centers, .5)

    def test_review_output_cannot_touch_scan_source_or_old_derived(self):
        scan = PRIVATE / 'scan-guard-test'
        report = scan / 'derived-v5-full-source-test' / 'report.json'
        for target in (scan / 'source/Room/mesh', scan / 'derived-v1/review',
                       scan / 'derived-v4-photo-ai-fresh/review'):
            with self.assertRaisesRegex(ValueError, 'output must be'):
                run(scan, report, target, 'chair')
        with self.assertRaisesRegex(ValueError, 'input must be'):
            run(scan, scan / 'source/Room/report.json',
                scan / 'derived-v6-review-test', 'chair')

    def test_protected_original_faces_cannot_enter_review_main_cluster(self):
        buckets = {'unknown': np.array([0]), 'structure': np.array([1]),
                   'rejected-noise': np.array([2]), 'excluded': np.array([3])}
        assert_unprotected_candidate_scope(np.array([0]), buckets)
        for face_id in (1, 2, 3):
            with self.assertRaisesRegex(ValueError, 'protected original'):
                assert_unprotected_candidate_scope(np.array([0, face_id]), buckets)


if __name__ == '__main__':
    unittest.main()
