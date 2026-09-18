"""Adapter shape example only. Replace this function with your trained model.

PowerShell: $env:EMG_MODEL_MODULE = 'backend.example_model'
No model is trained or loaded by this example; it deliberately returns a fixed pose.
"""

import numpy as np


def predict(window: np.ndarray, sample_rate: int) -> dict:
    """window is (samples, channels), oldest sample first, before filtering."""
    return {"angles": [20, 35, 35, 35, 35], "gesture": "adapter_example", "confidence": None}
