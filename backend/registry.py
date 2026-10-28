"""data/registry.json: document metadata, last settings and last ProcessResult per document.

Writes are atomic (temp file + rename) and serialised with a lock. After a restart, a document
whose registry status is "ready" (and whose collections exist) is still usable.
"""

from __future__ import annotations

import json
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import paths

_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_doc_id() -> str:
    with _lock:
        existing = _read()
        while True:
            doc_id = f"doc_{secrets.token_hex(4)}"
            if doc_id not in existing:
                return doc_id


def _read() -> dict[str, dict[str, Any]]:
    file = paths.registry_file()
    if not file.exists():
        return {}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict[str, dict[str, Any]]) -> None:
    file = paths.registry_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(file)


def create(
    doc_id: str, filename: str, path: Path, pages: int, size_bytes: int, warnings: list[str], owner: str
) -> dict[str, Any]:
    entry = {
        "doc_id": doc_id,
        "owner": owner,
        "filename": filename,
        "path": str(path),
        "pages": pages,
        "size_bytes": size_bytes,
        "created_at": now_iso(),
        "status": "uploaded",
        "smart_chunk_count": None,
        "naive_chunk_count": None,
        "summary_preview": "",
        "upload_warnings": warnings,
        "settings": None,
        "result": None,
        "summary": None,
        "error_message": None,
    }
    with _lock:
        data = _read()
        data[doc_id] = entry
        _write(data)
    return entry


def get(doc_id: str) -> dict[str, Any] | None:
    with _lock:
        return _read().get(doc_id)


def update(doc_id: str, **changes: Any) -> dict[str, Any] | None:
    with _lock:
        data = _read()
        entry = data.get(doc_id)
        if entry is None:
            return None
        entry.update(changes)
        _write(data)
        return entry


def delete(doc_id: str) -> bool:
    with _lock:
        data = _read()
        if doc_id not in data:
            return False
        del data[doc_id]
        _write(data)
        return True


def list_all() -> list[dict[str, Any]]:
    with _lock:
        return sorted(_read().values(), key=lambda entry: entry.get("created_at", ""), reverse=True)
