"""Small causal TCN for continuous regression; no gesture classifier."""
from __future__ import annotations

from typing import Any

import torch
from torch import nn
from torch.nn import functional as F


DEFAULT_MODEL_CONFIG = {
    "input_channels": 8,
    "output_channels": 20,
    "hidden_channels": 48,
    "dilations": [1, 2, 4, 8, 16],
    "kernel_size": 3,
    "dropout": 0.1,
}


class CausalBlock(nn.Module):
    def __init__(self, channels: int, kernel_size: int, dilation: int, dropout: float):
        super().__init__()
        self.left_padding = (kernel_size - 1) * dilation
        self.conv1 = nn.Conv1d(channels, channels, kernel_size, dilation=dilation)
        self.conv2 = nn.Conv1d(channels, channels, kernel_size, dilation=dilation)
        self.dropout = nn.Dropout(dropout)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        hidden = self.dropout(F.relu(self.conv1(F.pad(inputs, (self.left_padding, 0)))))
        hidden = self.dropout(F.relu(self.conv2(F.pad(hidden, (self.left_padding, 0)))))
        return F.relu(inputs + hidden)


class CausalTCN(nn.Module):
    def __init__(self, input_channels: int = 8, output_channels: int = 20,
                 hidden_channels: int = 48, dilations: list[int] | None = None,
                 kernel_size: int = 3, dropout: float = 0.1):
        super().__init__()
        self.projection = nn.Conv1d(input_channels, hidden_channels, 1)
        self.blocks = nn.ModuleList([
            CausalBlock(hidden_channels, kernel_size, dilation, dropout)
            for dilation in (dilations if dilations is not None else [1, 2, 4, 8, 16])
        ])
        self.regression = nn.Linear(hidden_channels, output_channels)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        hidden = F.relu(self.projection(inputs))
        for block in self.blocks:
            hidden = block(hidden)
        return self.regression(hidden[:, :, -1])


def build_model(config: dict[str, Any] | None = None) -> CausalTCN:
    return CausalTCN(**(DEFAULT_MODEL_CONFIG if config is None else config))


class InferenceModel(nn.Module):
    """Portable contract: raw [batch,time,8] -> native-unit [batch,20]."""
    def __init__(self, model: CausalTCN, normalizer: dict[str, Any], window_samples: int):
        super().__init__()
        self.model = model
        self.window_samples = window_samples
        self.register_buffer("input_mean", torch.tensor(normalizer["input_mean"], dtype=torch.float32))
        self.register_buffer("input_std", torch.tensor(normalizer["input_std"], dtype=torch.float32))
        self.register_buffer("target_mean", torch.tensor(normalizer["target_mean"], dtype=torch.float32))
        self.register_buffer("target_std", torch.tensor(normalizer["target_std"], dtype=torch.float32))

    def forward(self, raw_emg: torch.Tensor) -> torch.Tensor:
        if raw_emg.dim() != 3 or raw_emg.size(1) != self.window_samples or raw_emg.size(2) != 8:
            raise ValueError("Expected raw EMG with shape [batch,window_samples,8]")
        normalized = (raw_emg - self.input_mean) / self.input_std
        prediction = self.model(normalized.transpose(1, 2))
        return prediction * self.target_std + self.target_mean
