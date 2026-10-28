"""Folder locations, read from the environment each time so tests can redirect them."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    return Path(value) if value else default


def data_dir() -> Path:
    return _path("DATA_DIR", ROOT / "data")


def uploads_dir() -> Path:
    return data_dir() / "uploads"


def registry_file() -> Path:
    return data_dir() / "registry.json"


def samples_dir() -> Path:
    return _path("SAMPLES_DIR", ROOT / "data" / "samples")


def outputs_dir() -> Path:
    return _path("OUTPUTS_DIR", ROOT / "outputs")


def eval_results_file() -> Path:
    return _path("EVAL_RESULTS", ROOT / "eval" / "results.json")


def jsonl_path(doc_id: str, method: str) -> Path:
    return outputs_dir() / f"{doc_id}_{method}.jsonl"


def max_upload_bytes() -> int:
    try:
        megabytes = float(os.getenv("MAX_UPLOAD_MB", "20"))
    except ValueError:
        megabytes = 20.0
    return int(megabytes * 1024 * 1024)
