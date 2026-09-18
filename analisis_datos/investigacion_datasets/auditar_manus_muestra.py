"""Lee un CSV público mediante HTTP Range; no descarga el archivo ZIP completo."""
import io
import json
import pathlib
import zipfile

import numpy as np
import requests

ROOT = pathlib.Path(__file__).resolve().parent
META = json.loads((ROOT / "fuentes/semg_manus_metadata.json").read_text(encoding="utf-8"))
ARCHIVE = next(f for f in META["files"] if f["key"].endswith(".zip"))


class RemoteZip(io.RawIOBase):
    def __init__(self):
        self.position = 0
        self.size = ARCHIVE["size"]
        self.bytes_read = 0

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position

    def read(self, size=-1):
        size = min(size if size >= 0 else self.size, self.size - self.position)
        if size <= 0:
            return b""
        start = self.position
        with requests.get(ARCHIVE["links"]["self"], headers={"Range": f"bytes={start}-{start+size-1}"}, stream=True, timeout=45) as response:
            if response.status_code != 206:
                raise RuntimeError(f"Servidor no permite lectura parcial: HTTP {response.status_code}; descarga cancelada")
            if not response.headers.get("Content-Range", "").startswith(f"bytes {start}-"):
                raise RuntimeError("Rango de respuesta incorrecto")
            content = response.content
        self.position += len(content)
        self.bytes_read += len(content)
        return content


remote = RemoteZip()
with zipfile.ZipFile(remote) as archive:
    entries = [x for x in archive.infolist() if x.filename.endswith(".csv")]
    candidates = [x for x in entries if "/u_3/" in x.filename and "/g_flexext_fist/" in x.filename and "medium" in x.filename]
    entry = candidates[0]
    content = archive.read(entry)
    target = ROOT / "fuentes/manus_muestra_flexext_fist.csv"
    target.write_bytes(content)
    values = np.loadtxt(io.BytesIO(content), delimiter=",")
    header = content.splitlines()[0].decode().lstrip("# ").split(",")
    stats = [{"channel": name, "min": float(values[:, i].min()), "max": float(values[:, i].max()), "std": float(values[:, i].std())} for i, name in enumerate(header)]
    report = {"source": "https://zenodo.org/records/19261324", "archive_bytes": remote.size, "downloaded_bytes": remote.bytes_read, "archive_csv_count": len(entries), "sample_path": entry.filename, "sample_crc32_checked_by_zipfile": True, "shape": list(values.shape), "nonfinite": int((~np.isfinite(values)).sum()), "repeated_adjacent_full_glove_frames_fraction": float(np.all(np.diff(values[:, 18:38], axis=0) == 0, axis=1).mean()), "channels": stats, "scope": "Una grabación: no certifica calidad global ni frecuencia real; CSV no conserva timestamps."}
    (ROOT / "manus_sample_audit.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
