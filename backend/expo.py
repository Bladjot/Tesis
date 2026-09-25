"""Small, local gesture classifiers trained during the Expo workflow."""

from __future__ import annotations

import json
import math
import os
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score

from .signal import extract_features


EXPO_TRAINING_LABELS = ("open", "fist")
EXPO_ANGLES = {
    "open": [0.0, 0.0, 0.0, 0.0, 0.0],
    # Keep legacy classes readable for models trained by earlier prototypes.
    "relaxed": [0.0, 0.0, 0.0, 0.0, 0.0],
    "thumb": [90.0, 0.0, 0.0, 0.0, 0.0],
    "index": [0.0, 90.0, 0.0, 0.0, 0.0],
    "middle": [0.0, 0.0, 90.0, 0.0, 0.0],
    "ring": [0.0, 0.0, 0.0, 90.0, 0.0],
    "little": [0.0, 0.0, 0.0, 0.0, 90.0],
    "fist": [75.0, 90.0, 90.0, 90.0, 90.0],
    "pinch": [58.0, 65.0, 10.0, 14.0, 20.0],
}
MODEL_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "expo_models"
MAX_TRAINING_WINDOWS = 4_000
MIN_WINDOWS_PER_CLASS = 8


def _model_path(model_id: str) -> Path:
    if len(model_id) != 32 or any(char not in "0123456789abcdef" for char in model_id):
        raise ValueError("Identificador de modelo Expo inválido")
    return MODEL_DIR / f"{model_id}.joblib"


def _metadata_path(model_id: str) -> Path:
    return _model_path(model_id).with_suffix(".json")


def list_expo_models() -> list[dict]:
    if not MODEL_DIR.is_dir():
        return []
    models: list[dict] = []
    for path in MODEL_DIR.glob("*.json"):
        try:
            metadata = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(metadata, dict) and _model_path(str(metadata.get("id", ""))).is_file():
                models.append(metadata)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return sorted(models, key=lambda item: str(item.get("created_at", "")), reverse=True)


def train_expo_model(
    name: str,
    features: list[list[float]],
    labels: list[str],
    channels: int,
    sample_rate: int,
    window_ms: int,
) -> dict:
    clean_name = " ".join(name.strip().split())[:64]
    if not clean_name:
        raise ValueError("Escribe un nombre para identificar el modelo")
    if len(features) != len(labels) or not features:
        raise ValueError("Las características y etiquetas del entrenamiento no coinciden")
    if len(features) > MAX_TRAINING_WINDOWS:
        raise ValueError(f"El entrenamiento supera el máximo de {MAX_TRAINING_WINDOWS} ventanas")
    if channels != 8:
        raise ValueError("El entrenamiento Expo requiere los 8 canales del brazalete")

    matrix = np.asarray(features, dtype=float)
    expected_features = channels * 2
    if matrix.ndim != 2 or matrix.shape[1] != expected_features:
        raise ValueError(f"Cada ventana debe contener {expected_features} características RMS/MAV")
    if not np.isfinite(matrix).all() or np.max(np.abs(matrix)) > 1e12:
        raise ValueError("El entrenamiento contiene valores no finitos o fuera de rango")
    if any(label not in EXPO_TRAINING_LABELS for label in labels):
        raise ValueError("El entrenamiento contiene un gesto desconocido")

    label_array = np.asarray(labels)
    missing = [label for label in EXPO_TRAINING_LABELS if int(np.sum(label_array == label)) < MIN_WINDOWS_PER_CLASS]
    if missing:
        raise ValueError("Faltan ventanas suficientes para: " + ", ".join(missing))

    train_indices: list[int] = []
    test_indices: list[int] = []
    for label in EXPO_TRAINING_LABELS:
        indices = np.flatnonzero(label_array == label)
        test_count = max(1, int(round(len(indices) * 0.25)))
        train_indices.extend(indices[:-test_count].tolist())
        test_indices.extend(indices[-test_count:].tolist())

    classifier = RandomForestClassifier(
        n_estimators=120,
        max_depth=12,
        min_samples_leaf=2,
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=1,
    )
    classifier.fit(matrix[train_indices], label_array[train_indices])
    accuracy = float(accuracy_score(label_array[test_indices], classifier.predict(matrix[test_indices])))
    model_id = uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "id": model_id,
        "name": clean_name,
        "created_at": created_at,
        "algorithm": "Random Forest",
        "channels": channels,
        "feature_count": expected_features,
        "features": "RMS y MAV por canal",
        "sample_rate": sample_rate,
        "window_ms": window_ms,
        "classes": list(EXPO_TRAINING_LABELS),
        "samples": len(features),
        "validation_accuracy": round(accuracy, 4),
    }
    payload = {"classifier": classifier, "metadata": metadata}

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = _model_path(model_id)
    model_tmp = model_path.with_suffix(".joblib.tmp")
    metadata_path = _metadata_path(model_id)
    metadata_tmp = metadata_path.with_suffix(".json.tmp")
    joblib.dump(payload, model_tmp)
    metadata_tmp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(model_tmp, model_path)
    os.replace(metadata_tmp, metadata_path)
    return metadata


def load_expo_predictor(model_id: str) -> Callable:
    path = _model_path(model_id)
    if not path.is_file():
        raise ValueError("El modelo Expo seleccionado ya no existe")
    payload = joblib.load(path)
    if not isinstance(payload, dict) or "classifier" not in payload or "metadata" not in payload:
        raise ValueError("El archivo del modelo Expo es incompatible")
    classifier = payload["classifier"]
    metadata = payload["metadata"]
    if not isinstance(metadata, dict) or metadata.get("channels") != 8:
        raise ValueError("El modelo Expo no corresponde a ocho canales")
    probability_history: deque[np.ndarray] = deque(maxlen=5)

    def predict(window: np.ndarray, sample_rate: int) -> dict:
        if window.ndim != 2 or window.shape[1] != 8:
            raise ValueError("El modelo Expo requiere ventanas de ocho canales")
        rms, mav = extract_features(window)
        vector = np.concatenate((rms, mav)).reshape(1, -1)
        probabilities = np.asarray(classifier.predict_proba(vector)[0], dtype=float)
        if probabilities.ndim != 1 or not np.isfinite(probabilities).all():
            raise ValueError("El clasificador Expo produjo probabilidades inválidas")
        probability_history.append(probabilities)
        smoothed = np.mean(np.stack(probability_history), axis=0)
        winner = int(np.argmax(smoothed))
        label = str(classifier.classes_[winner])
        if label not in EXPO_ANGLES:
            raise ValueError("El clasificador Expo produjo una clase desconocida")
        confidence = float(smoothed[winner])
        if not math.isfinite(confidence):
            raise ValueError("El clasificador Expo produjo una confianza inválida")
        return {"gesture": label, "angles": EXPO_ANGLES[label], "confidence": confidence}

    return predict
