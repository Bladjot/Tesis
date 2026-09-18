"""Acquisition contracts and deliberately simple, untrained demonstration control."""

from __future__ import annotations

import importlib
import json
import math
import os
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import numpy as np


GESTURES = {
    "open": [0.0, 0.0, 0.0, 0.0, 0.0],
    "fist": [75.0, 90.0, 90.0, 90.0, 90.0],
    "pinch": [65.0, 55.0, 10.0, 10.0, 10.0],
}

MAX_SERIAL_BACKLOG_BYTES = 32_768


def ensure_serial_backlog(buffered_bytes: int) -> None:
    if buffered_bytes > MAX_SERIAL_BACKLOG_BYTES:
        raise ValueError(
            f"Adquisición detenida por sobrecarga: {buffered_bytes} bytes pendientes "
            f"superan el límite de {MAX_SERIAL_BACKLOG_BYTES}. No se descartaron muestras "
            "para continuar; aumenta el salto, reduce la tasa o usa un modelo más rápido"
        )


def ensure_serial_timing(processing_ms: float, hop_ms: int) -> None:
    if processing_ms > hop_ms:
        raise ValueError(
            f"Adquisición detenida por sobrecarga: procesamiento/envío de {processing_ms:.1f} ms "
            f"supera el salto de {hop_ms} ms. Aumenta el salto o usa un modelo más rápido; "
            "se detuvo el flujo para evitar controlar la mano con datos atrasados"
        )


def parse_sample(line: str, channels: int) -> list[float]:
    """Accept CSV values only, or JSON {values: [...], t?: number}."""
    line = line.strip()
    if not line:
        raise ValueError("Línea vacía")
    if line.startswith("{"):
        obj = json.loads(line)
        if not isinstance(obj, dict) or not isinstance(obj.get("values"), list):
            raise ValueError("JSON requiere values como lista")
        if "t" in obj and (
            isinstance(obj["t"], bool)
            or not isinstance(obj["t"], (int, float))
            or not math.isfinite(obj["t"])
        ):
            raise ValueError("El tiempo opcional debe ser numérico y finito")
        raw = obj["values"]
    else:
        raw = line.split(",")
    if len(raw) != channels:
        raise ValueError(f"Se esperaban {channels} canales y llegaron {len(raw)}")
    if any(isinstance(v, bool) or not isinstance(v, (str, int, float)) for v in raw):
        raise ValueError("Los canales deben ser números")
    try:
        values = [float(value) for value in raw]
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Muestra no numérica") from exc
    if not all(math.isfinite(value) and abs(value) <= 1e12 for value in values):
        raise ValueError("Muestra fuera de rango o no finita")
    return values


def extract_features(window: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if window.ndim != 2 or window.shape[0] == 0 or not np.isfinite(window).all():
        raise ValueError("La ventana debe contener muestras finitas × canales")
    return np.sqrt(np.mean(np.square(window), axis=0)), np.mean(np.abs(window), axis=0)


def baseline_prediction(rms: np.ndarray, rest: float, mvc: float) -> dict:
    """RMS amplitude mapping only: this is neither trained nor a gesture classifier."""
    if mvc <= rest:
        raise ValueError("MVC debe ser mayor que el nivel de reposo")
    activation = float(np.clip((float(np.mean(rms)) - rest) / (mvc - rest), 0, 1))
    gesture = "open" if activation < 0.12 else "fist" if activation > 0.8 else "proportional"
    return {
        "activation": activation,
        "angles": [activation * 75.0] + [activation * 90.0] * 4,
        "gesture": gesture,
        "confidence": None,
    }


def validate_prediction(result: object) -> dict:
    if not isinstance(result, Mapping):
        raise ValueError("predict debe devolver un diccionario")
    gesture = result.get("gesture", "custom")
    if not isinstance(gesture, str) or not gesture.strip() or len(gesture) > 64:
        raise ValueError("gesture debe ser texto no vacío de hasta 64 caracteres")
    angles = result.get("angles")
    if angles is None:
        if gesture not in GESTURES:
            raise ValueError("Sin angles, gesture debe ser open, fist o pinch")
        angles = GESTURES[gesture]
    try:
        array = np.asarray(angles, dtype=float)
    except (ValueError, TypeError) as exc:
        raise ValueError("angles debe contener cinco números") from exc
    if array.shape != (5,) or not np.isfinite(array).all() or (array < 0).any() or (array > 90).any():
        raise ValueError("angles requiere cinco valores finitos entre 0 y 90 grados")
    confidence = result.get("confidence")
    if confidence is not None:
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float, np.number)):
            raise ValueError("confidence debe ser un número o null")
        confidence = float(confidence)
        if not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ValueError("confidence debe estar entre 0 y 1")
    return {"angles": array.tolist(), "gesture": gesture, "confidence": confidence}


def load_custom_predictor() -> Callable:
    module_name = os.environ.get("EMG_MODEL_MODULE", "").strip()
    if not module_name:
        raise ValueError("Configura EMG_MODEL_MODULE con un módulo Python local de confianza")
    module = importlib.import_module(module_name)
    predictor = getattr(module, "predict", None)
    if not callable(predictor):
        raise ValueError(f"{module_name} debe definir predict(window, sample_rate)")
    prepare = getattr(module, "prepare", None)
    if prepare is not None:
        if not callable(prepare):
            raise ValueError("El atributo opcional prepare debe ser una función sin argumentos")
        prepare()
    return predictor


@dataclass
class CompletedWindow:
    values: np.ndarray
    samples: list[dict]
    sample_count: int


class WindowBuffer:
    def __init__(self, sample_rate: int, channels: int, window_ms: int, hop_ms: int):
        self.sample_rate = sample_rate
        self.channels = channels
        self.window_size = max(1, round(sample_rate * window_ms / 1000))
        self.hop_size = max(1, round(sample_rate * hop_ms / 1000))
        self.values: deque[list[float]] = deque(maxlen=self.window_size)
        self.pending: list[dict] = []
        self.count = 0
        self.next_frame = self.window_size

    def add(self, values: list[float]) -> CompletedWindow | None:
        if len(values) != self.channels or not all(math.isfinite(v) for v in values):
            raise ValueError("Número de canales incorrecto o muestra no finita")
        self.values.append(list(values))
        self.pending.append({"t": self.count / self.sample_rate, "values": list(values)})
        self.count += 1
        if self.count < self.next_frame:
            return None
        output = CompletedWindow(np.asarray(self.values, dtype=float), self.pending, self.count)
        self.pending = []
        self.next_frame += self.hop_size
        return output
