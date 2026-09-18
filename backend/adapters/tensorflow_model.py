"""Keras NTC continuous finger regression template, loaded on first use.

Use only trusted local .keras/.h5 files. Requires the optional TensorFlow package.
This template does not reconstruct architectures, custom layers or preprocessing.
"""

from functools import lru_cache
from threading import Lock

from .common import decode_regression_output, preprocess_window, read_config

_inference_lock = Lock()


@lru_cache(maxsize=1)
def _load_model(path: str):
    try:
        import tensorflow as tf
    except ImportError as exc:
        raise RuntimeError("Instala las dependencias de backend/adapters/requirements-tensorflow.txt") from exc
    return tf.keras.models.load_model(path, compile=False, safe_mode=True)


def prepare():
    """Load weights before opening the serial port; no synthetic inference is run."""
    config = read_config({".keras", ".h5"})
    with _inference_lock:
        _load_model(str(config.model_path))


def predict(window, sample_rate):
    config = read_config({".keras", ".h5"})
    values = preprocess_window(window, sample_rate, config.expected_samples)
    with _inference_lock:
        model = _load_model(str(config.model_path))
        output = model(values, training=False)
    if isinstance(output, (dict, tuple, list)):
        raise ValueError("La plantilla Keras necesita una única salida tensorial (1, 5) de regresión")
    return decode_regression_output(output.numpy(), config.output_units)
