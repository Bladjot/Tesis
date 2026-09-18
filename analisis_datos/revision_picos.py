"""Read-only peak audit of Subject_07 and Subject_20 in stored EMG units."""
from pathlib import Path
import json

import mne
import numpy as np


ROOT = Path(__file__).resolve().parents[1]


def main():
    report = {"method": "Per-channel population std on the full recording; threshold abs(x)>10*std, no filtering or unit conversion. Episode envelopes merge above-threshold samples separated by at most 100ms. Envelope duration includes intervening below-threshold samples and is not itself abnormal-sample duration.",
              "files": []}
    for subject in [7, 20]:
        path = ROOT / "Datos-Train" / f"Subject_{subject:02d}.fif"
        raw = mne.io.read_raw_fif(path, preload=False, verbose="ERROR")
        picks = [name for name in raw.ch_names if name.startswith("EMG")]
        values = raw.get_data(picks=picks)
        sfreq = float(raw.info["sfreq"])
        stds = np.std(values, axis=1)
        mask = np.abs(values) > 10*stds[:, None]
        any_mask = np.any(mask, axis=0)
        indices = np.flatnonzero(any_mask)
        peak_channel, peak_sample = np.unravel_index(np.argmax(np.abs(values)), values.shape)
        peak_channel, peak_sample = int(peak_channel), int(peak_sample)
        groups = np.split(indices, np.flatnonzero(np.diff(indices)>int(round(.1*sfreq)))+1) if indices.size else []
        episodes = [{"start_s": float(g[0]/sfreq), "end_s_exclusive": float((g[-1]+1)/sfreq),
                     "envelope_duration_s": float((g[-1]-g[0]+1)/sfreq),
                     "above_threshold_sample_times": int(g.size), "above_threshold_duration_s": float(g.size/sfreq),
                     "contains_global_peak": bool(g[0]<=peak_sample<=g[-1]),
                     "max_abs_amplitude": float(np.max(np.abs(values[:,g[0]:g[-1]+1])))} for g in groups]
        primary_indices = np.flatnonzero(mask[peak_channel])
        primary_groups = np.split(primary_indices, np.flatnonzero(np.diff(primary_indices)>int(round(.1*sfreq)))+1)
        primary_episode = next(g for g in primary_groups if g[0]<=peak_sample<=g[-1])
        primary_summary = {"channel": picks[peak_channel], "start_s": float(primary_episode[0]/sfreq),
            "end_s_exclusive": float((primary_episode[-1]+1)/sfreq),
            "envelope_duration_s": float((primary_episode[-1]-primary_episode[0]+1)/sfreq),
            "above_threshold_sample_times": int(primary_episode.size),
            "above_threshold_duration_s": float(primary_episode.size/sfreq)}
        channels = {}
        for i,name in enumerate(picks):
            channels[name] = {"std": float(stds[i]), "threshold_10_std": float(10*stds[i]),
                              "count_above_threshold": int(mask[i].sum()),
                              "fraction_above_threshold": float(mask[i].mean()),
                              "duration_above_threshold_s": float(mask[i].sum()/sfreq),
                              "max_abs": float(np.max(np.abs(values[i]))),
                              "p999_abs": float(np.quantile(np.abs(values[i]), .999))}
        start, stop = max(0, peak_sample-int(sfreq)), min(values.shape[1], peak_sample+int(sfreq)+1)
        local = values[:, start:stop]
        item = {"file": str(path.relative_to(ROOT)), "sample_rate_hz": sfreq,
                "n_samples": int(values.shape[1]), "duration_s": float(values.shape[1]/sfreq),
                "peak": {"channel": picks[peak_channel], "sample": peak_sample,
                         "time_s": peak_sample/sfreq, "signed_value": float(values[peak_channel,peak_sample]),
                         "abs_over_channel_std": float(abs(values[peak_channel,peak_sample])/stds[peak_channel])},
                "peak_channel_episode_100ms_merge": primary_summary,
                "channels": channels,
                "all_channels": {"affected_channel_sample_values": int(mask.sum()),
                                 "fraction_channel_sample_values": float(mask.mean()),
                                 "affected_sample_times": int(any_mask.sum()),
                                 "fraction_sample_times": float(any_mask.mean()),
                                 "duration_any_channel_above_threshold_s": float(any_mask.sum()/sfreq)},
                "peak_local_context": {"start_s": start/sfreq, "end_s_exclusive": stop/sfreq,
                    "channels": {name: {"min": float(local[i].min()), "max": float(local[i].max()),
                               "count_above_threshold": int(mask[i,start:stop].sum())} for i,name in enumerate(picks)}},
                "episodes_100ms_merge": episodes}
        report["files"].append(item)
    output = Path(__file__).with_suffix(".json")
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(json.dumps({"output": str(output), "files": [{"file": x["file"], "peak": x["peak"], "all_channels": x["all_channels"], "peak_episode": [e for e in x["episodes_100ms_merge"] if e["contains_global_peak"]]} for x in report["files"]]}, indent=2))


if __name__ == "__main__":
    main()
