"""Read prepared, participant-separated sEMG-MANUS windows without loading all rows.

This module deliberately does not import PyTorch. The normalizer is supplied by
preparation and is never fitted or changed by this reader.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import operator
from pathlib import Path
from typing import Any

import numpy as np


SPLITS = ("train", "val", "test")
ARRAY_FILES = ("emg.npy", "targets.npy")
CONTRACT_FILES = ("manifest.json", "normalizer.json", *ARRAY_FILES)


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8-sig") as stream:
        result = json.load(stream)
    if not isinstance(result, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dataset_fingerprint(directory: str | Path) -> tuple[str, dict[str, str]]:
    """Hash actual arrays and metadata, including split membership and scales."""
    directory = Path(directory)
    checksums = {name: sha256_file(directory / name) for name in CONTRACT_FILES}
    declared = read_json(directory / "manifest.json").get("files", {})
    for name, record in declared.items():
        if name in checksums and isinstance(record, dict) and record.get("sha256") != checksums[name]:
            raise ValueError(f"Checksum mismatch against prepared manifest: {name}")
    payload = json.dumps(checksums, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest(), checksums


def _positive_integer(value: Any, name: str, *, allow_zero: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if value < (0 if allow_zero else 1):
        raise ValueError(f"Invalid {name}: {value}")
    return value


class PreparedData:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory).resolve()
        self.manifest = read_json(self.directory / "manifest.json")
        self.normalizer = read_json(self.directory / "normalizer.json")
        if self.manifest.get("schema_version") != 1:
            raise ValueError("Only prepared schema_version=1 is supported")
        self.input_columns = self._columns("input_columns", 8)
        self.target_columns = self._columns("target_columns", 20)
        self.window_samples = _positive_integer(self.manifest.get("window_samples"), "window_samples")
        self.hop_samples = _positive_integer(self.manifest.get("hop_samples"), "hop_samples")
        if self.manifest.get("target_offset_samples", 0) != 0:
            raise ValueError("Only labels at the final window row (target_offset_samples=0) are supported")
        self.input_mean = self._statistic("input_mean", 8)
        self.input_std = self._statistic("input_std", 8, positive=True)
        self.target_mean = self._statistic("target_mean", 20)
        self.target_std = self._statistic("target_std", 20, positive=True)
        self._open_arrays()
        self._validate_trials()

    def _columns(self, name: str, length: int) -> list[str]:
        values = self.manifest.get(name)
        if (not isinstance(values, list) or len(values) != length
                or any(not isinstance(item, str) or not item for item in values)
                or len(set(values)) != length):
            raise ValueError(f"{name} must contain {length} unique nonempty column names")
        return list(values)

    def _statistic(self, name: str, length: int, positive: bool = False) -> np.ndarray:
        values = np.asarray(self.normalizer.get(name), dtype=np.float32)
        if values.shape != (length,) or not np.isfinite(values).all():
            raise ValueError(f"Invalid normalizer {name}; expected {length} finite values")
        if positive and (values <= 0).any():
            raise ValueError(f"Normalizer {name} must be strictly positive")
        return values

    def _open_arrays(self) -> None:
        self.emg = np.load(self.directory / "emg.npy", mmap_mode="r", allow_pickle=False)
        self.targets = np.load(self.directory / "targets.npy", mmap_mode="r", allow_pickle=False)
        if self.emg.ndim != 2 or self.emg.shape[1] != 8 or self.emg.dtype != np.float32:
            raise ValueError("emg.npy must be float32[N,8]")
        if self.targets.shape != (self.emg.shape[0], 20) or self.targets.dtype != np.float32:
            raise ValueError("targets.npy must be float32[N,20] with the same N as emg")

    def _validate_trials(self) -> None:
        trials = self.manifest.get("trials")
        if not isinstance(trials, list) or not trials:
            raise ValueError("manifest.trials must be a nonempty list")
        ids: set[str] = set()
        participant_splits: dict[str, str] = {}
        intervals: list[tuple[int, int]] = []
        windows_per_split = dict.fromkeys(SPLITS, 0)
        for trial in trials:
            if not isinstance(trial, dict):
                raise ValueError("Every trial must be an object")
            trial_id = trial.get("trial_id")
            if not isinstance(trial_id, str) or not trial_id or trial_id in ids:
                raise ValueError("Trial IDs must be unique nonempty strings")
            ids.add(trial_id)
            split = trial.get("split")
            if split not in SPLITS:
                raise ValueError(f"Invalid split for {trial_id}")
            participant = trial.get("participant")
            if participant is None or isinstance(participant, (bool, list, dict)):
                raise ValueError(f"Missing or invalid participant for {trial_id}")
            participant = str(participant)
            previous = participant_splits.setdefault(participant, split)
            if previous != split:
                raise ValueError(f"Participant {participant} occurs in multiple splits")
            start = _positive_integer(trial.get("start"), "trial.start", allow_zero=True)
            stop = _positive_integer(trial.get("stop"), "trial.stop")
            if not 0 <= start < stop <= len(self.emg):
                raise ValueError(f"Trial {trial_id} extends beyond its arrays")
            expected = max(0, 1 + (stop - start - self.window_samples) // self.hop_samples)
            count = _positive_integer(trial.get("windows"), "trial.windows", allow_zero=True)
            if count != expected:
                raise ValueError(f"Incorrect window count for {trial_id}: {count} != {expected}")
            windows_per_split[split] += count
            intervals.append((start, stop))
        intervals.sort()
        if any(left[1] > right[0] for left, right in zip(intervals, intervals[1:])):
            raise ValueError("Trials overlap in the prepared arrays")
        if any(count == 0 for count in windows_per_split.values()):
            raise ValueError("Train, val and test must each contain at least one complete window")
        declared = self.manifest.get("splits")
        if not isinstance(declared, dict) or set(declared) != set(SPLITS):
            raise ValueError("manifest.splits must declare train/val/test participant lists")
        all_declared: set[str] = set()
        for split in SPLITS:
            participants = declared[split]
            if not isinstance(participants, list) or not participants:
                raise ValueError(f"Missing participant list for {split}")
            participants = [str(participant) for participant in participants]
            actual = {participant for participant, assigned in participant_splits.items() if assigned == split}
            if len(set(participants)) != len(participants) or set(participants) != actual:
                raise ValueError(f"Declared {split} participants do not match the trials")
            if all_declared.intersection(participants):
                raise ValueError("Participant lists overlap between splits")
            all_declared.update(participants)
        if self.normalizer.get("fit_split", "train") != "train":
            raise ValueError("Normalizer must be fitted exclusively on train")
        fitted = self.normalizer.get("participant_ids")
        if fitted is not None and {str(item) for item in fitted} != {str(item) for item in declared["train"]}:
            raise ValueError("Normalizer participants do not match the train split")
        self.trials = trials
        self.windows_per_split = windows_per_split

    def __getstate__(self) -> dict[str, Any]:
        # Windows multiprocessing must reopen the memmaps, not pickle their data.
        state = self.__dict__.copy()
        state.pop("emg", None)
        state.pop("targets", None)
        return state

    def __setstate__(self, state: dict[str, Any]) -> None:
        self.__dict__.update(state)
        self._open_arrays()


class WindowDataset:
    """Duck-typed torch Dataset: x is [8,T], y is [20], both normalized.

    A sample ends at the label row. No window spans two trials, and no target
    or future EMG is exposed as model input. Both arrays remain memory mapped.
    """
    def __init__(self, data: PreparedData, split: str):
        if split not in SPLITS:
            raise ValueError(f"Unknown split: {split}")
        self.data = data
        self.split = split
        self.trials = [trial for trial in data.trials if trial["split"] == split and trial["windows"]]
        self.cumulative = np.cumsum([trial["windows"] for trial in self.trials]).tolist()

    def __len__(self) -> int:
        return self.cumulative[-1] if self.cumulative else 0

    def locate(self, index: int) -> tuple[dict[str, Any], int, int]:
        index = operator.index(index)
        if index < 0:
            index += len(self)
        if index < 0 or index >= len(self):
            raise IndexError(index)
        trial_index = bisect.bisect_right(self.cumulative, index)
        previous = self.cumulative[trial_index - 1] if trial_index else 0
        trial = self.trials[trial_index]
        start = trial["start"] + (index - previous) * self.data.hop_samples
        stop = start + self.data.window_samples
        return trial, start, stop

    def __getitem__(self, index: int) -> tuple[np.ndarray, np.ndarray]:
        trial, start, stop = self.locate(index)
        x = (self.data.emg[start:stop] - self.data.input_mean) / self.data.input_std
        y = (self.data.targets[stop - 1] - self.data.target_mean) / self.data.target_std
        if not np.isfinite(x).all() or not np.isfinite(y).all():
            raise ValueError(f"Nonfinite sample in trial {trial['trial_id']} ending at row {stop - 1}")
        return np.ascontiguousarray(x.T, dtype=np.float32), np.array(y, dtype=np.float32, copy=True)
