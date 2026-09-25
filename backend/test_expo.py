"""Tests for locally trained Expo gesture classifiers."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from backend import expo


class ExpoModelTests(unittest.TestCase):
    def training_data(self):
        patterns = {
            "open": [0.02] * 8,
            "fist": [0.75] * 8,
        }
        features = []
        labels = []
        for label in expo.EXPO_TRAINING_LABELS:
            pattern = np.asarray(patterns[label], dtype=float)
            for offset in np.linspace(-0.01, 0.01, 12):
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


if __name__ == "__main__":
    unittest.main()
