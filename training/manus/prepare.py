"""Verifica y prepara sEMG-MANUS sin entrenar ni cargar frameworks de aprendizaje."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

import numpy as np


HERE = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def truth(value) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def validate_config(config):
    groups = config["splits"]
    if set(groups) != {"train", "val", "test"}:
        raise ValueError("Se requieren tres grupos: train, val y test")
    flat = [int(p) for values in groups.values() for p in values]
    if len(flat) != len(set(flat)) or any(not values for values in groups.values()):
        raise ValueError("Los participantes deben ser disjuntos y los grupos no vacíos")
    if config["window_samples"] < 2 or config["hop_samples"] < 1:
        raise ValueError("Ventana o salto inválidos")
    if config.get("target_offset_samples", 0) != 0:
        raise ValueError("Este primer protocolo usa la etiqueta de la última muestra de cada ventana")
    if len(config["input_columns"]) != 8 or len(config["target_columns"]) != 20:
        raise ValueError("El contrato del primer modelo es ocho entradas y veinte salidas")
    if config.get("constant_target_policy", "retain_and_flag") not in {"retain_and_flag", "exclude_whole_trial_if_all_20_targets_exactly_constant"}:
        raise ValueError("Política de objetivos constantes desconocida")
    for key in ["sample_rate_hz_nominal", "standard_deviation_floor"]:
        if not np.isfinite(config[key]) or config[key] <= 0:
            raise ValueError(f"{key} debe ser positivo y finito")


def convert_binary(source: Path, target: Path, rows: int, columns: int):
    binary = np.memmap(source, mode="r", dtype=np.float32, shape=(rows, columns))
    array = np.lib.format.open_memmap(target, mode="w+", dtype=np.float32, shape=(rows, columns))
    for start in range(0, rows, 100_000):
        array[start:start + 100_000] = binary[start:start + 100_000]
    array.flush()
    del array, binary
    # Sólo este archivo temporal creado por esta ejecución; nunca se tocan los CSV.
    source.unlink()


def prepare(raw: Path, output: Path, config_path: Path):
    raw, output = raw.resolve(), output.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    validate_config(config)
    if output == raw or output in raw.parents or raw in output.parents:
        raise ValueError("La salida debe estar separada del directorio de originales")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise FileExistsError(f"La salida debe estar vacía para no sobrescribir otra preparación: {output}")
    source_manifest = raw / "manifest.csv"
    with source_manifest.open(encoding="utf-8-sig", newline="") as handle:
        source_rows = list(csv.DictReader(handle))
    if not source_rows:
        raise ValueError("Manifest vacío")
    source_rows.sort(key=lambda row: row["relative_path"])
    listed_paths = [row["relative_path"] for row in source_rows]
    if len(set(listed_paths)) != len(listed_paths):
        raise ValueError("Manifest con rutas repetidas")
    actual_paths = {p.relative_to(raw).as_posix() for p in (raw / "data").rglob("*.csv")}
    if actual_paths != set(listed_paths):
        raise ValueError(f"Archivos extra/faltantes frente a manifest: {len(actual_paths ^ set(listed_paths))}")
    participant_split = {int(p): split for split, people in config["splits"].items() for p in people}
    nominal_total = sum(int(row["row_count"]) for row in source_rows if int(str(row["user_id"]).removeprefix("u_")) in participant_split)
    # Dos binarios temporales y su conversión a NPY, más margen conservador.
    required_bytes = nominal_total * 28 * 4 * 2 + 100_000_000
    if shutil.disk_usage(output).free < required_bytes:
        raise OSError(f"Espacio insuficiente: se requieren aproximadamente {required_bytes / 1e9:.2f} GB libres")
    input_columns, target_columns = config["input_columns"], config["target_columns"]
    sum_x, sum_x2 = np.zeros(8), np.zeros(8)
    sum_y, sum_y2 = np.zeros(20), np.zeros(20)
    training_rows = 0
    global_min, global_max = np.full(28, np.inf), np.full(28, -np.inf)
    seen_payload = {}
    trials, audit, exclusions = [], [], []
    offset = 0
    counts = {split: {"trials": 0, "rows": 0, "windows": 0} for split in participant_split.values()}
    window, hop = config["window_samples"], config["hop_samples"]
    with (output / "emg.float32.tmp").open("wb") as emg_file, (output / "targets.float32.tmp").open("wb") as target_file:
        for number, row in enumerate(source_rows, 1):
            relative = row["relative_path"]
            path = (raw / relative).resolve()
            if not path.is_relative_to(raw) or not path.is_file():
                raise ValueError(f"Ruta inválida del manifest: {relative}")
            if path.stat().st_size != int(row["size_bytes"]) or sha256(path) != row["sha256"]:
                raise ValueError(f"Integridad incorrecta: {relative}")
            match = re.fullmatch(r"data/u_(\d+)/s_(\d+)/g_([^/]+)/recording_(slow|medium|fast)_.+\.csv", relative)
            if match is None:
                raise ValueError(f"Ruta sin esquema conocido: {relative}")
            participant, session, gesture, speed = int(match[1]), int(match[2]), match[3], match[4]
            if participant != int(str(row["user_id"]).removeprefix("u_")):
                raise ValueError(f"Participante contradictorio: {relative}")
            with path.open(encoding="utf-8-sig") as handle:
                first_line = handle.readline()
                header = first_line.lstrip("# ").strip().split(",")
            header_present = first_line.lstrip().startswith("#")
            # La cohorte incompleta incluye CSV históricos de 38 columnas sin
            # encabezado. Verificar bytes y contar filas, sin asignarles semántica
            # articular ni incorporarlos al entrenamiento.
            if participant not in participant_split:
                values = np.loadtxt(path, delimiter=",", dtype=np.float64, ndmin=2)
                flags = []
                if truth(row.get("anomaly_flag", False)):
                    flags.append("known_trial_count_anomaly")
                if not header_present or values.shape[1] != 42:
                    flags.append("excluded_legacy_schema")
                if len(values) != int(row["row_count"]):
                    flags.append("excluded_manifest_row_count_difference")
                item = {"relative_path": relative, "participant": participant, "session": session, "gesture": gesture, "speed": speed, "split": "excluded", "rows": len(values), "manifest_rows": int(row["row_count"]), "source_columns": values.shape[1], "header_present": header_present, "sha256_verified": True, "nonfinite_all_columns": int((~np.isfinite(values)).sum()), "nonfinite_used_columns": None, "repeated_adjacent_glove_fraction": None, "flags": ";".join(flags), "excluded_reason": "outside_complete_cohort"}
                audit.append(item)
                exclusions.append(item)
                continue
            if not header_present or len(header) != 42 or len(set(header)) != 42:
                raise ValueError(f"Esquema de columnas incorrecto: {relative}")
            if header[:8] != input_columns or header[18:38] != target_columns:
                raise ValueError(f"Orden inesperado de entradas/objetivos: {relative}")
            values = np.loadtxt(path, delimiter=",", dtype=np.float64, ndmin=2)
            if values.shape != (int(row["row_count"]), 42):
                raise ValueError(f"Dimensiones distintas al manifest: {relative}: {values.shape}")
            x, y = values[:, :8], values[:, 18:38]
            payload = np.ascontiguousarray(np.column_stack((x, y)), dtype=np.float32)
            finite = bool(np.isfinite(payload).all())
            flags = []
            if truth(row.get("anomaly_flag", False)):
                flags.append("known_trial_count_anomaly")
            if finite and np.all(x == 0):
                flags.append("all_emg_zero")
            if finite and np.all(np.ptp(y, axis=0) == 0):
                flags.append("all_targets_constant")
            if finite and np.any(np.abs(y) > 360):
                flags.append("target_magnitude_over_360_review_no_clipping")
            split = participant_split.get(participant, "excluded")
            reasons = []
            if split == "excluded":
                reasons.append("outside_complete_cohort")
            if not finite:
                reasons.append("nonfinite_used_columns")
            if len(values) < window:
                reasons.append("shorter_than_window")
            if "all_targets_constant" in flags and config.get("constant_target_policy") == "exclude_whole_trial_if_all_20_targets_exactly_constant":
                reasons.append("all_targets_constant_no_dynamic_reference")
            payload_hash = hashlib.sha256(payload.tobytes()).hexdigest()
            if not reasons and payload_hash in seen_payload:
                reasons.append("exact_input_target_duplicate_of:" + seen_payload[payload_hash])
            repeated = float(np.all(np.diff(y, axis=0) == 0, axis=1).mean()) if len(y) > 1 and finite else None
            item = {"relative_path": relative, "participant": participant, "session": session, "gesture": gesture, "speed": speed, "split": split, "rows": len(values), "manifest_rows": int(row["row_count"]), "source_columns": values.shape[1], "header_present": header_present, "sha256_verified": True, "nonfinite_all_columns": int((~np.isfinite(values)).sum()), "nonfinite_used_columns": int((~np.isfinite(payload)).sum()), "repeated_adjacent_glove_fraction": repeated, "flags": ";".join(flags), "excluded_reason": ";".join(reasons)}
            audit.append(item)
            if reasons:
                exclusions.append(item)
            else:
                seen_payload[payload_hash] = relative
                x32, y32 = payload[:, :8].copy(), payload[:, 8:].copy()
                emg_file.write(x32.tobytes())
                target_file.write(y32.tobytes())
                n = len(values)
                windows = (n - window) // hop + 1
                trials.append({"trial_id": relative.removesuffix(".csv"), "source_path": relative, "participant": participant, "session": session, "gesture": gesture, "speed": speed, "split": split, "start": offset, "stop": offset + n, "windows": windows, "source_sha256": row["sha256"], "flags": flags})
                offset += n
                for key, value in [("trials", 1), ("rows", n), ("windows", windows)]:
                    counts[split][key] += value
                global_min = np.minimum(global_min, payload.min(axis=0))
                global_max = np.maximum(global_max, payload.max(axis=0))
                if split == "train":
                    # Estadísticas sólo de filas de entrenamiento, no del test ni del guante como entrada.
                    xd, yd = x32.astype(np.float64), y32.astype(np.float64)
                    sum_x += xd.sum(axis=0)
                    sum_x2 += np.square(xd).sum(axis=0)
                    sum_y += yd.sum(axis=0)
                    sum_y2 += np.square(yd).sum(axis=0)
                    training_rows += n
            if number % 200 == 0 or number == len(source_rows):
                print(f"Verificados {number}/{len(source_rows)} CSV; aceptados {len(trials)}; filas {offset:,}", flush=True)
    if not training_rows or any(value["windows"] == 0 for value in counts.values()):
        raise ValueError("Algún split quedó sin ventanas o entrenamiento sin muestras")
    observed_people = {item["participant"] for item in trials}
    if observed_people != set(participant_split):
        raise ValueError("No todos los participantes configurados tienen registros válidos")
    floor = float(config.get("standard_deviation_floor", 1e-6))
    mean_x, mean_y = sum_x / training_rows, sum_y / training_rows
    std_x = np.sqrt(np.maximum(0, sum_x2 / training_rows - mean_x ** 2))
    std_y = np.sqrt(np.maximum(0, sum_y2 / training_rows - mean_y ** 2))
    normalizer = {"fit_split": "train", "sample_count": training_rows, "participant_ids": config["splits"]["train"], "baseline_statistic": "mean_of_all_training_rows", "input_mean": mean_x.tolist(), "input_std": np.maximum(std_x, floor).tolist(), "target_mean": mean_y.tolist(), "target_std": np.maximum(std_y, floor).tolist(), "constant_input_channels": [input_columns[i] for i in np.flatnonzero(std_x < floor)], "constant_target_channels": [target_columns[i] for i in np.flatnonzero(std_y < floor)], "std_floor": floor}
    write_json(output / "normalizer.json", normalizer)
    convert_binary(output / "emg.float32.tmp", output / "emg.npy", offset, 8)
    convert_binary(output / "targets.float32.tmp", output / "targets.npy", offset, 20)
    files = {name: {"sha256": sha256(output / name), "size_bytes": (output / name).stat().st_size} for name in ["emg.npy", "targets.npy", "normalizer.json"]}
    config_sha = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps({"files": files, "config_sha256": config_sha, "trials": trials}, sort_keys=True).encode()).hexdigest()
    manifest = {**config, "created_at_utc": datetime.now(timezone.utc).isoformat(), "preparation_environment": {"python": sys.version, "numpy": np.__version__}, "dataset_fingerprint": fingerprint, "fingerprint_definition": "sha256(json_sort_keys({files,config_sha256,trials}))", "config_sha256": config_sha, "source_manifest_sha256": sha256(source_manifest), "shape_emg": [offset, 8], "shape_targets": [offset, 20], "dtype": "float32", "files": files, "split_counts": counts, "trials": trials, "limitations": ["200 Hz nominal; no timestamps originales", "salidas MANUS nativas; mapeo anatómico del pulgar pendiente", "etiquetas del modelo del guante, no medidas independientes por articulación", "sin adaptación validada de Myo a EMG PRO", "sin entrenamiento ejecutado durante preparación"]}
    write_json(output / "manifest.json", manifest)
    write_json(output / "prepare_config.json", config)
    flags = Counter(flag for row in audit for flag in row["flags"].split(";") if flag)
    report = {"source_record": config["source_record"], "verified_csv_files": len(audit), "accepted_trials": len(trials), "excluded_trials": len(exclusions), "source_rows": sum(row["rows"] for row in audit), "accepted_rows": offset, "split_counts": counts, "splits": config["splits"], "nominal_seconds_accepted": offset / config["sample_rate_hz_nominal"], "duration_caveat": "Estimación por filas/200 Hz; no duración verificada con timestamps", "flag_counts": dict(flags), "excluded": exclusions, "used_column_min": dict(zip(input_columns + target_columns, global_min.tolist())), "used_column_max": dict(zip(input_columns + target_columns, global_max.tolist())), "dataset_fingerprint": fingerprint, "raw_modified": False, "trained": False}
    write_json(output / "qc_report.json", report)
    with (output / "qc_per_trial.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(audit[0]))
        writer.writeheader()
        writer.writerows(audit)
    print(json.dumps({key: report[key] for key in ["verified_csv_files", "accepted_trials", "excluded_trials", "accepted_rows", "split_counts", "flag_counts", "trained"]}, ensure_ascii=False, indent=2), flush=True)
    return manifest, report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "prepare_config.json")
    args = parser.parse_args()
    prepare(args.raw, args.output, args.config)
