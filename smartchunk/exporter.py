"""JSON/JSONL output (spec B4 "JSON output"): one Chunk per line, exactly the A6 fields."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import Chunk


def chunk_to_dict(chunk: Chunk) -> dict[str, Any]:
    return chunk.to_dict()


def to_jsonl(chunks: list[Chunk], path: Path | str) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(chunk_to_dict(chunk), ensure_ascii=False))
            handle.write("\n")
    tmp.replace(target)
    return target


def read_jsonl(path: Path | str) -> list[Chunk]:
    chunks: list[Chunk] = []
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                chunks.append(Chunk.from_dict(json.loads(line)))
    return chunks
