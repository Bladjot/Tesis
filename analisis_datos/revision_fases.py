"""Read-only comparison around Subject_01's 'model trained' annotation.

No assumption is made about whether Angle channels are measured or inferred.
Run with the project's .venv-analysis interpreter. Only the JSON report is written.
"""
from pathlib import Path
import json

import mne
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Datos-Train" / "Subject_01.fif"
OUTPUT = Path(__file__).with_suffix(".json")


def channel_stats(values, sfreq):
    result = []
    for row in values:
        finite = row[np.isfinite(row)]
        delta = np.diff(row)
        delta = delta[np.isfinite(delta)]
        result.append({
            "samples": int(row.size), "nonfinite": int(row.size - finite.size),
            "min": float(finite.min()), "max": float(finite.max()),
            "mean": float(finite.mean()), "std": float(finite.std()),
            "rms": float(np.sqrt(np.mean(finite ** 2))),
            "quantiles_p01_p25_p50_p75_p99": np.quantile(finite, [.01, .25, .5, .75, .99]).tolist(),
            "zero_fraction": float(np.mean(finite == 0)),
            "outside_0_90_fraction": float(np.mean((finite < 0) | (finite > 90))),
            "identical_adjacent_fraction": float(np.mean(delta == 0)),
            "abs_step_median_p95_p99_max": np.quantile(np.abs(delta), [.5, .95, .99, 1]).tolist(),
            "rms_derivative_per_second": float(np.sqrt(np.mean(delta ** 2)) * sfreq),
        })
    return result


def summarize(raw, picks, start, stop):
    start, stop = int(start), int(stop)
    values = raw.get_data(picks=picks, start=start, stop=stop)
    metrics = channel_stats(values, raw.info["sfreq"])
    angles = values[[i for i, name in enumerate(picks) if name.startswith("Angle")]]
    unchanged = np.all(np.diff(angles, axis=1) == 0, axis=0)
    changes = np.r_[0, np.flatnonzero(~unchanged)+1, angles.shape[1]]
    runs = np.diff(changes)
    lengths, counts = np.unique(runs, return_counts=True)
    return {"start_sample": start, "stop_sample_exclusive": stop,
            "duration_s": (stop-start)/raw.info["sfreq"],
            "all_angle_channels_unchanged_adjacent_fraction": float(unchanged.mean()),
            "all_angle_identical_run_lengths_samples_counts": dict(zip(lengths.astype(str).tolist(), counts.tolist())),
            "channels": dict(zip(picks, metrics))}


def main():
    raw = mne.io.read_raw_fif(SOURCE, preload=False, verbose="ERROR")
    sfreq = float(raw.info["sfreq"])
    onset = next(float(a["onset"]) for a in raw.annotations if a["description"] == "model trained")
    boundary = int(round((onset-raw.first_time)*sfreq))
    picks = [name for name in raw.ch_names if name.startswith("EMG") or name.startswith("Angle")]
    result = {"source": str(SOURCE.relative_to(ROOT)), "sample_rate_hz": sfreq,
              "annotation_onset_s": onset, "boundary_sample": boundary,
              "method": "Exact finite-sample statistics in each interval; population std; no filtering/resampling; original stored scale as read by MNE.",
              "caveat": "Angle provenance, anatomical order and physical units are not established by these statistics. The annotation alone does not label train/test or measured/inferred data.",
              "phases": {}}
    for label, start, stop in [
        ("before_annotation", 0, boundary),
        ("after_annotation", boundary, raw.n_times),
        ("last_60s_before", max(0, boundary-int(60*sfreq)), boundary),
        ("first_60s_after", boundary, min(raw.n_times, boundary+int(60*sfreq))),
    ]:
        result["phases"][label] = summarize(raw, picks, start, stop)
    before = result["phases"]["before_annotation"]["channels"]
    after = result["phases"]["after_annotation"]["channels"]
    result["full_phase_comparison"] = {}
    for name in picks:
        a, b = before[name], after[name]
        pooled_std = np.sqrt((a["std"]**2+b["std"]**2)/2)
        result["full_phase_comparison"][name] = {
            "mean_shift": b["mean"]-a["mean"],
            "standardized_mean_shift": (b["mean"]-a["mean"])/pooled_std if pooled_std else None,
            "std_ratio_after_before": b["std"]/a["std"] if a["std"] else None,
            "rms_ratio_after_before": b["rms"]/a["rms"] if a["rms"] else None,
            "adjacent_repeat_fraction_change": b["identical_adjacent_fraction"]-a["identical_adjacent_fraction"],
        }
    around = raw.get_data(picks=picks, start=boundary-1, stop=boundary+1)
    result["step_at_boundary"] = dict(zip(picks, (around[:,1]-around[:,0]).tolist()))
    result["blocks_60s"] = []
    block = int(60*sfreq)
    for start in range(0, raw.n_times, block):
        stop = min(raw.n_times, start+block)
        values = raw.get_data(picks=picks, start=start, stop=stop)
        result["blocks_60s"].append({
            "start_s": start/sfreq, "end_s": stop/sfreq,
            "all_angle_channels_unchanged_adjacent_fraction": float(np.mean(np.all(np.diff(values[8:], axis=1)==0, axis=0))),
            "channels": {name: {"mean": float(np.mean(row)), "std": float(np.std(row)),
                                "rms": float(np.sqrt(np.mean(row**2)))}
                         for name,row in zip(picks, values)}})
    OUTPUT.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "phases": {k:v["duration_s"] for k,v in result["phases"].items()},
                      "comparisons": result["full_phase_comparison"]}, indent=2))


if __name__ == "__main__":
    main()
