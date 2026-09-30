"""Exercise the comparison stream through the actual async route."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import expo
from backend.app import ExpoTrainingRequest, expo_compare


class ExpoStreamTests(unittest.IsolatedAsyncioTestCase):
    def request(self, **changes):
        values = dict(
            name="Comparación API", channels=8, sample_rate=1000,
            window_ms=200, hop_ms=50,
            features=[[.02] * 16] * 40 + [[.7] * 16] * 40,
            labels=["open"] * 40 + ["fist"] * 40,
        )
        values.update(changes)
        return ExpoTrainingRequest(**values)

    async def test_stream_finishes_with_saved_winner_and_three_evaluations(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)):
            response = await expo_compare(self.request())
            events = [json.loads(line) async for line in response.body_iterator]
            self.assertEqual(response.media_type, "application/x-ndjson")
            self.assertEqual(events[-1]["type"], "result")
            self.assertEqual(len([event for event in events if event["type"] == "evaluated"]), 3)
            model = events[-1]["model"]
            self.assertEqual(model["name"], "Comparación API")
            self.assertEqual(expo.list_expo_models()[0]["id"], model["id"])

    async def test_insufficient_classes_send_terminal_error_and_save_nothing(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(expo, "MODEL_DIR", Path(directory)):
            response = await expo_compare(self.request(features=[[.02] * 16] * 40, labels=["open"] * 40))
            with self.assertLogs("emg", level="ERROR"):
                events = [json.loads(line) async for line in response.body_iterator]
            self.assertEqual(events[-1]["type"], "error")
            self.assertIn("fist", events[-1]["message"])
            self.assertFalse(expo.list_expo_models())

    async def test_invalid_hop_fails_before_opening_a_training_stream(self):
        with self.assertRaises(HTTPException) as error:
            await expo_compare(self.request(hop_ms=250))
        self.assertEqual(error.exception.status_code, 422)
