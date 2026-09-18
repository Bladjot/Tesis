"""Pruebas pequeñas de separación, integridad y etiquetas; nunca entrenan."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

CODE = Path(__file__).resolve().parents[1]
PROJECT_ROOT = CODE.parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from training.manus.data import PreparedData
from training.manus.validate_prepared import validate

spec = importlib.util.spec_from_file_location("manus_prepare", CODE / "prepare.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationTests(unittest.TestCase):
    def fixture(self, root):
        config = json.loads((CODE / "prepare_config.json").read_text())
        config.update(window_samples=4, hop_samples=2, splits={"train": [5], "val": [7], "test": [3]})
        config_path = root / "config.json"
        config_path.write_text(json.dumps(config))
        raw = root / "raw"
        raw.mkdir()
        header = config["input_columns"] + [f"imu_{i}" for i in range(10)] + config["target_columns"] + [f"quat_{i}" for i in range(4)]
        rows = []
        for participant, base in [(3, 300), (5, 10), (7, 100)]:
            path = raw / f"data/u_{participant}/s_1/g_flexext_fist/recording_medium_01_01_2024_00_00_00.csv"
            path.parent.mkdir(parents=True)
            data = np.ones((8, 42)) * base + np.arange(8)[:, None]
            np.savetxt(path, data, delimiter=",", header=",".join(header))
            rows.append({"relative_path": path.relative_to(raw).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size_bytes": path.stat().st_size, "user_id": participant, "session_id": 1, "gesture_id": "flexext_fist", "speed": "medium", "row_count": 8, "core_cohort": True, "incomplete_participant": False, "anomaly_flag": False, "notes": ""})
        with (raw / "manifest.csv").open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        return raw, config_path, config

    def test_train_only_statistics_and_trial_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, config_path, _ = self.fixture(root)
            output = root / "prepared"
            manifest, report = module.prepare(raw, output, config_path)
            norm = json.loads((output / "normalizer.json").read_text())
            np.testing.assert_allclose(norm["input_mean"], 13.5)
            np.testing.assert_allclose(norm["target_mean"], 13.5)
            self.assertEqual(norm["sample_count"], 8)
            self.assertEqual(report["accepted_rows"], 24)
            self.assertFalse(report["trained"])
            self.assertEqual(np.load(output / "emg.npy").shape, (24, 8))
            self.assertEqual(np.load(output / "targets.npy").shape, (24, 20))
            for trial in manifest["trials"]:
                self.assertEqual(trial["windows"], 3)
                ends = [trial["start"] + 3 + i * 2 for i in range(trial["windows"])]
                self.assertTrue(all(trial["start"] <= end - 3 <= end < trial["stop"] for end in ends))
            with self.assertRaises(FileExistsError):
                module.prepare(raw, output, config_path)

    def test_mismatched_source_hash_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, config_path, _ = self.fixture(root)
            path = next(raw.rglob("recording*.csv"))
            with path.open("a") as handle:
                handle.write("\n")
            with self.assertRaisesRegex(ValueError, "Integridad"):
                module.prepare(raw, root / "prepared", config_path)

    def test_constant_targets_are_excluded_or_retained_by_explicit_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, config_path, config = self.fixture(root)
            with (raw / "manifest.csv").open(newline="") as handle:
                source_rows = list(csv.DictReader(handle))
            original_values = np.concatenate([
                np.loadtxt(raw / row["relative_path"], delimiter=",")
                for row in sorted(source_rows, key=lambda row: row["relative_path"])
            ])
            path = raw / "data/u_5/s_1/g_flexext_index/recording_medium_01_01_2024_00_00_01.csv"
            path.parent.mkdir(parents=True)
            header = (config["input_columns"] + [f"imu_{i}" for i in range(10)]
                      + config["target_columns"] + [f"quat_{i}" for i in range(4)])
            values = np.zeros((8, 42), dtype=np.float64)
            values[:, :8] = 50 + np.arange(8)[:, None] * np.arange(1, 9)[None, :]
            values[:, 18:38] = np.arange(20) + 25
            np.savetxt(path, values, delimiter=",", header=",".join(header))
            source_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            constant_row = dict(source_rows[0])
            constant_row.update(
                relative_path=path.relative_to(raw).as_posix(), sha256=source_hash,
                size_bytes=path.stat().st_size, user_id=5, session_id=1,
                gesture_id="flexext_index", speed="medium", row_count=8,
                core_cohort=True, incomplete_participant=False, anomaly_flag=False,
            )
            with (raw / "manifest.csv").open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(source_rows[0]))
                writer.writeheader()
                writer.writerows([*source_rows, constant_row])

            config["constant_target_policy"] = "exclude_whole_trial_if_all_20_targets_exactly_constant"
            config_path.write_text(json.dumps(config))
            excluded_output = root / "prepared_excluded"
            manifest, report = module.prepare(raw, excluded_output, config_path)
            self.assertEqual(report["verified_csv_files"], 4)
            self.assertEqual(report["source_rows"], 32)
            self.assertEqual(report["accepted_trials"], 3)
            self.assertEqual(report["accepted_rows"], 24)
            self.assertEqual(report["excluded_trials"], 1)
            self.assertEqual({trial["source_path"] for trial in manifest["trials"]},
                             {row["relative_path"] for row in source_rows})
            exclusion = report["excluded"][0]
            self.assertEqual(exclusion["relative_path"], constant_row["relative_path"])
            self.assertEqual(exclusion["excluded_reason"], "all_targets_constant_no_dynamic_reference")
            self.assertIn("all_targets_constant", exclusion["flags"])
            self.assertTrue(exclusion["sha256_verified"])
            np.testing.assert_array_equal(np.load(excluded_output / "emg.npy"), original_values[:, :8])
            np.testing.assert_array_equal(np.load(excluded_output / "targets.npy"), original_values[:, 18:38])
            normalizer = json.loads((excluded_output / "normalizer.json").read_text())
            self.assertEqual(normalizer["sample_count"], 8)
            np.testing.assert_allclose(normalizer["input_mean"], 13.5)
            np.testing.assert_allclose(normalizer["target_mean"], 13.5)

            config["constant_target_policy"] = "retain_and_flag"
            config_path.write_text(json.dumps(config))
            retained_output = root / "prepared_retained"
            retained_manifest, retained_report = module.prepare(raw, retained_output, config_path)
            self.assertEqual(retained_report["accepted_trials"], 4)
            self.assertEqual(retained_report["accepted_rows"], 32)
            self.assertEqual(retained_report["excluded_trials"], 0)
            retained = next(trial for trial in retained_manifest["trials"]
                            if trial["source_path"] == constant_row["relative_path"])
            self.assertIn("all_targets_constant", retained["flags"])
            self.assertEqual(retained["split"], "train")
            self.assertEqual(retained["windows"], 3)
            bounds = slice(retained["start"], retained["stop"])
            np.testing.assert_array_equal(np.load(retained_output / "emg.npy")[bounds], values[:, :8])
            np.testing.assert_array_equal(np.load(retained_output / "targets.npy")[bounds], values[:, 18:38])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), source_hash)

    def test_excluded_legacy_csv_is_audited_without_changing_core_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, config_path, _ = self.fixture(root)
            path = raw / "data/u_1/s_1/g_flexext_fist/recording_medium_01_01_2024_00_00_00.csv"
            path.parent.mkdir(parents=True)
            # Estos registros históricos no llevan encabezado. El manifiesto
            # original contó la primera fila numérica como si fuera uno.
            np.savetxt(path, np.arange(8 * 38).reshape(8, 38), delimiter=",")
            with (raw / "manifest.csv").open(newline="") as handle:
                source_rows = list(csv.DictReader(handle))
            excluded_row = dict(source_rows[0])
            excluded_row.update(
                relative_path=path.relative_to(raw).as_posix(),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                size_bytes=path.stat().st_size,
                user_id=1,
                row_count=7,
                core_cohort=False,
                incomplete_participant=True,
            )
            with (raw / "manifest.csv").open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(source_rows[0]))
                writer.writeheader()
                writer.writerows([*source_rows, excluded_row])

            output = root / "prepared"
            manifest, report = module.prepare(raw, output, config_path)
            self.assertEqual(report["verified_csv_files"], 4)
            self.assertEqual(report["source_rows"], 32)
            self.assertEqual(report["accepted_rows"], 24)
            self.assertEqual(report["accepted_trials"], 3)
            self.assertEqual(report["excluded_trials"], 1)
            self.assertEqual({trial["participant"] for trial in manifest["trials"]}, {3, 5, 7})
            excluded = report["excluded"][0]
            self.assertEqual(excluded["participant"], 1)
            self.assertEqual(excluded["source_columns"], 38)
            self.assertFalse(excluded["header_present"])
            self.assertEqual(excluded["rows"], 8)
            self.assertEqual(excluded["manifest_rows"], 7)
            self.assertEqual(excluded["excluded_reason"], "outside_complete_cohort")
            self.assertTrue(excluded["sha256_verified"])
            self.assertIn("excluded_legacy_schema", excluded["flags"])
            self.assertIn("excluded_manifest_row_count_difference", excluded["flags"])
            with (output / "qc_per_trial.csv").open(newline="") as handle:
                audit = list(csv.DictReader(handle))
            saved_exclusion = next(row for row in audit if row["participant"] == "1")
            self.assertEqual(saved_exclusion["source_columns"], "38")
            self.assertEqual(saved_exclusion["header_present"], "False")
            normalizer = json.loads((output / "normalizer.json").read_text())
            np.testing.assert_allclose(normalizer["input_mean"], 13.5)
            np.testing.assert_allclose(normalizer["target_mean"], 13.5)
            self.assertEqual(normalizer["sample_count"], 8)
            self.assertEqual(np.load(output / "emg.npy").shape, (24, 8))
            self.assertEqual(np.load(output / "targets.npy").shape, (24, 20))

    def test_validation_rejects_altered_trial_ranges_with_valid_splits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, config_path, _ = self.fixture(root)
            output = root / "prepared"
            manifest, _ = module.prepare(raw, output, config_path)
            report = validate(output)
            self.assertTrue(report["file_hashes_valid"])
            self.assertEqual(report["prepared_dataset_fingerprint"], manifest["dataset_fingerprint"])
            self.assertFalse(report["training_executed"])
            self.assertFalse(report["framework_loaded"])
            for split in ["train", "val", "test"]:
                self.assertEqual(report["splits"][split]["windows"], 3)
                self.assertEqual(report["splits"][split]["boundary_windows_checked"], 2)

            training = next(trial for trial in manifest["trials"] if trial["split"] == "train")
            testing = next(trial for trial in manifest["trials"] if trial["split"] == "test")
            for boundary in ["start", "stop"]:
                training[boundary], testing[boundary] = testing[boundary], training[boundary]
            (output / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            # Las formas, límites, participantes y separaciones todavía son
            # válidos: debe fallar la huella que vincula las filas a los ensayos.
            structurally_valid = PreparedData(output)
            self.assertEqual(structurally_valid.windows_per_split, {"train": 3, "val": 3, "test": 3})
            del structurally_valid
            with self.assertRaisesRegex(ValueError, "huella"):
                validate(output)

    def test_shared_participant_fails_before_processing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, config_path, config = self.fixture(root)
            config["splits"]["test"] = [5]
            config_path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, "disjuntos"):
                module.prepare(raw, root / "prepared", config_path)


if __name__ == "__main__":
    unittest.main()
