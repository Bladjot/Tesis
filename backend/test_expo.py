"""Tests for locally trained Expo gesture classifiers."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from backend import expo


class ExpoModelTests(unittest.TestCase):
    def training_data(self, windows=12):
        patterns = {
            "open": [0.02] * 8,
            "fist": [0.75] * 8,
        }
        features = []
        labels = []
        for label in expo.EXPO_TRAINING_LABELS:
            pattern = np.asarray(patterns[label], dtype=float)
            for offset in np.linspace(-0.01, 0.01, windows):
                values = np.maximum(0, pattern + offset)
                features.append(np.concatenate((values, values * 0.9)).tolist())
                labels.append(label)
        return patterns, features, labels

    def test_train_list_and_predict_personal_classifier(self):
        patterns, features, labels = self.training_data()
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)):
            metadata = expo.train_expo_model("Visitante 1", features, labels, 8, 1000, 200)
            self.assertEqual(metadata["samples"], 24)
            self.assertGreaterEqual(metadata["validation_accuracy"], 0.9)
            self.assertEqual(expo.list_expo_models()[0]["id"], metadata["id"])

            predictor = expo.load_expo_predictor(metadata["id"])
            window = np.tile(np.asarray(patterns["fist"], dtype=float), (200, 1))
            prediction = predictor(window, 1000)
            self.assertEqual(prediction["gesture"], "fist")
            self.assertEqual(prediction["angles"], [75.0, 90.0, 90.0, 90.0, 90.0])
            self.assertGreater(prediction["confidence"], 0.5)

    def test_training_requires_every_gesture(self):
        _, features, labels = self.training_data()
        keep = [index for index, label in enumerate(labels) if label != "fist"]
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)):
            with self.assertRaisesRegex(ValueError, "fist"):
                expo.train_expo_model("Incompleto", [features[index] for index in keep], [labels[index] for index in keep], 8, 1000, 200)

    def test_model_identifier_cannot_escape_storage(self):
        with self.assertRaisesRegex(ValueError, "inválido"):
            expo.load_expo_predictor("../modelo")

    def test_comparison_reports_real_progress_and_saves_only_winner(self):
        _, features, labels = self.training_data(36)
        events = []
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)):
            metadata = expo.train_expo_model("Comparación", features, labels, 8, 1000, 200, compare=True, progress=events.append)
            self.assertEqual(len(metadata["comparison"]), 3)
            self.assertEqual(metadata["winner_key"], "forest")
            self.assertEqual(metadata["validation_samples"], 18)
            self.assertEqual(metadata["training_samples"], 45)
            self.assertEqual(len(list(Path(directory).glob("*.joblib"))), 1)
            self.assertEqual(len(expo.list_expo_models()), 1)
            for key in ("forest", "compact", "deep"):
                steps = [event["progress"] for event in events if event["type"] == "progress" and event["key"] == key]
                self.assertEqual(steps[0], 0)
                self.assertEqual(steps[-1], 1)
                self.assertEqual(steps, sorted(steps))
            self.assertEqual(len([event for event in events if event["type"] == "evaluated"]), 3)

    def test_neural_winner_retains_scaler_after_reload(self):
        patterns, features, labels = self.training_data(36)
        # Force a genuine neural winner to exercise persistence and online inference.
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)), patch.object(expo.RandomForestClassifier, "predict", side_effect=lambda matrix: np.repeat("open", len(matrix))):
            metadata = expo.train_expo_model("Red", features, labels, 8, 1000, 200, compare=True)
            self.assertIn(metadata["winner_key"], ("compact", "deep"))
            for label in ("open", "fist"):
                predictor = expo.load_expo_predictor(metadata["id"])
                prediction = predictor(np.tile(patterns[label], (200, 1)), 1000)
                self.assertEqual(prediction["gesture"], label)

    def test_cancelled_progress_does_not_save_a_model(self):
        _, features, labels = self.training_data(36)
        def cancel(event):
            raise ValueError("Cancelado")
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)):
            with self.assertRaisesRegex(ValueError, "Cancelado"):
                expo.train_expo_model("Cancelado", features, labels, 8, 1000, 200, compare=True, progress=cancel)
            self.assertFalse(list(Path(directory).glob("*.joblib")))


if __name__ == "__main__":
    unittest.main()
