"""Regression adapter contracts, without requiring trained ML models/frameworks."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from backend.adapters.common import decode_regression_output, preprocess_window, read_config


class AdapterContractTests(unittest.TestCase):
    def test_ntc_transform_preserves_eight_channels_and_samples(self):
        original = np.arange(32).reshape(4, 8)
        values = preprocess_window(original, 1000, expected_samples=4)
        self.assertEqual(values.shape, (1, 4, 8))
        self.assertEqual(values.dtype, np.float32)
        np.testing.assert_array_equal(values[0], original)

    def test_input_contract_rejects_wrong_window_and_channels(self):
        for window in [np.zeros((3, 8)), np.zeros((4, 7)), np.zeros((1, 4, 8)), np.full((4, 8), np.nan)]:
            with self.subTest(shape=window.shape), self.assertRaises(ValueError):
                preprocess_window(window, 1000, expected_samples=4)

    def test_degrees_preserve_continuous_finger_order(self):
        result = decode_regression_output([[2.25, 13.5, 47.75, 62.125, 89.0]], "degrees")
        self.assertEqual(result, {"angles": [2.25, 13.5, 47.75, 62.125, 89.0],
                                  "gesture": "continuous", "confidence": None})

    def test_normalized_outputs_map_continuously_to_degrees(self):
        result = decode_regression_output([[0, 0.1, 0.5, 0.75, 1]], "normalized")
        np.testing.assert_allclose(result["angles"], [0, 9, 45, 67.5, 90])
        self.assertIsNone(result["confidence"])

    def test_out_of_range_and_wrong_shapes_fail_without_clipping(self):
        cases = [([[0, 1, 2, 3, 90.1]], "degrees"), ([[0, 0.1, 0.2, 0.3, 1.01]], "normalized"),
                 ([[-0.001, 1, 2, 3, 4]], "degrees"), ([[0, 1, 2, 3, np.nan]], "degrees"),
                 ([0, 1, 2, 3, 4], "degrees"), ([[0, 1]], "degrees"),
                 ([[0, 1, 2, 3, 4]], "unspecified")]
        for output, units in cases:
            with self.subTest(output=output, units=units), self.assertRaises(ValueError):
                decode_regression_output(output, units)

    def test_model_config_requires_explicit_units_and_expected_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.pt"
            model.touch()
            env = {"EMG_MODEL_PATH": str(model), "EMG_EXPECTED_SAMPLES": "200", "EMG_OUTPUT_UNITS": "degrees"}
            with patch.dict(os.environ, env):
                config = read_config({".pt"})
                self.assertEqual(config.expected_samples, 200)
                self.assertEqual(config.output_units, "degrees")
                for invalid in [{"EMG_EXPECTED_SAMPLES": ""}, {"EMG_EXPECTED_SAMPLES": "0"},
                                {"EMG_EXPECTED_SAMPLES": "200.5"}, {"EMG_OUTPUT_UNITS": ""},
                                {"EMG_OUTPUT_UNITS": "logits"}]:
                    with self.subTest(invalid=invalid), patch.dict(os.environ, invalid):
                        with self.assertRaises(ValueError):
                            read_config({".pt"})


if __name__ == "__main__":
    unittest.main()
