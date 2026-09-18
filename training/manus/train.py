"""Train on another computer: CUDA is required unless --allow-cpu is explicit.

Example: python train.py --data prepared --output runs/first_run
This entry point never constructs or evaluates the held-out test windows.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import random
import time
from typing import Any

import numpy as np

try:
    from .data import PreparedData, WindowDataset, dataset_fingerprint
except ImportError:
    from data import PreparedData, WindowDataset, dataset_fingerprint


def _write_json(path: Path, value: Any) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--data", type=Path, required=True)
    result.add_argument("--output", type=Path, required=True)
    result.add_argument("--epochs", type=int, default=40)
    result.add_argument("--batch-size", type=int, default=256)
    result.add_argument("--learning-rate", type=float, default=1e-3)
    result.add_argument("--weight-decay", type=float, default=1e-4)
    result.add_argument("--patience", type=int, default=7)
    result.add_argument("--min-delta", type=float, default=1e-5)
    result.add_argument("--loss", choices=("smooth-l1", "mse"), default="smooth-l1")
    result.add_argument("--seed", type=int, default=42)
    result.add_argument("--workers", type=int, default=0)
    result.add_argument("--allow-cpu", action="store_true", help="Explicitly permit training without CUDA on the destination computer")
    return result


def main(argv: list[str] | None = None) -> int:
    argument_parser = parser()
    args = argument_parser.parse_args(argv)
    if min(args.epochs, args.batch_size, args.patience) <= 0 or args.workers < 0:
        argument_parser.error("epochs, batch-size and patience must be positive; workers must be nonnegative")
    if (not all(math.isfinite(value) for value in (args.learning_rate, args.weight_decay, args.min_delta))
            or args.learning_rate <= 0 or args.weight_decay < 0 or args.min_delta < 0):
        argument_parser.error("Invalid learning-rate, weight-decay or min-delta")
    try:
        import torch
        from torch.utils.data import DataLoader
    except ImportError:
        argument_parser.error("PyTorch is not installed. Install a compatible CUDA build on the training computer; no training was started.")
    if not torch.cuda.is_available() and not args.allow_cpu:
        argument_parser.error("CUDA is unavailable. Training is disabled. Use a GPU computer, or explicitly pass --allow-cpu there.")
    try:
        from .model import DEFAULT_MODEL_CONFIG, build_model
    except ImportError:
        from model import DEFAULT_MODEL_CONFIG, build_model

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        argument_parser.error("The output directory must be empty; use a new run directory to preserve existing results.")
    data = PreparedData(args.data)
    fingerprint, checksums = dataset_fingerprint(data.directory)
    train_data = WindowDataset(data, "train")
    val_data = WindowDataset(data, "val")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(args.seed)
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
    generator = torch.Generator().manual_seed(args.seed)
    common_loader = {"batch_size": args.batch_size, "num_workers": args.workers,
                     "pin_memory": device.type == "cuda", "persistent_workers": args.workers > 0}
    train_loader = DataLoader(train_data, shuffle=True, generator=generator, **common_loader)
    val_loader = DataLoader(val_data, shuffle=False, **common_loader)
    model_config = dict(DEFAULT_MODEL_CONFIG)
    model = build_model(model_config).to(device)
    criterion = torch.nn.SmoothL1Loss(beta=1.0) if args.loss == "smooth-l1" else torch.nn.MSELoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay)
    configuration = {
        "schema_version": 1,
        "arguments": {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
        "model": model_config,
        "dataset_fingerprint": fingerprint,
        "prepared_dataset_fingerprint": data.manifest.get("dataset_fingerprint"),
        "data_checksums": checksums,
        "splits": data.manifest["splits"],
        "window_samples": data.window_samples,
        "hop_samples": data.hop_samples,
        "sample_rate_hz_nominal": data.manifest.get("sample_rate_hz_nominal"),
        "input_columns": data.input_columns,
        "target_columns": data.target_columns,
        "target_units": data.manifest.get("label_units", "native MANUS values; verify units and calibration before angular claims"),
        "normalizer_fit": "train only; supplied by preparation",
        "baseline_statistic": "mean_of_all_training_rows",
        "selection_metric": "validation_loss_in_normalized_target_units",
        "torch_version": str(torch.__version__),
        "cuda_runtime_version": torch.version.cuda,
        "device": str(device),
        "device_name": torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU (explicitly permitted)",
        "parameter_count": sum(parameter.numel() for parameter in model.parameters()),
        "test_evaluated": False,
    }
    output.mkdir(parents=True, exist_ok=True)
    _write_json(output / "config.json", configuration)
    history: list[dict[str, Any]] = []
    best_loss = float("inf")
    best_epoch = 0
    stale_epochs = 0
    started = time.monotonic()
    print(f"Training on {device}: {len(train_data)} train windows; {len(val_data)} validation windows. Test remains held out.", flush=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_total, train_count = 0.0, 0
        for inputs, targets in train_loader:
            inputs = inputs.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            prediction = model(inputs)
            loss = criterion(prediction, targets)
            if not torch.isfinite(loss):
                raise RuntimeError("Nonfinite training loss; stopped without evaluating test")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            optimizer.step()
            train_total += float(loss.detach()) * len(inputs)
            train_count += len(inputs)
        model.eval()
        val_total, val_count = 0.0, 0
        with torch.inference_mode():
            for inputs, targets in val_loader:
                prediction = model(inputs.to(device, non_blocking=True))
                loss = criterion(prediction, targets.to(device, non_blocking=True))
                if not torch.isfinite(loss):
                    raise RuntimeError("Nonfinite validation loss; stopped without evaluating test")
                val_total += float(loss) * len(inputs)
                val_count += len(inputs)
        train_loss, val_loss = train_total / train_count, val_total / val_count
        improved = val_loss < best_loss - args.min_delta
        record = {"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss,
                  "selected_as_best": improved, "elapsed_seconds": time.monotonic() - started}
        history.append(record)
        if improved:
            best_loss, best_epoch, stale_epochs = val_loss, epoch, 0
            checkpoint = {
                "schema_version": 1,
                "model_state_dict": {name: value.detach().cpu().clone() for name, value in model.state_dict().items()},
                "model_config": model_config,
                "normalizer": data.normalizer,
                "configuration": configuration,
                "dataset_fingerprint": fingerprint,
                "best_epoch": best_epoch,
                "best_val_loss": best_loss,
                "loss": args.loss,
            }
            temporary = output / "best.pt.tmp"
            torch.save(checkpoint, temporary)
            temporary.replace(output / "best.pt")
        else:
            stale_epochs += 1
        _write_json(output / "history.json", history)
        print(f"Epoch {epoch:03d}: train={train_loss:.6f}, val={val_loss:.6f}, best={best_epoch}", flush=True)
        if stale_epochs >= args.patience:
            print(f"Early stopping after {stale_epochs} epochs without validation improvement.", flush=True)
            break

    _write_json(output / "training_summary.json", {
        "schema_version": 1, "best_epoch": best_epoch, "best_val_loss": best_loss,
        "epochs_completed": len(history), "stopped_early": len(history) < args.epochs,
        "elapsed_seconds": time.monotonic() - started, "dataset_fingerprint": fingerprint,
        "checkpoint": "best.pt", "loss": args.loss, "test_evaluated": False,
        "next_step": "Freeze model/configuration before running evaluate.py on held-out test once.",
    })
    print(f"Saved {output / 'best.pt'}. Test has not been evaluated.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
