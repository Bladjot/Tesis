"""Audit local EMG/kinematic FIF recordings; never write to the source directory."""
from __future__ import annotations

import csv
import hashlib
import json
import sys
import warnings
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mne
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Datos-Train"
OUTPUT = Path(__file__).resolve().parent
mne.set_log_level("ERROR")


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(4 * 1024 * 1024):
            hasher.update(block)
    return hasher.hexdigest()


def longest_run(mask):
    padded = np.r_[False, mask, False].astype(np.int8)
    changes = np.diff(padded)
    return int(np.max(np.flatnonzero(changes == -1) - np.flatnonzero(changes == 1), initial=0))


def inspect(path):
    with warnings.catch_warnings(record=True) as messages:
        raw = mne.io.read_raw_fif(path, preload=False, verbose="ERROR")
        # One subject at a time: approx. 210 MB for all 29 channels as float64.
        data = raw.get_data()
        sfreq = float(raw.info["sfreq"])
        result = {
            "file": path.name, "size_bytes": path.stat().st_size, "sha256": digest(path),
            "n_samples": int(raw.n_times), "duration_s": raw.n_times / sfreq, "sfreq": sfreq,
            "first_sample": int(raw.first_samp), "channel_names": raw.ch_names,
            "channel_types": raw.get_channel_types(), "description": raw.info.get("description"),
            "highpass_header_hz": raw.info["highpass"], "lowpass_header_hz": raw.info["lowpass"],
            "bads_header": raw.info["bads"], "annotations": [
                {"onset_s": float(a), "duration_s": float(b), "description": str(c)}
                for a, b, c in zip(raw.annotations.onset, raw.annotations.duration, raw.annotations.description)
            ],
            "channels": [], "warnings": [],
        }
        for index, (name, kind, info, values) in enumerate(zip(raw.ch_names, raw.get_channel_types(), raw.info["chs"], data)):
            valid = np.isfinite(values)
            finite = values[valid]
            sample = finite[::max(1, len(finite) // 20_000)]
            diffs = np.diff(values)
            stat = {
                "name": name, "type": kind, "unit_header": str(info["unit"]),
                "unit_multiplier": int(info["unit_mul"]), "cal": float(info["cal"]), "range": float(info["range"]),
                "nonfinite": int(len(values) - valid.sum()), "min": float(finite.min()), "max": float(finite.max()),
                "mean": float(finite.mean()), "std": float(finite.std()), "rms": float(np.sqrt(np.mean(finite**2))),
                "quantiles_sampled_1_50_99": np.quantile(sample, [0.01, 0.5, 0.99]).tolist(),
                "zero_fraction": float(np.mean(values == 0)),
                "longest_exact_zero_s": longest_run(values == 0) / sfreq,
                "unchanged_adjacent_fraction": float(np.mean(diffs == 0)),
                "changes_per_s": float(np.count_nonzero(diffs) / (len(diffs) / sfreq)),
                "integer_like_sample_fraction": float(np.mean(np.abs(sample - np.round(sample)) < 1e-6)),
                "distinct_sampled_values": int(np.unique(sample).size),
            }
            result["channels"].append(stat)
        result["whole_frame_repeat_fraction"] = float(np.mean(np.all(np.diff(data, axis=1) == 0, axis=0)))
        emg = np.array([index for index, name in enumerate(raw.ch_names) if name.startswith("EMG ")])
        angles = np.array([index for index, name in enumerate(raw.ch_names) if name.startswith("Angle ")])
        result["all_emg_zero_s"] = float(np.count_nonzero(np.all(data[emg] == 0, axis=0)) / sfreq)
        result["all_angles_zero_s"] = float(np.count_nonzero(np.all(data[angles] == 0, axis=0)) / sfreq)
        result["angle_pair_correlation"] = np.corrcoef(data[angles, ::20]).tolist()
        result["warnings"] = [str(message.message) for message in messages]
        if path.name == "Subject_01.fif":
            # Plot an actual 12 s active segment, selected from raw EMG block variance.
            block = int(sfreq * 12)
            positions = np.arange(0, max(1, data.shape[1] - block), block)
            scores = [float(np.std(data[emg, start:start + block])) for start in positions]
            start = int(positions[int(np.argmax(scores))])
            np.savez_compressed(OUTPUT / "ejemplo_subject01.npz", emg=data[emg, start:start+block],
                                angles=data[angles, start:start+block], sfreq=sfreq, start_s=start/sfreq)
        raw.close()
        return result


def main():
    records = []
    for path in sorted(SOURCE.glob("*.fif")):
        try:
            record = inspect(path)
        except Exception as error:
            record = {"file": path.name, "error": str(error)}
        records.append(record)
        (OUTPUT / "auditoria.json").write_text(json.dumps(records, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        print(json.dumps({key: record.get(key) for key in ("file", "duration_s", "n_samples", "sfreq", "error")}), flush=True)
    valid = [record for record in records if "error" not in record]
    with (OUTPUT / "resumen_archivos.csv").open("w", newline="", encoding="utf-8-sig") as out:
        writer = csv.writer(out)
        writer.writerow(["archivo", "bytes", "muestras", "segundos", "Hz", "canales", "no_finitos", "canales_constantes", "anotaciones", "sha256"])
        for record in valid:
            writer.writerow([record["file"], record["size_bytes"], record["n_samples"], record["duration_s"], record["sfreq"],
                             len(record["channels"]), sum(ch["nonfinite"] for ch in record["channels"]),
                             ";".join(ch["name"] for ch in record["channels"] if ch["std"] == 0),
                             json.dumps(record["annotations"], ensure_ascii=False), record["sha256"]])
    with (OUTPUT / "estadisticas_canales.csv").open("w", newline="", encoding="utf-8-sig") as out:
        fields = ["archivo", "name", "type", "unit_header", "nonfinite", "min", "max", "mean", "std", "rms", "zero_fraction", "longest_exact_zero_s", "unchanged_adjacent_fraction", "changes_per_s", "distinct_sampled_values"]
        writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for record in valid:
            for ch in record["channels"]:
                writer.writerow({"archivo": record["file"], **ch})
    summary = {
        "files": len(records), "read_success": len(valid), "size_bytes": sum(r["size_bytes"] for r in valid),
        "samples": sum(r["n_samples"] for r in valid), "hours": sum(r["duration_s"] for r in valid) / 3600,
        "duration_min_s": min(r["duration_s"] for r in valid), "duration_max_s": max(r["duration_s"] for r in valid),
        "sfreqs": sorted(set(r["sfreq"] for r in valid)),
        "channel_order_consistent": all(r["channel_names"] == valid[0]["channel_names"] for r in valid),
        "channel_types_consistent": all(r["channel_types"] == valid[0]["channel_types"] for r in valid),
        "nonfinite": sum(ch["nonfinite"] for r in valid for ch in r["channels"]),
        "constant_channels": [(r["file"], ch["name"]) for r in valid for ch in r["channels"] if ch["std"] == 0],
        "duplicate_file_hashes": [key for key, count in Counter(r["sha256"] for r in valid).items() if count > 1],
        "annotation_counts": dict(Counter(annotation["description"] for r in valid for annotation in r["annotations"])),
        "emg_minmax": [min(ch["min"] for r in valid for ch in r["channels"] if ch["type"] == "emg"), max(ch["max"] for r in valid for ch in r["channels"] if ch["type"] == "emg")],
        "angle_minmax": [min(ch["min"] for r in valid for ch in r["channels"] if ch["name"].startswith("Angle ")), max(ch["max"] for r in valid for ch in r["channels"] if ch["name"].startswith("Angle "))],
    }
    (OUTPUT / "resumen.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=True, indent=2), flush=True)
    render_plots(valid)


def render_plots(valid):
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    fig, axes = plt.subplots(1, 2, figsize=(13, 7), gridspec_kw={"width_ratios": [1, 1.7]}, constrained_layout=True)
    labels = [r["file"].replace("Subject_", "S").replace(".fif", "") for r in valid]
    axes[0].barh(labels, [r["duration_s"] / 60 for r in valid], color="#347b95")
    axes[0].invert_yaxis()
    axes[0].set(xlabel="Duración (min)", title="20 registros de aproximadamente 30 minutos")
    heat = np.array([[ch["std"] for ch in r["channels"] if ch["type"] == "emg"] for r in valid])
    im = axes[1].imshow(heat, aspect="auto", cmap="viridis", interpolation="nearest")
    axes[1].set(xticks=range(8), xticklabels=[f"EMG {i+1}" for i in range(8)], yticks=range(len(labels)), yticklabels=labels,
                title="Variación de amplitud EMG por archivo y canal")
    fig.colorbar(im, ax=axes[1], label="Desviación estándar · valores del archivo, escala física por confirmar")
    fig.suptitle("Datos-Train · estructura y amplitud", fontsize=16, fontweight="bold")
    fig.savefig(OUTPUT / "resumen_dataset.png", dpi=160)
    plt.close(fig)
    sample = np.load(OUTPUT / "ejemplo_subject01.npz")
    t = sample["start_s"] + np.arange(sample["emg"].shape[1]) / float(sample["sfreq"])
    fig, axes = plt.subplots(3, 1, figsize=(13, 8), sharex=True, constrained_layout=True)
    axes[0].plot(t, sample["emg"][0], lw=0.5, color="#147d92")
    axes[0].set(ylabel="EMG 1\nvalor del archivo", title="Subject_01 · segmento de 12 s con actividad EMG")
    for ch in range(3): axes[1].plot(t, sample["angles"][ch], lw=1, label=f"Angle {ch+1}")
    axes[1].set(ylabel="Pulgar · CMC / MCP / IP\nángulo interior (°)")
    axes[1].legend(ncol=3, loc="upper right")
    for ch in range(3, 15): axes[2].plot(t, sample["angles"][ch], lw=0.7, alpha=.8, label=f"Angle {ch+1}")
    axes[2].set(ylabel="Angle 4–15\nángulo interior (°)", xlabel="Tiempo desde el inicio del archivo (s)")
    axes[2].legend(ncol=6, fontsize=8, loc="upper right")
    for ax in axes: ax.grid(alpha=.15)
    fig.suptitle("EMG y referencias angulares · desfase entre modalidades aún sin corregir", fontsize=14, fontweight="bold")
    fig.savefig(OUTPUT / "ejemplo_senales.png", dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    if "--plots-only" in sys.argv:
        render_plots([r for r in json.loads((OUTPUT / "auditoria.json").read_text(encoding="utf-8")) if "error" not in r])
    else:
        main()
