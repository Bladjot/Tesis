"""Verifica metadatos públicos y un par DB5/DB9, sin descargar bases completas.

Sólo descarga en memoria dos ZIP oficiales (~36.5 MB); no ejecuta su contenido.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import urllib.request
import zipfile

import numpy as np
from scipy.io import loadmat


OUT = Path(__file__).resolve().parent
URLS = {
    "DB5_s1": "https://ninapro.hevs.ch/files/DB5_Preproc/s1.zip",
    "DB9_s68": "https://ninapro.hevs.ch/files/DB9/DB5/s_68_angles.zip",
}


def download(item):
    key, url = item
    with urllib.request.urlopen(url, timeout=45) as response:
        limit = int(response.headers.get("Content-Length", "0"))
        if not 0 < limit < 25_000_000:
            raise ValueError(f"Unexpected size: {limit}")
        blob = response.read(limit + 1)
    if len(blob) != limit:
        raise ValueError("Unexpected byte count")
    matrices = {}
    with zipfile.ZipFile(BytesIO(blob)) as archive:
        for entry in archive.infolist():
            if entry.filename.endswith(".mat") and not entry.filename.startswith("__MACOSX"):
                data = loadmat(BytesIO(archive.read(entry)), squeeze_me=True)
                matrices[entry.filename] = data
    return key, matrices


def summarize(data):
    out = {}
    for name, value in data.items():
        if name.startswith("__"):
            continue
        a = np.asarray(value)
        info = {"shape": list(a.shape), "dtype": str(a.dtype)}
        if a.size < 100:
            info["values"] = a.tolist()
        elif np.issubdtype(a.dtype, np.number):
            info.update(min=float(np.nanmin(a)), max=float(np.nanmax(a)))
        out[name] = info
    return out


def main():
    results = dict(ThreadPoolExecutor(2).map(download, URLS.items()))
    evidence = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "urls": URLS,
        "matrices": {key: {name: summarize(data) for name, data in group.items()}
                     for key, group in results.items()},
        "pair_comparisons": [],
    }
    for original_name, original in results["DB5_s1"].items():
        for calibrated_name, calibrated in results["DB9_s68"].items():
            if "glove" not in original or "glove" not in calibrated:
                continue
            a, b = original["glove"], calibrated["glove"]
            same_shape = a.shape == b.shape
            result = {"original": original_name, "calibrated": calibrated_name,
                      "same_shape": same_shape}
            if same_shape:
                result["glove_equal"] = bool(np.array_equal(a, b))
                result["glove_max_abs_error"] = float(np.nanmax(np.abs(a - b)))
                for name in ("restimulus", "rerepetition", "stimulus", "repetition"):
                    if name in original and name in calibrated:
                        result[name + "_equal"] = bool(np.array_equal(original[name], calibrated[name]))
            evidence["pair_comparisons"].append(result)
    path = OUT / "ninapro_pair_audit.json"
    path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(path)
    print(json.dumps(evidence["pair_comparisons"], indent=2))


if __name__ == "__main__":
    main()
