import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from mask_trial import external_mask, grabcut_mask, inherited_review, prompt_pixels, require_hash, sample_upright_mask, sha256
from mobile_sam_masks import corrected_hints


class MaskTrialTests(unittest.TestCase):
    def test_prompt_pixels_preserves_upright_normalization(self):
        hint = {'bboxNorm': [0.25, 0.1, 0.75, 0.9],
                'positivePointsNorm': [[0.5, 0.5]],
                'negativePointsNorm': [[0.1, 0.1]]}
        box, positive, negative = prompt_pixels(hint, 80, 60)
        self.assertEqual(box, (20, 6, 60, 54))
        self.assertEqual(positive, [(40, 30)])
        self.assertEqual(negative, [(8, 6)])

    def test_grabcut_filters_distinct_foreground_inside_prompt(self):
        image = np.full((80, 80, 3), 50, dtype=np.uint8)
        image[20:60, 20:60] = [30, 30, 220]
        hint = {'bboxNorm': [0.15, 0.15, 0.85, 0.85],
                'positivePointsNorm': [[0.5, 0.5]],
                'negativePointsNorm': [[0.08, 0.08]]}
        mask = grabcut_mask(image, hint, iterations=3)
        self.assertGreater(mask[25:55, 25:55].mean(), 0.9)
        self.assertEqual(int(mask[:10, :10].sum()), 0)

    def test_original_sensor_to_upright_mask_sampling(self):
        mask = np.zeros((4, 6), dtype=np.uint8)
        mask[2, 3] = 1
        result = sample_upright_mask(mask, np.array([2., 1., 2.]),
                                      np.array([3., 1., 3.]),
                                      4, 6, np.array([True, True, False]))
        self.assertEqual(result.tolist(), [True, False, False])

    def test_external_model_mask_requires_binary_and_same_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mask.png'
            cv2.imwrite(str(path), np.full((8, 6), 128, dtype=np.uint8))
            with self.assertRaises(ValueError):
                external_mask(path, (8, 6))
            cv2.imwrite(str(path), np.full((8, 6), 255, dtype=np.uint8))
            with self.assertRaises(ValueError):
                external_mask(path, (6, 8))
            self.assertEqual(int(external_mask(path, (8, 6)).sum()), 48)

    def test_inherited_reject_is_not_overridden_by_mask_score_or_count(self):
        qa = {'visualReviewWarnings': [
            {'hintIndex': 17, 'photoId': 'photos/9.jpg',
             'issue': 'overlaps chair; do not accept as table'},
            {'hintIndex': 18, 'photoId': 'photos/10.jpg',
             'reviewRecommendation': 'reject-category-claim', 'issue': 'wrong category'}]}
        for index, photo in [(17, 'photos/9.jpg'), (18, 'photos/10.jpg')]:
            row = inherited_review(index, photo, qa)
            self.assertEqual(row['reviewRecommendation'], 'reject-category-claim')
            self.assertTrue(row['ownerAcceptanceBlocked'])
        # Identity matters; an unrelated photo must not inherit this rejection.
        unrelated = inherited_review(17, 'photos/other.jpg', qa)
        self.assertEqual(unrelated['reviewRecommendation'], 'review-mask-and-category')
        self.assertTrue(unrelated['ownerAcceptanceBlocked'])

    def test_correction_keeps_original_prompt_and_requires_matching_job(self):
        hint = {'photoId': 'photos/9.jpg', 'category': 'chair',
                'bboxNorm': [0.1, 0.1, 0.9, 0.9],
                'positivePointsNorm': [[0.5, 0.5]], 'negativePointsNorm': []}
        correction = {'schemaVersion': 1, 'scanId': 'scan-9', 'photoHintsSha256': 'original-hash',
                      'reviewKind': 'agent_review_correction', 'corrections': [
                          {'hintIndex': 0, 'photoId': 'photos/9.jpg', 'reason': 'exclude background',
                           'bboxNorm': [0.2, 0.2, 0.8, 0.8],
                           'positivePointsNorm': [[0.4, 0.6]], 'negativePointsNorm': [[0.2, 0.2]]}]}
        result, indices = corrected_hints([hint], correction, 'scan-9', 'original-hash')
        self.assertEqual(hint['bboxNorm'], [0.1, 0.1, 0.9, 0.9])
        self.assertEqual(result[0]['bboxNorm'], [0.2, 0.2, 0.8, 0.8])
        self.assertEqual(indices, {0})
        self.assertEqual(result[0]['category'], 'chair')
        with self.assertRaises(ValueError):
            corrected_hints([hint], correction, 'different-scan', 'original-hash')

    def test_photo_identity_check_rejects_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'photos.json'
            path.write_text('{"pose": [1, 0, 0]}')
            expected = sha256(path)
            require_hash(path, expected, 'photo pose metadata')
            path.write_text('{"pose": [0, 1, 0]}')
            with self.assertRaises(ValueError):
                require_hash(path, expected, 'photo pose metadata')
            with self.assertRaises(ValueError):
                require_hash(path, '', 'missing photo pose identity')


if __name__ == '__main__':
    unittest.main()
