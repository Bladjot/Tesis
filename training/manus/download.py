"""Download and safely extract the pinned sEMG-MANUS v1.0 release.

Python >= 3.10, standard library only. No training and no downloaded code execution.
Run: python training/manus/download.py --root datasets/semg_manus/raw
Interrupted downloads resume using HTTP Range; verified files are reused.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import time
from datetime import datetime, timezone
import urllib.error
import urllib.request
import zipfile
import zlib

RECORD_ID = 19261324
RECORD_URL = f"https://zenodo.org/api/records/{RECORD_ID}"
ARCHIVE = "semg-manus-dataset-v1.zip"
ARCHIVE_SIZE = 594438686
ARCHIVE_MD5 = "2d3975173cd6b6832d50d0be0948e1f0"
ARCHIVE_SHA256 = "2d9e1df613485b9a4afe9a5a71010ca84e75a521b596f836a195b5eaf3dc1f29"
FILES = {ARCHIVE, "manifest.csv", "DATA_QUALITY.md", "LICENSE-data-CC-BY-4.0.txt", "README.md", "checksums.txt", "CODEBOOK.md"}
CHUNK = 1024 * 1024
HEADERS = {"User-Agent": "sEMG-MANUS-reproducible-downloader/1.0", "Accept-Encoding": "identity"}
NETWORK_ERRORS = (OSError, urllib.error.URLError, TimeoutError, http.client.HTTPException)


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    print(f"[{utc()}] {message}", flush=True)


def atomic_json(path: Path, value: object) -> None:
    temp = path.with_name(path.name + ".tmp")
    refuse_link(path)
    refuse_link(temp)
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


def refuse_link(path: Path) -> None:
    # Junctions/reparse points can escape a target tree on Windows.
    if path.is_symlink():
        raise ValueError(f"Refusing symbolic link: {path}")
    if path.exists() and getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
        raise ValueError(f"Refusing Windows reparse point: {path}")


def hashes(path: Path) -> dict[str, str]:
    md5 = hashlib.md5(usedforsecurity=False)
    sha256 = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            md5.update(chunk)
            sha256.update(chunk)
    return {"md5": md5.hexdigest(), "sha256": sha256.hexdigest()}


def fetch_metadata(timeout: int, retries: int) -> dict:
    for attempt in range(retries):
        try:
            request = urllib.request.Request(RECORD_URL, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read(2 * 1024 * 1024 + 1)
            if len(payload) > 2 * 1024 * 1024:
                raise ValueError("Unexpectedly large record metadata")
            metadata = json.loads(payload)
            if int(metadata["id"]) != RECORD_ID or metadata["metadata"].get("version") != "1.0":
                raise ValueError("Record/version does not match pinned sEMG-MANUS v1.0")
            records = {item["key"]: item for item in metadata["files"]}
            if set(records) != FILES or len(metadata["files"]) != len(FILES):
                raise ValueError("Unexpected file set in pinned record")
            archive = records[ARCHIVE]
            if archive["size"] != ARCHIVE_SIZE or archive["checksum"] != "md5:" + ARCHIVE_MD5:
                raise ValueError("Archive metadata changed from pinned release")
            for name, item in records.items():
                if not re.fullmatch(r"md5:[0-9a-f]{32}", item["checksum"]):
                    raise ValueError(f"Unsupported checksum for {name}")
                if not isinstance(item["size"], int) or item["size"] <= 0:
                    raise ValueError(f"Invalid size for {name}")
            return metadata
        except NETWORK_ERRORS as exc:
            if attempt + 1 == retries:
                raise
            log(f"Metadata retry {attempt + 1}/{retries}: {exc}")
            time.sleep(min(2 ** attempt, 8))
    raise RuntimeError("Metadata retry exhausted")


def download_ranges(url: str, root: Path, part: Path, expected_size: int, timeout: int, retries: int, workers: int) -> Path:
    """Preserve a sequential prefix, resume <=4 suffix ranges, then assemble."""
    parts_dir = root / (ARCHIVE + ".ranges")
    refuse_link(parts_dir)
    parts_dir.mkdir(exist_ok=True)
    plan_path = parts_dir / "plan.json"
    refuse_link(plan_path)
    if plan_path.exists():
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        if plan.get("size") != expected_size or plan.get("url") != url:
            raise ValueError("Range plan does not match pinned archive")
        prefix = plan["prefix_bytes"]
        ranges = plan["ranges"]
    else:
        prefix = part.stat().st_size if part.exists() else 0
        if not 0 <= prefix < expected_size:
            raise ValueError("Invalid prefix size for parallel download")
        step = (expected_size - prefix + workers - 1) // workers
        ranges = [[start, min(start + step, expected_size)] for start in range(prefix, expected_size, step)]
        plan = {"url": url, "size": expected_size, "prefix_bytes": prefix, "ranges": ranges}
        atomic_json(plan_path, plan)
    if not isinstance(prefix, int) or not 0 <= prefix < expected_size or not 1 <= len(ranges) <= 4:
        raise ValueError("Invalid persisted range plan")
    cursor = prefix
    for start, stop in ranges:
        if start != cursor or not start < stop <= expected_size:
            raise ValueError("Non-contiguous range plan")
        cursor = stop
    if cursor != expected_size or (part.stat().st_size if part.exists() else 0) != prefix:
        raise ValueError("Range plan prefix/size changed; inspect partial downloads")
    log(f"Parallel download: preserving {prefix:,} bytes; {len(ranges)} ranges, max {workers} connections")

    def fetch_range(index: int, start: int, stop: int) -> Path:
        destination = parts_dir / f"range-{index}.part"
        refuse_link(destination)
        expected_length = stop - start
        for attempt in range(retries):
            offset = destination.stat().st_size if destination.exists() else 0
            if offset > expected_length:
                raise ValueError("Range partial exceeds expected length")
            if offset == expected_length:
                return destination
            headers = {**HEADERS, "Range": f"bytes={start + offset}-{stop - 1}"}
            try:
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    expected_range = f"bytes {start + offset}-{stop - 1}/{expected_size}"
                    if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                        raise ValueError("Server did not honor exact byte range; use --workers 1 to resume sequentially")
                    if response.headers.get("Content-Encoding", "identity") != "identity":
                        raise ValueError("Unexpected range content encoding")
                    last_report = time.monotonic()
                    with destination.open("ab") as stream:
                        while chunk := response.read(CHUNK):
                            offset += len(chunk)
                            if offset > expected_length:
                                raise ValueError("Range response exceeded requested length")
                            stream.write(chunk)
                            if time.monotonic() - last_report >= 15:
                                log(f"Range {index + 1}/{len(ranges)}: {offset:,}/{expected_length:,} bytes ({offset / expected_length:.1%})")
                                last_report = time.monotonic()
                        stream.flush()
                        os.fsync(stream.fileno())
                if offset == expected_length:
                    log(f"Range {index + 1} complete: {offset:,} bytes")
                    return destination
                raise OSError("Incomplete range response")
            except NETWORK_ERRORS as exc:
                if attempt + 1 == retries:
                    raise
                log(f"Range {index + 1} retry {attempt + 1}/{retries}: {exc}")
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError("Range retry exhausted")

    with ThreadPoolExecutor(max_workers=min(workers, 4)) as executor:
        futures = [executor.submit(fetch_range, index, start, stop) for index, (start, stop) in enumerate(ranges)]
        chunks = [future.result() for future in futures]
    assembled = root / (ARCHIVE + ".assembled")
    refuse_link(assembled)
    with assembled.open("wb") as destination:
        sources = ([part] if prefix else []) + chunks
        for source in sources:
            with source.open("rb") as stream:
                shutil.copyfileobj(stream, destination, CHUNK)
        destination.flush()
        os.fsync(destination.fileno())
    if assembled.stat().st_size != expected_size:
        raise ValueError("Assembled file size mismatch")
    return assembled


def cleanup_ranges(root: Path) -> None:
    parts_dir = root / (ARCHIVE + ".ranges")
    refuse_link(parts_dir)
    if not parts_dir.exists():
        return
    parts_dir.resolve().relative_to(root)
    for item in parts_dir.iterdir():
        if item.name != "plan.json" and not re.fullmatch(r"range-[0-3]\.part", item.name):
            raise ValueError(f"Unexpected file in owned range directory: {item}")
        refuse_link(item)
        item.unlink()
    parts_dir.rmdir()


def download(item: dict, root: Path, timeout: int, retries: int, workers: int = 1) -> dict:
    name, expected_size = item["key"], item["size"]
    expected_md5 = item["checksum"].split(":", 1)[1]
    destination = root / name
    part = root / (name + ".part")
    refuse_link(destination)
    refuse_link(part)
    if destination.exists():
        observed = hashes(destination)
        if destination.stat().st_size != expected_size or observed["md5"] != expected_md5:
            raise ValueError(f"Existing file fails verification; inspect it before removing: {destination}")
        log(f"Verified existing {name}")
        return {"name": name, "size_bytes": expected_size, **observed, "verified_utc": utc(), "reused": True}

    # Build a URL from pinned identifiers; do not follow arbitrary metadata links.
    url = f"https://zenodo.org/api/records/{RECORD_ID}/files/{name}/content"
    verification_target = part
    use_parallel = name == ARCHIVE and workers > 1 and (part.stat().st_size if part.exists() else 0) < expected_size
    if use_parallel:
        verification_target = download_ranges(url, root, part, expected_size, timeout, retries, workers)
    for attempt in range(retries):
        if use_parallel:
            break
        offset = part.stat().st_size if part.exists() else 0
        if offset > expected_size:
            raise ValueError(f"Partial file exceeds expected size: {part}")
        if offset == expected_size:
            break
        request_headers = dict(HEADERS)
        if offset:
            request_headers["Range"] = f"bytes={offset}-"
        try:
            log(f"Downloading {name}: {offset:,}/{expected_size:,} bytes")
            request = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status == 206:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if not match or int(match[1]) != offset or int(match[3]) != expected_size:
                        raise ValueError("Server returned an inconsistent Content-Range")
                elif response.status == 200:
                    if offset:
                        log("Server ignored Range; restarting this partial download safely")
                    offset = 0
                else:
                    raise ValueError(f"Unexpected HTTP status: {response.status}")
                if response.headers.get("Content-Encoding", "identity") != "identity":
                    raise ValueError("Unexpected content encoding during binary download")
                last_report = time.monotonic()
                with part.open("ab" if offset else "wb") as stream:
                    while chunk := response.read(CHUNK):
                        offset += len(chunk)
                        if offset > expected_size:
                            raise ValueError("Server sent more bytes than the pinned file size")
                        stream.write(chunk)
                        if time.monotonic() - last_report >= 10:
                            log(f"{name}: {offset:,}/{expected_size:,} bytes ({offset / expected_size:.1%})")
                            last_report = time.monotonic()
                    stream.flush()
                    os.fsync(stream.fileno())
            if offset == expected_size:
                break
            raise OSError(f"Incomplete response: {offset}/{expected_size} bytes")
        except NETWORK_ERRORS as exc:
            if attempt + 1 == retries:
                raise
            log(f"Download retry {attempt + 1}/{retries}: {exc}")
            time.sleep(min(2 ** attempt, 8))
    if not verification_target.exists() or verification_target.stat().st_size != expected_size:
        raise ValueError(f"Download size mismatch: {name}")
    observed = hashes(verification_target)
    if observed["md5"] != expected_md5:
        raise ValueError(f"MD5 mismatch for {part}; corrupt partial retained for inspection")
    if name == ARCHIVE and observed["sha256"] != ARCHIVE_SHA256:
        raise ValueError("Pinned archive SHA-256 mismatch")
    verification_target.replace(destination)
    if use_parallel and part.exists():
        part.unlink()
    if name == ARCHIVE:
        cleanup_ranges(root)
    log(f"Verified download {name}: {expected_size:,} bytes, MD5 {observed['md5']}")
    return {"name": name, "url": url, "size_bytes": expected_size, **observed, "verified_utc": utc(), "reused": False}


def verify_checksums(root: Path, receipts: list[dict]) -> None:
    expected = {}
    for line in (root / "checksums.txt").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, name = line.split(maxsplit=1)
        name = name.lstrip("*")
        if name not in FILES - {"checksums.txt"} or name in expected or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Unexpected checksums.txt entry")
        expected[name] = digest
    if set(expected) != FILES - {"checksums.txt"} or expected[ARCHIVE] != ARCHIVE_SHA256:
        raise ValueError("checksums.txt does not match expected release")
    for receipt in receipts:
        if receipt["name"] in expected and receipt["sha256"] != expected[receipt["name"]]:
            raise ValueError(f"SHA-256 mismatch for {receipt['name']}")
    log("All seven files pass published MD5; six payloads also pass published SHA-256")


def safe_target(root: Path, member: zipfile.ZipInfo) -> Path:
    name = member.filename
    if "\\" in name or "\x00" in member.orig_filename or name.startswith("/"):
        raise ValueError(f"Unsafe ZIP path: {name!r}")
    parts = name.rstrip("/").split("/")
    if not parts or parts[0] != "data" or any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"Unexpected ZIP path: {name!r}")
    for part in parts:
        stem = part.split(".", 1)[0].upper()
        if any(char in part for char in '<>:"|?*') or part.endswith((".", " ")) or any(ord(c) < 32 for c in part):
            raise ValueError(f"Unsafe Windows filename: {name!r}")
        if stem in {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} or re.fullmatch(r"(?:COM|LPT)[1-9¹²³]", stem):
            raise ValueError(f"Reserved Windows filename: {name!r}")
    mode = member.external_attr >> 16
    if stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}:
        raise ValueError(f"Links/special files are not permitted: {name}")
    if member.flag_bits & 1:
        raise ValueError(f"Encrypted member is not permitted: {name}")
    target = root.joinpath(*PurePosixPath(name).parts)
    target.resolve().relative_to(root)
    cursor = root
    for part in parts:
        cursor = cursor / part
        refuse_link(cursor)
    return target


def crc32(path: Path) -> int:
    checksum = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            checksum = zlib.crc32(chunk, checksum)
    return checksum & 0xFFFFFFFF


def extract(root: Path) -> dict:
    with zipfile.ZipFile(root / ARCHIVE) as archive:
        members = archive.infolist()
        seen = set()
        targets = []
        for member in members:
            target = safe_target(root, member)
            canonical = str(target).casefold()
            if canonical in seen:
                raise ValueError(f"Duplicate/case-colliding member: {member.filename}")
            seen.add(canonical)
            targets.append((member, target))
        total = sum(member.file_size for member in members if not member.is_dir())
        free = shutil.disk_usage(root).free
        existing = sum(target.stat().st_size for member, target in targets if not member.is_dir() and target.is_file())
        required = max(0, total - existing) + max((m.file_size for m in members), default=0) + 256 * 1024 * 1024
        log(f"ZIP preflight: {len(members):,} entries, {total:,} uncompressed bytes; disk free {free:,}, required {required:,}")
        if free < required:
            raise OSError("Insufficient free space for safe extraction (includes temporary file and reserve)")
        count = reused = 0
        last_report = time.monotonic()
        for member, target in targets:
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            safe_target(root, member)
            if target.exists():
                if target.stat().st_size == member.file_size and crc32(target) == member.CRC:
                    reused += 1
                    count += 1
                    continue
                raise ValueError(f"Existing extracted file fails ZIP CRC/size: {target}")
            temporary = target.with_name(target.name + ".extracting")
            refuse_link(temporary)
            written = 0
            with archive.open(member) as source, temporary.open("wb") as destination:
                while chunk := source.read(CHUNK):
                    written += len(chunk)
                    if written > member.file_size:
                        raise ValueError(f"Extracted member exceeds expected size: {member.filename}")
                    destination.write(chunk)
            # Reading through EOF in ZipExtFile checks the member CRC.
            if written != member.file_size:
                raise ValueError(f"Extracted member size mismatch: {member.filename}")
            temporary.replace(target)
            count += 1
            if time.monotonic() - last_report >= 10:
                log(f"Extracted/verified {count:,} files")
                last_report = time.monotonic()
        log(f"Extraction complete: {count:,} files ({reused:,} reused with CRC verification)")
        return {"completed_utc": utc(), "files": count, "reused_files": reused, "zip_entries": len(members), "uncompressed_bytes": total, "disk_free_before_bytes": free, "disk_free_after_bytes": shutil.disk_usage(root).free, "crc_verified": True, "manifest_sha256_verified": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("datasets/semg_manus/raw"))
    parser.add_argument("--timeout", type=int, default=60, help="Socket timeout in seconds")
    parser.add_argument("--retries", type=int, default=8)
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 5), help="Archive HTTP connections (1-4)")
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    if args.timeout <= 0 or args.retries <= 0:
        parser.error("timeout and retries must be positive")
    refuse_link(args.root)
    args.root.mkdir(parents=True, exist_ok=True)
    root = args.root.resolve()
    started = utc()
    receipt = {"record_id": RECORD_ID, "record_url": RECORD_URL, "version": "1.0", "root": str(root), "started_utc": started, "status": "in_progress", "files": []}
    receipt_path = root / "download_receipt.json"
    try:
        metadata = fetch_metadata(args.timeout, args.retries)
        atomic_json(root / "zenodo_metadata.json", metadata)
        atomic_json(receipt_path, receipt)
        items = {item["key"]: item for item in metadata["files"]}
        # Make the manifest and documentation available before the large archive.
        order = ["checksums.txt", "manifest.csv", "CODEBOOK.md", "DATA_QUALITY.md", "README.md", "LICENSE-data-CC-BY-4.0.txt", ARCHIVE]
        for name in order:
            receipt["files"].append(download(items[name], root, args.timeout, args.retries, args.workers))
            atomic_json(receipt_path, receipt)
        verify_checksums(root, receipt["files"])
        receipt["published_hashes_verified"] = True
        if not args.download_only:
            receipt["extraction"] = extract(root)
        receipt["status"] = "download_verified" if args.download_only else "complete"
        receipt["completed_utc"] = utc()
        atomic_json(receipt_path, receipt)
        log(f"Ready: {root}")
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        receipt["status"] = "interrupted" if isinstance(exc, KeyboardInterrupt) else "failed"
        receipt["error"] = f"{type(exc).__name__}: {exc}"
        receipt["updated_utc"] = utc()
        atomic_json(receipt_path, receipt)
        log(f"Stopped: {receipt['error']}. Re-run the same command to resume verified partial progress.")
        return 130 if isinstance(exc, KeyboardInterrupt) else 1


if __name__ == "__main__":
    sys.exit(main())
