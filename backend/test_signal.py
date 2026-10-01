"""Run from the repository root: python -m unittest discover -s backend -v"""

import asyncio
import contextlib
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from pydantic import ValidationError

from backend.app import StreamConfig, emit_window, serial_stream
from backend.signal import (
    EMG_PRO_FRAME_MAGIC,
    EMGProPacketDecoder,
    WindowBuffer,
    MAX_SERIAL_BACKLOG_BYTES,
    baseline_prediction,
    adaptive_serial_hop,
    extract_features,
    load_custom_predictor,
    parse_sample,
    validate_prediction,
)


class SignalTests(unittest.TestCase):
    def test_emg_pro_binary_packets_decode_fragmented_eight_channel_samples(self):
        header = EMG_PRO_FRAME_MAGIC + bytes(13)
        payload = bytes(range(80))
        packet = header + payload + b"\x24"
        decoder = EMGProPacketDecoder()
        self.assertEqual(decoder.feed(b"junk" + packet[:31]), [])
        samples = decoder.feed(packet[31:])
        self.assertEqual(len(samples), 10)
        self.assertEqual(len(samples[0]), 8)
        np.testing.assert_allclose(samples[0], [(value - 127.5) / 127.5 for value in range(8)])
        np.testing.assert_allclose(samples[-1], [(value - 127.5) / 127.5 for value in range(72, 80)])
        self.assertEqual(decoder.buffered_bytes, 0)

    def test_emg_pro_binary_decoder_resynchronizes_on_next_packet(self):
        header = EMG_PRO_FRAME_MAGIC + bytes(13)
        packet = header + bytes([127] * 80) + b"\x24"
        decoder = EMGProPacketDecoder()
        samples = decoder.feed(b"noise" + packet + packet)
        self.assertEqual(len(samples), 20)
        np.testing.assert_allclose(samples[0], [-0.5 / 127.5] * 8)

    def test_csv_and_json_values(self):
        self.assertEqual(parse_sample(" 1.25, -3 \r\n", 2), [1.25, -3.0])
        self.assertEqual(parse_sample('{"values":[-0.25,4],"t":99.5}', 2), [-0.25, 4.0])

    def test_bad_samples_are_rejected(self):
        for line in ["", "1,2,3", "1,NaN", "1,Infinity", "header,2", '{"values":[true,1]}',
                     '{"values":[1,2],"t":false}', '{"values":[1e13,2]}', '{"values":[null,2]}']:
            with self.subTest(line=line), self.assertRaises(ValueError):
                parse_sample(line, 2)

    def test_features_are_per_channel_and_not_rectified_twice(self):
        rms, mav = extract_features(np.array([[3, -4], [-3, 4]], dtype=float))
        np.testing.assert_allclose(rms, [3, 4])
        np.testing.assert_allclose(mav, [3, 4])

    def test_window_and_hop_contract_preserves_order_and_all_samples(self):
        buffer = WindowBuffer(sample_rate=100, channels=1, window_ms=200, hop_ms=50)
        frames = [frame for i in range(30) if (frame := buffer.add([float(i)])) is not None]
        self.assertEqual([f.sample_count for f in frames], [20, 25, 30])
        self.assertEqual([len(f.samples) for f in frames], [20, 5, 5])
        np.testing.assert_equal(frames[-1].values[:, 0], np.arange(10, 30))
        self.assertEqual(frames[0].samples[0]["t"], 0)
        self.assertEqual(frames[-1].samples[-1]["t"], 0.29)

    def test_baseline_clips_and_does_not_invent_confidence(self):
        low = baseline_prediction(np.array([0.01]), rest=0.05, mvc=0.6)
        high = baseline_prediction(np.array([100.0]), rest=0.05, mvc=0.6)
        self.assertEqual(low["angles"], [0] * 5)
        self.assertEqual(high["angles"], [75, 90, 90, 90, 90])
        self.assertEqual(high["gesture"], "fist")
        self.assertIsNone(high["confidence"])

    def test_serial_cadence_tolerates_reported_overrun_and_keeps_headroom(self):
        self.assertEqual(adaptive_serial_hop(50.3, 50, 200), 70)
        self.assertEqual(adaptive_serial_hop(50.3, 70, 200), 70)
        self.assertEqual(adaptive_serial_hop(1, 70, 200), 70)
        self.assertEqual(adaptive_serial_hop(180, 70, 200), 200)
        with self.assertRaisesRegex(ValueError, "sobrecarga.*ventana"):
            adaptive_serial_hop(201, 50, 200)

    def test_adaptive_spacing_preserves_all_raw_samples_and_fixed_feature_window(self):
        buffer = WindowBuffer(1000, 8, 200, 50)
        frames = []
        for i in range(550):
            completed = buffer.add([float(i)] * 8)
            if completed:
                frames.append(completed)
                buffer.set_hop_ms(70)
        self.assertEqual([f.sample_count for f in frames], [200, 270, 340, 410, 480, 550])
        self.assertTrue(all(f.values.shape == (200, 8) for f in frames))
        self.assertEqual([s["values"][0] for f in frames for s in f.samples], list(range(550)))
        np.testing.assert_equal(frames[-1].values[:, 0], np.arange(350, 550))

    def test_custom_predictions_enforce_contract(self):
        self.assertEqual(validate_prediction({"gesture": "open"})["angles"], [0] * 5)
        self.assertEqual(validate_prediction({"angles": [1, 2, 3, 4, 5]})["gesture"], "custom")
        for value in [None, {"angles": [0, 1]}, {"angles": [0, 1, 2, 3, np.nan]},
                      {"angles": [0, 1, 2, 3, 91]}, {"gesture": "unknown"},
                      {"gesture": "open", "confidence": 1.1}, {"gesture": "open", "confidence": True}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_prediction(value)

    def test_custom_adapter_is_opt_in_and_server_configured(self):
        with patch.dict(os.environ, {"EMG_MODEL_MODULE": ""}):
            with self.assertRaises(ValueError):
                load_custom_predictor()
        with patch.dict(os.environ, {"EMG_MODEL_MODULE": "backend.example_model"}):
            result = load_custom_predictor()(np.zeros((20, 1)), 100)
            self.assertEqual(result["gesture"], "adapter_example")

    def test_custom_prepare_loads_without_hidden_inference(self):
        calls = []

        def prepare():
            calls.append("prepare")

        def predict(window, sample_rate):
            raise AssertionError("Loading an adapter must not run a hidden inference")

        module = SimpleNamespace(prepare=prepare, predict=predict)
        with patch.dict(os.environ, {"EMG_MODEL_MODULE": "local_regressor"}), \
                patch("backend.signal.importlib.import_module", return_value=module):
            self.assertIs(load_custom_predictor(), predict)
        self.assertEqual(calls, ["prepare"])

    def test_invalid_stream_configuration(self):
        for invalid in [{"channels": 0}, {"mvc": 0.05}, {"rest": float("nan")},
                        {"window_ms": 100, "hop_ms": 200}, {"source": "serial"}, {"module": "injected"}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                StreamConfig(**invalid)


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_serial_model_fails_visibly_before_emitting_stale_control(self):
        received = []

        class Connection:
            data = b"0,0,0,0,0,0,0,0\n" * 50
            closed = False

            @property
            def in_waiting(self):
                return len(self.data)

            def read(self, size):
                result, self.data = self.data[:size], self.data[size:]
                return result

            def close(self):
                self.closed = True

        class Socket:
            async def send_json(self, value):
                received.append(value)

        def slow_predictor(window, sample_rate):
            time.sleep(0.08)
            return {"angles": [1, 2, 3, 4, 5], "gesture": "continuous"}

        connection = Connection()
        cfg = StreamConfig(source="serial", port="COM_TEST", window_ms=50, hop_ms=10, model="custom")
        with patch("backend.app.list_ports.comports", return_value=[SimpleNamespace(device="COM_TEST")]), \
                patch("backend.app.serial.Serial", return_value=connection):
            with self.assertRaisesRegex(ValueError, "sobrecarga.*ventana"):
                await serial_stream(Socket(), cfg, slow_predictor)
        self.assertTrue(connection.closed)
        self.assertFalse(any(message["type"] == "frame" for message in received))

    async def test_serial_send_overrun_adapts_without_disconnect_or_sample_loss(self):
        received = []
        clock = [0.0]

        class Finished(Exception):
            pass

        class Connection:
            data = b"".join((",".join([str(i)] * 8) + "\n").encode() for i in range(550))
            closed = False

            @property
            def in_waiting(self):
                return len(self.data)

            def read(self, size):
                result, self.data = self.data[:size], self.data[size:]
                return result

            def close(self):
                self.closed = True

        class Socket:
            async def send_json(self, value):
                if value["type"] == "frame":
                    received.append(value)
                    clock[0] += 0.0503
                    if value["sample_count"] == 550:
                        raise Finished()

        connection = Connection()
        cfg = StreamConfig(source="serial", port="COM_TEST")
        with patch("backend.app.list_ports.comports", return_value=[SimpleNamespace(device="COM_TEST")]), \
                patch("backend.app.serial.Serial", return_value=connection), \
                patch("backend.app.time.perf_counter", side_effect=lambda: clock[0]):
            with self.assertRaises(Finished):
                await serial_stream(Socket(), cfg, None)
        self.assertTrue(connection.closed)
        self.assertEqual([f["sample_count"] for f in received], [200, 270, 340, 410, 480, 550])
        self.assertEqual([f["hop_ms"] for f in received], [50, 70, 70, 70, 70, 70])
        self.assertTrue(all(f["requested_hop_ms"] == 50 for f in received))
        self.assertEqual([s["values"][0] for f in received for s in f["samples"]], list(range(550)))

    async def test_serial_inference_overrun_smaller_than_window_still_emits(self):
        received = []

        class Socket:
            async def send_json(self, value):
                received.append(value)

        cfg = StreamConfig(source="serial", port="COM_TEST", model="custom")
        buffer = WindowBuffer(1000, 8, 200, 50)
        for _ in range(200):
            completed = buffer.add([0.1] * 8)
        predictor = lambda window, rate: {"gesture": "open"}
        with patch("backend.app.time.perf_counter", side_effect=[0, .0503, .0504]):
            total_ms = await emit_window(Socket(), completed, cfg, predictor)
        self.assertEqual(len(received), 1)
        self.assertAlmostEqual(received[0]["latency_ms"], 50.3)
        self.assertAlmostEqual(total_ms, 50.4)

    async def test_excess_serial_backlog_stops_without_discarding_and_continuing(self):
        class Connection:
            in_waiting = MAX_SERIAL_BACKLOG_BYTES + 1
            closed = False

            def read(self, size):
                raise AssertionError("Overloaded input must be rejected before reading")

            def close(self):
                self.closed = True

        class Socket:
            async def send_json(self, value):
                pass

        connection = Connection()
        with patch("backend.app.list_ports.comports", return_value=[SimpleNamespace(device="COM_TEST")]), \
                patch("backend.app.serial.Serial", return_value=connection):
            with self.assertRaisesRegex(ValueError, "sobrecarga.*bytes"):
                await serial_stream(Socket(), StreamConfig(source="serial", port="COM_TEST"), None)
        self.assertTrue(connection.closed)

    async def test_eight_channel_raw_frames_keep_every_sample_without_decimation(self):
        received = []

        class Socket:
            async def send_json(self, value):
                received.append(value)

        cfg = StreamConfig(sample_rate=5000, window_ms=2000, hop_ms=1000)
        self.assertEqual(cfg.channels, 8)
        buffer = WindowBuffer(cfg.sample_rate, cfg.channels, cfg.window_ms, cfg.hop_ms)
        for i in range(15_000):
            completed = buffer.add([float(i + channel) for channel in range(8)])
            if completed:
                await emit_window(Socket(), completed, cfg, None)
        self.assertEqual([len(frame["samples"]) for frame in received], [10_000, 5000])
        self.assertEqual([frame["sample_count"] for frame in received], [10_000, 15_000])
        all_samples = [sample for frame in received for sample in frame["samples"]]
        self.assertEqual([sample["values"][0] for sample in all_samples], list(range(15_000)))
        self.assertEqual(all_samples[-1]["values"], list(range(14_999, 15_007)))

    async def test_frame_contract_and_custom_adapter(self):
        received = []

        class Socket:
            async def send_json(self, value):
                received.append(value)

        cfg = StreamConfig(sample_rate=100, window_ms=200, hop_ms=50, channels=2, model="custom")
        buffer = WindowBuffer(100, 2, 200, 50)
        completed = None
        for _ in range(20):
            completed = buffer.add([0.5, -0.5])

        def predictor(window, sample_rate):
            self.assertEqual(window.shape, (20, 2))
            self.assertEqual(sample_rate, 100)
            return {"gesture": "pinch", "confidence": 0.7}

        await emit_window(Socket(), completed, cfg, predictor)
        frame = received[0]
        self.assertEqual(frame["type"], "frame")
        self.assertEqual(frame["sample_count"], 20)
        self.assertEqual(frame["timestamp"], 0.19)
        self.assertEqual(frame["rms"], [0.5, 0.5])
        self.assertEqual(frame["angles"], [65, 55, 10, 10, 10])
        self.assertEqual(frame["confidence"], 0.7)
        self.assertEqual(frame["unit"], "normalized")

    async def test_serial_is_closed_on_cancellation_even_without_samples(self):
        class Connection:
            in_waiting = 0
            closed = False

            def read(self, size):
                return b""

            def close(self):
                self.closed = True

        class Socket:
            async def send_json(self, value):
                pass

        connection = Connection()
        with patch("backend.app.list_ports.comports", return_value=[SimpleNamespace(device="COM_TEST")]), \
                patch("backend.app.serial.Serial", return_value=connection):
            task = asyncio.create_task(serial_stream(Socket(), StreamConfig(source="serial", port="COM_TEST"), None))
            await asyncio.sleep(0.03)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
