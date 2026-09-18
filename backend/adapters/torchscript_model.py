"""TorchScript CPU NTC continuous finger regression template, loaded on first use.

EMG_MODEL_PATH must name a trusted exported TorchScript .pt file. A .pt extension
alone is insufficient: state_dict and arbitrary torch.save pickles are unsupported.
"""

from functools import lru_cache
from threading import Lock

from .common import decode_regression_output, preprocess_window, read_config

_inference_lock = Lock()


@lru_cache(maxsize=1)
def _load_model(path: str):
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("Instala las dependencias de backend/adapters/requirements-torch.txt") from exc
    model = torch.jit.load(path, map_location="cpu")
    model.eval()
    return model


def prepare():
    """Load weights before opening the serial port; no synthetic inference is run."""
    config = read_config({".pt"})
    with _inference_lock:
        _load_model(str(config.model_path))


def predict(window, sample_rate):
    config = read_config({".pt"})
    values = preprocess_window(window, sample_rate, config.expected_samples)
    with _inference_lock:
        model = _load_model(str(config.model_path))
        import torch
        with torch.inference_mode():
            output = model(torch.from_numpy(values))
    if not isinstance(output, torch.Tensor):
        raise ValueError("La plantilla TorchScript necesita una única salida tensorial (1, 5) de regresión")
    return decode_regression_output(output.detach().cpu().numpy(), config.output_units)
