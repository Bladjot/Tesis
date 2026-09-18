"""Compare local file checksums to the publisher manifest, without uploading data."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = Path(__file__).resolve().parent
manifest = json.loads((output / "zenodo_metadata.json").read_text(encoding="utf-8"))
results = []
for entry in sorted(manifest["files"], key=lambda entry: entry["key"]):
    path = root / "Datos-Train" / entry["key"]
    with path.open("rb") as source:
        checksum = "md5:" + hashlib.file_digest(source, "md5").hexdigest()
    results.append({"file": path.name, "size_match": path.stat().st_size == entry["size"],
                    "checksum_local": checksum, "checksum_zenodo": entry["checksum"],
                    "checksum_match": checksum == entry["checksum"]})
(output / "verificacion_origen.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps({"files": len(results), "matching": sum(r["checksum_match"] and r["size_match"] for r in results)}))
