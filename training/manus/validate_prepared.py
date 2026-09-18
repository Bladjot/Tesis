"""Valida hashes y ventanas preparadas; no importa PyTorch ni entrena."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

try:
    from .data import PreparedData, WindowDataset, sha256_file
except ImportError:
    from data import PreparedData, WindowDataset, sha256_file


def validate(directory: Path):
    data = PreparedData(directory)
    config = json.loads((directory / "prepare_config.json").read_text(encoding="utf-8"))
    config_sha = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    if config_sha != data.manifest["config_sha256"] or any(data.manifest.get(key) != value for key, value in config.items()):
        raise ValueError("La configuración no coincide con el manifiesto preparado")
    fingerprint = hashlib.sha256(json.dumps({"files": data.manifest["files"], "config_sha256": config_sha, "trials": data.manifest["trials"]}, sort_keys=True).encode()).hexdigest()
    if fingerprint != data.manifest["dataset_fingerprint"]:
        raise ValueError("La huella no coincide: rangos, participantes o metadatos alterados")
    for name, expected in data.manifest["files"].items():
        path = directory / name
        if path.stat().st_size != expected["size_bytes"] or sha256_file(path) != expected["sha256"]:
            raise ValueError(f"Integridad incorrecta del archivo preparado: {name}")
    results = {}
    for split in ["train", "val", "test"]:
        dataset = WindowDataset(data, split)
        index = 0
        probes = 0
        for trial in dataset.trials:
            for sample_index in sorted({index, index + trial["windows"] - 1}):
                located, start, stop = dataset.locate(sample_index)
                if located["trial_id"] != trial["trial_id"] or not trial["start"] <= start < stop <= trial["stop"]:
                    raise ValueError("Ventana cruza una grabación")
                x, y = dataset[sample_index]
                if x.shape != (8, data.window_samples) or y.shape != (20,):
                    raise ValueError("Forma de ventana inválida")
                # La salida es la postura de la última fila; nunca una muestra futura.
                expected_y = (data.targets[stop - 1] - data.target_mean) / data.target_std
                np.testing.assert_array_equal(y, expected_y)
                probes += 1
            index += trial["windows"]
        results[split] = {"trials": len(dataset.trials), "windows": len(dataset), "boundary_windows_checked": probes}
    report = {"prepared_dataset_fingerprint": data.manifest["dataset_fingerprint"], "file_hashes_valid": True, "splits": results, "training_executed": False, "framework_loaded": False}
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = validate(args.data)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
