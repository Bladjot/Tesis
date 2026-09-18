"""Read FIF metadata locally without modifying or preloading the recording."""
import json
import sys
import warnings
from collections import Counter
from pathlib import Path

import mne

mne.set_log_level("ERROR")
path = Path(sys.argv[1])
with warnings.catch_warnings(record=True) as messages:
    recording = mne.io.read_raw_fif(path, preload=False, verbose="ERROR")
    metadata = {
        "file": path.name,
        "reader": type(recording).__name__,
        "channels": recording.ch_names,
        "channel_types": recording.get_channel_types(),
        "sampling_hz": recording.info["sfreq"],
        "samples": recording.n_times,
        "duration_s": recording.n_times / recording.info["sfreq"],
        "first_sample": recording.first_samp,
        "description": recording.info.get("description"),
        "filters_hz": {key: recording.info[key] for key in ("highpass", "lowpass")},
        "bads": recording.info["bads"],
        "annotations_counts": dict(Counter(recording.annotations.description)),
        "annotations_first": [
            {"onset": float(onset), "duration": float(duration), "description": str(description)}
            for onset, duration, description in zip(
                recording.annotations.onset[:25], recording.annotations.duration[:25], recording.annotations.description[:25]
            )
        ],
        "channels_info": [{"name": ch["ch_name"], "unit": str(ch["unit"]), "unit_mul": str(ch["unit_mul"]),
                           "cal": ch["cal"], "range": ch["range"]} for ch in recording.info["chs"]],
        "warnings": [str(message.message) for message in messages],
    }
    print(json.dumps(metadata, ensure_ascii=True, indent=2, default=lambda value: value.item() if hasattr(value, "item") else str(value)))
    recording.close()
