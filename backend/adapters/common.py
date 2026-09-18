"""Strict contracts for continuous regression of five finger flexion angles."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

@dataclass(frozen=True)
class RegressionConfig:
    model_path: Path
    expected_samples: int
    output_units: str


def read_config(allowed_suffixes: set[str]) -> RegressionConfig:
    configured_path = os.environ.get("EMG_MODEL_PATH", "").strip()
    if not configured_path:
        raise ValueError("Configura EMG_MODEL_PATH con el archivo local de tu modelo")
    model_path = Path(configured_path).expanduser().resolve()
    if not model_path.is_file() or model_path.suffix.lower() not in allowed_suffixes:
        raise ValueError(f"El modelo debe existir y usar uno de estos formatos: {', '.join(sorted(allowed_suffixes))}")

    try:
        expected_samples = int(os.environ.get("EMG_EXPECTED_SAMPLES", ""))
    except ValueError as exc:
        raise ValueError("Configura EMG_EXPECTED_SAMPLES con el tamaño de ventana usado al entrenar") from exc
    if not 1 <= expected_samples <= 10_000:
        raise ValueError("EMG_EXPECTED_SAMPLES debe estar entre 1 y 10000 muestras")
    output_units = os.environ.get("EMG_OUTPUT_UNITS", "").strip().lower()
    if output_units not in {"degrees", "normalized"}:
        raise ValueError("Declara EMG_OUTPUT_UNITS como degrees o normalized según los objetivos del entrenamiento")
    return RegressionConfig(model_path, expected_samples, output_units)


def preprocess_window(window: np.ndarray, sample_rate: int, expected_samples: int) -> np.ndarray:
    """Identity template: float32 with shape NTC=(1, expected_samples, 8).

    REPLACE this function with precisely the training pipeline: sensor conversion,
    filtering, channel order, normalization and, if needed, feature extraction.
    sample_rate is provided to support that pipeline; identity does not resample.
    """
    if sample_rate <= 0:
        raise ValueError("sample_rate debe ser positivo")
    values = np.asarray(window, dtype=np.float32)
    if values.shape != (expected_samples, 8) or not np.isfinite(values).all():
        raise ValueError(f"Se requiere una ventana finita ({expected_samples}, 8); llegó {values.shape}. Ajusta ventana, frecuencia y canales")
    return np.ascontiguousarray(values[None, :, :])


def decode_regression_output(output: object, output_units: str) -> dict:
    """Map five continuous flexions to degrees; never infer a gesture or clip errors.

    Output order is thumb, index, middle, ring, little. This simplified display
    contract cannot express each anatomical joint, abduction or Cartesian position.
    """
    values = np.asarray(output, dtype=np.float64)
    if values.shape != (1, 5) or not np.isfinite(values).all():
        raise ValueError(f"Se esperaba una salida finita (1, 5) de cinco flexiones; llegó {values.shape}")
    angles = values[0]
    if output_units == "normalized":
        if np.any(angles < 0) or np.any(angles > 1):
            raise ValueError("La salida normalized debe estar entre 0 y 1 para cada dedo")
        angles = angles * 90.0
    elif output_units == "degrees":
        if np.any(angles < 0) or np.any(angles > 90):
            raise ValueError("La salida degrees debe estar entre 0 y 90 grados para cada dedo")
    else:
        raise ValueError("output_units debe ser degrees o normalized")
    return {"angles": angles.tolist(), "gesture": "continuous", "confidence": None}
