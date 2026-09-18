"""Preparation/training boundary checks; these tests never train a model."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import pickle
import sys
import tempfile
import unittest

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from training.manus.data import PreparedData, WindowDataset, dataset_fingerprint, sha256_file
from training.manus.evaluate import RegressionMetrics


class PreparedContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.emg = np.arange(24 * 8, dtype=np.float32).reshape(24, 8)
        self.targets = np.arange(24 * 20, dtype=np.float32).reshape(24, 20)
        np.save(self.directory / "emg.npy", self.emg)
        np.save(self.directory / "targets.npy", self.targets)
        self.manifest = {
            "schema_version": 1, "input_columns": [f"emg_{i}" for i in range(8)],
            "target_columns": [f"angle_{i}" for i in range(20)],
            "window_samples": 3, "hop_samples": 2, "target_offset_samples": 0,
            "splits": {"train": [1], "val": [2], "test": [3]},
            "trials": [
                {"trial_id": f"trial_{i}", "participant": person, "split": split,
                 "session": 1, "gesture": "continuous", "speed": "medium",
                 "start": i * 6, "stop": (i + 1) * 6, "windows": 2}
                for i, (person, split) in enumerate([(1, "train"), (1, "train"), (2, "val"), (3, "test")])
            ],
        }
        self.normalizer = {
            "fit_split": "train", "participant_ids": [1], "sample_count": 12,
            "input_mean": list(range(8)), "input_std": [2.0] * 8,
            "target_mean": list(range(20)), "target_std": [3.0] * 20,
        }
        self.write_metadata()

    def tearDown(self):
        self.temporary.cleanup()

    def write_metadata(self):
        (self.directory / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        (self.directory / "normalizer.json").write_text(json.dumps(self.normalizer), encoding="utf-8")

    def test_causal_windows_end_at_label_and_never_bridge_trials(self):
        data = PreparedData(self.directory)
        windows = WindowDataset(data, "train")
        self.assertEqual(len(windows), 4)
        expected_bounds = [(0, 3), (2, 5), (6, 9), (8, 11)]
        for i, (start, stop) in enumerate(expected_bounds):
            x, y = windows[i]
            self.assertEqual(x.shape, (8, 3))
            self.assertEqual(y.shape, (20,))
            np.testing.assert_array_equal(x.T * 2 + np.arange(8), self.emg[start:stop])
            np.testing.assert_allclose(y * 3 + np.arange(20), self.targets[stop - 1])
            self.assertEqual(windows.locate(i)[1:], (start, stop))
        self.assertEqual(windows.locate(-1)[1:], expected_bounds[-1])
        with self.assertRaises(IndexError):
            windows[4]

    def test_validation_uses_supplied_training_scales_without_refitting(self):
        before = (self.directory / "normalizer.json").read_bytes()
        data = PreparedData(self.directory)
        x, y = WindowDataset(data, "val")[0]
        np.testing.assert_array_equal(x, ((self.emg[12:15] - np.arange(8)) / 2).T)
        np.testing.assert_allclose(y, (self.targets[14] - np.arange(20)) / 3)
        self.assertEqual(before, (self.directory / "normalizer.json").read_bytes())

    def test_participant_leakage_and_mismatched_declared_splits_are_rejected(self):
        self.manifest["trials"][2]["participant"] = 1
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "multiple splits"):
            PreparedData(self.directory)
        self.manifest["trials"][2]["participant"] = 2
        self.manifest["splits"]["val"] = [99]
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "do not match"):
            PreparedData(self.directory)

    def test_window_count_and_temporal_target_contract_are_checked(self):
        self.manifest["trials"][0]["windows"] = 3
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "window count"):
            PreparedData(self.directory)
        self.manifest["trials"][0]["windows"] = 2
        self.manifest["target_offset_samples"] = 1
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "target_offset_samples"):
            PreparedData(self.directory)

    def test_invalid_normalizer_cannot_silently_change_targets(self):
        self.normalizer["target_std"][0] = 0
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "strictly positive"):
            PreparedData(self.directory)
        self.normalizer["target_std"][0] = 3
        self.normalizer["participant_ids"] = [1, 2]
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "Normalizer participants"):
            PreparedData(self.directory)

    def test_nonfinite_data_is_rejected_when_a_window_is_read(self):
        self.emg[0, 0] = np.nan
        np.save(self.directory / "emg.npy", self.emg)
        windows = WindowDataset(PreparedData(self.directory), "train")
        with self.assertRaisesRegex(ValueError, "Nonfinite sample"):
            windows[0]

    def test_workers_reopen_memmaps_instead_of_serializing_all_arrays(self):
        source = PreparedData(self.directory)
        state = source.__getstate__()
        self.assertNotIn("emg", state)
        self.assertNotIn("targets", state)
        restored = pickle.loads(pickle.dumps(source))
        self.assertIsInstance(restored.emg, np.memmap)
        np.testing.assert_array_equal(restored.emg, self.emg)

    def test_fingerprint_detects_changed_data_and_checks_preparation_hashes(self):
        before, files = dataset_fingerprint(self.directory)
        self.assertEqual(files["emg.npy"], sha256_file(self.directory / "emg.npy"))
        self.emg[0, 0] += 1
        np.save(self.directory / "emg.npy", self.emg)
        after, _ = dataset_fingerprint(self.directory)
        self.assertNotEqual(before, after)
        self.manifest["files"] = {"emg.npy": {"sha256": files["emg.npy"]}}
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            dataset_fingerprint(self.directory)

    def test_metrics_restore_native_units_and_use_training_mean_baseline(self):
        metric = RegressionMetrics(np.full(20, 3.0))
        target = np.array([[1.0] * 20, [-1.0] * 20])
        prediction = np.array([[0.5] * 20, [-0.5] * 20])
        metric.add(prediction[:1], target[:1])
        metric.add(prediction[1:], target[1:])
        result = metric.result([f"angle_{i}" for i in range(20)])
        self.assertEqual(result["windows"], 2)
        self.assertEqual(result["model"]["mae"], 1.5)
        self.assertEqual(result["model"]["rmse"], 1.5)
        self.assertEqual(result["training_mean_baseline"]["mae"], 3.0)
        self.assertEqual(len(result["model"]["per_channel"]), 20)


@unittest.skipUnless(importlib.util.find_spec("torch") is not None, "PyTorch is deliberately not installed on the preparation PC")
class ForwardOnlyTests(unittest.TestCase):
    def test_tcn_blocks_do_not_use_future_samples(self):
        import torch
        from training.manus.model import CausalBlock
        torch.manual_seed(1)
        block = CausalBlock(8, 3, 2, 0.0).eval()
        original = torch.randn(2, 8, 16)
        changed = original.clone()
        changed[:, :, 9:] += 1000
        with torch.inference_mode():
            torch.testing.assert_close(block(original)[:, :, :9], block(changed)[:, :, :9])

    def test_export_has_raw_emg_contract_and_preserves_output_scaling(self):
        import torch
        from training.manus.model import InferenceModel, build_model
        model = build_model().eval()
        stats = {"input_mean": [1.0] * 8, "input_std": [2.0] * 8,
                 "target_mean": [7.0] * 20, "target_std": [3.0] * 20}
        wrapper = InferenceModel(model, stats, 80).eval()
        example = torch.randn(2, 80, 8)
        with torch.inference_mode():
            expected = model(((example - 1.0) / 2.0).transpose(1, 2)) * 3.0 + 7.0
            actual = wrapper(example)
            scripted = torch.jit.script(wrapper)
            torch.testing.assert_close(actual, expected)
            torch.testing.assert_close(scripted(example), expected)
        self.assertEqual(tuple(actual.shape), (2, 20))
        with self.assertRaises(ValueError):
            wrapper(torch.zeros(2, 8, 80))


if __name__ == "__main__":
    unittest.main()
