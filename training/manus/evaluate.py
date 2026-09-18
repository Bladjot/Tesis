"""Evaluate the frozen checkpoint once on test; optionally export for inference.

Export can subsequently be run with --export-only without inspecting test labels.
No gradients, optimizer steps, fitting or model selection occur here.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

import numpy as np

try:
    from .data import PreparedData, WindowDataset, dataset_fingerprint, sha256_file
except ImportError:
    from data import PreparedData, WindowDataset, dataset_fingerprint, sha256_file


class RegressionMetrics:
    """Accumulate in float64, preserving native output units and channel order."""
    def __init__(self, target_std: np.ndarray):
        self.scale = np.asarray(target_std, dtype=np.float64)
        self.absolute = np.zeros(20, dtype=np.float64)
        self.squared = np.zeros(20, dtype=np.float64)
        self.baseline_absolute = np.zeros(20, dtype=np.float64)
        self.baseline_squared = np.zeros(20, dtype=np.float64)
        self.count = 0

    def add(self, prediction_normalized: np.ndarray, target_normalized: np.ndarray) -> None:
        prediction = np.asarray(prediction_normalized, dtype=np.float64)
        target = np.asarray(target_normalized, dtype=np.float64)
        if prediction.shape != target.shape or prediction.ndim != 2 or prediction.shape[1] != 20:
            raise ValueError("Expected equal [batch,20] prediction/target arrays")
        if not np.isfinite(prediction).all() or not np.isfinite(target).all():
            raise ValueError("Nonfinite prediction or target in evaluation")
        error = (prediction - target) * self.scale
        # The normalized training-row mean is zero; it is not fitted to test.
        baseline_error = target * self.scale
        self.absolute += np.abs(error).sum(axis=0)
        self.squared += np.square(error).sum(axis=0)
        self.baseline_absolute += np.abs(baseline_error).sum(axis=0)
        self.baseline_squared += np.square(baseline_error).sum(axis=0)
        self.count += len(prediction)

    def result(self, columns: list[str]) -> dict[str, Any]:
        if self.count == 0:
            raise ValueError("Cannot report metrics for an empty test set")
        def summarize(absolute: np.ndarray, squared: np.ndarray) -> dict[str, Any]:
            mae = absolute / self.count
            rmse = np.sqrt(squared / self.count)
            return {
                "mae": float(mae.mean()),
                "rmse": float(np.sqrt(squared.sum() / (self.count * len(columns)))),
                "per_channel": [{"name": name, "mae": float(a), "rmse": float(r)}
                                for name, a, r in zip(columns, mae, rmse)],
            }
        return {"windows": self.count,
                "model": summarize(self.absolute, self.squared),
                "training_mean_baseline": summarize(self.baseline_absolute, self.baseline_squared)}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--data", type=Path, required=True)
    result.add_argument("--checkpoint", type=Path, required=True)
    result.add_argument("--output", type=Path, help="New test metrics JSON; required unless --export-only")
    result.add_argument("--batch-size", type=int, default=256)
    result.add_argument("--workers", type=int, default=0)
    result.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    result.add_argument("--export", type=Path, help="Optional new TorchScript file for raw [batch,time,8] EMG")
    result.add_argument("--export-only", action="store_true", help="Export the frozen model without evaluating test")
    return result


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def _export(model: Any, checkpoint: dict[str, Any], data: PreparedData,
            destination: Path, fingerprint: str, checkpoint_hash: str) -> None:
    import torch
    try:
        from .model import InferenceModel
    except ImportError:
        from model import InferenceModel
    destination = destination.resolve()
    metadata_path = destination.with_name(destination.name + ".json")
    if destination.exists() or metadata_path.exists():
        raise ValueError("Export destination or its metadata already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    wrapper = InferenceModel(model.cpu().eval(), checkpoint["normalizer"], data.window_samples).eval()
    scripted = torch.jit.script(wrapper)
    # Synthetic forward check only: does not use validation or test observations.
    example = torch.zeros(2, data.window_samples, 8)
    with torch.inference_mode():
        reference = wrapper(example)
        converted = scripted(example)
    torch.testing.assert_close(reference, converted)
    if tuple(converted.shape) != (2, 20) or not torch.isfinite(converted).all():
        raise ValueError("Exported model violated the inference contract")
    temporary = destination.with_name(destination.name + ".tmp")
    torch.jit.save(scripted, str(temporary))
    temporary.replace(destination)
    metadata = {
        "schema_version": 1, "format": "torchscript", "dataset_fingerprint": fingerprint,
        "checkpoint_sha256": checkpoint_hash, "model_sha256": sha256_file(destination),
        "input_shape": ["batch", data.window_samples, 8], "input_dtype": "float32",
        "input_columns": data.input_columns, "input_scaling": "raw dataset EMG values; normalization included",
        "output_shape": ["batch", 20], "output_columns": data.target_columns,
        "output_units": data.manifest.get("label_units", "native_manus_export"),
        "normalization": "train statistics embedded; do not normalize twice",
        "sample_rate_hz_nominal": data.manifest.get("sample_rate_hz_nominal"),
        "model_is_causal": True, "angle_clipping": "none", "gesture_classification": False,
        "limitations": ["Myo-to-EMG-PRO transfer is unvalidated", "Thumb mapping and calibrated angular accuracy require confirmation",
                        "Twenty outputs require an explicit simulator adapter; this does not replace five coupled controls directly"],
    }
    with metadata_path.open("x", encoding="utf-8") as stream:
        stream.write(_json_text(metadata))
    print(f"Exported {destination}; input is raw [batch,{data.window_samples},8], output is [batch,20].", flush=True)


def main(argv: list[str] | None = None) -> int:
    argument_parser = parser()
    args = argument_parser.parse_args(argv)
    if args.batch_size <= 0 or args.workers < 0:
        argument_parser.error("batch-size must be positive and workers nonnegative")
    if args.export_only and args.export is None:
        argument_parser.error("--export-only requires --export")
    if not args.export_only and args.output is None:
        argument_parser.error("--output is required for test evaluation")
    if args.output is not None and args.output.exists() and not args.export_only:
        argument_parser.error("Metrics already exist; test results cannot be silently overwritten")
    checkpoint_path = args.checkpoint.resolve()
    marker = checkpoint_path.with_name(checkpoint_path.name + ".test-evaluation.json")
    if marker.exists() and not args.export_only:
        argument_parser.error("This checkpoint already has a test evaluation marker. Keep test held out from further model selection; --export-only remains available.")
    try:
        import torch
        from torch.utils.data import DataLoader
    except ImportError:
        argument_parser.error("PyTorch is not installed; run evaluation on the prepared training computer")
    try:
        from .model import build_model
    except ImportError:
        from model import build_model
    if args.device == "cuda" and not torch.cuda.is_available():
        argument_parser.error("CUDA was requested but is unavailable")
    use_cuda = args.device == "cuda" or (args.device == "auto" and torch.cuda.is_available())
    device = torch.device("cuda" if use_cuda else "cpu")
    data = PreparedData(args.data)
    fingerprint, checksums = dataset_fingerprint(data.directory)
    checkpoint_hash = sha256_file(checkpoint_path)
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict) or checkpoint.get("schema_version") != 1:
        raise ValueError("Unsupported checkpoint schema")
    if checkpoint.get("dataset_fingerprint") != fingerprint:
        raise ValueError("The prepared arrays, split or normalizer differ from the training checkpoint")
    configuration = checkpoint["configuration"]
    if (configuration["input_columns"] != data.input_columns or configuration["target_columns"] != data.target_columns
            or configuration["window_samples"] != data.window_samples or checkpoint["normalizer"] != data.normalizer):
        raise ValueError("Checkpoint input/output/normalization contract does not match prepared data")
    model = build_model(checkpoint["model_config"])
    model.load_state_dict(checkpoint["model_state_dict"], strict=True)
    model.eval()
    if args.export is not None:
        _export(model, checkpoint, data, args.export, fingerprint, checkpoint_hash)
    if args.export_only:
        print("Export only: test windows were not evaluated.", flush=True)
        return 0

    # Exclusive marker prevents accidentally evaluating the same checkpoint twice,
    # including two concurrent invocations with different output filenames.
    with marker.open("x", encoding="utf-8") as stream:
        stream.write(_json_text({"status": "in_progress", "checkpoint_sha256": checkpoint_hash,
                                "started_at_utc": datetime.now(timezone.utc).isoformat()}))
    try:
        test_data = WindowDataset(data, "test")
        test_loader = DataLoader(test_data, batch_size=args.batch_size, shuffle=False,
                                 num_workers=args.workers, pin_memory=use_cuda)
        model = model.to(device)
        accumulator = RegressionMetrics(data.target_std)
        with torch.inference_mode():
            for inputs, targets in test_loader:
                predicted = model(inputs.to(device, non_blocking=True)).cpu().numpy()
                accumulator.add(predicted, targets.numpy())
        result = {
            "schema_version": 1, "split": "test", "evaluated_at_utc": datetime.now(timezone.utc).isoformat(),
            "checkpoint": str(checkpoint_path), "checkpoint_sha256": checkpoint_hash,
            "dataset_fingerprint": fingerprint, "data_checksums": checksums,
            "prepared_dataset_fingerprint": data.manifest.get("dataset_fingerprint"),
            "participants": data.manifest["splits"]["test"],
            "best_epoch_selected_on_val": checkpoint["best_epoch"], "training_loss": checkpoint["loss"],
            "units": data.manifest.get("label_units", "native_manus_export"),
            "target_columns": data.target_columns, "angle_clipping": "none",
            "baseline": "fixed mean of all training rows; never fitted on test",
            "aggregation": "all test windows equally weighted; RMSE over all window-channel values",
            "device": str(device), "torch_version": str(torch.__version__),
            **accumulator.result(data.target_columns),
            "limitations": ["Native exported values are not certified anatomical ground truth",
                            "Held-out Myo participants do not establish transfer to EMG PRO"],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(_json_text(result))
        marker.write_text(_json_text({"status": "completed", "checkpoint_sha256": checkpoint_hash,
                                      "metrics": str(args.output.resolve()), "dataset_fingerprint": fingerprint}), encoding="utf-8")
    except BaseException:
        # A failed run has produced no usable completed report; permit recovery.
        marker.unlink(missing_ok=True)
        raise
    print(f"Test MAE={result['model']['mae']:.6f}; RMSE={result['model']['rmse']:.6f} (native values).", flush=True)
    print(f"Training-mean baseline MAE={result['training_mean_baseline']['mae']:.6f}. Saved {args.output}.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
