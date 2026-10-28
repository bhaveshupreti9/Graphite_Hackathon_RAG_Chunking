"""MethodStats (spec A6) for one chunk set."""

from __future__ import annotations

from typing import Any

from .models import Chunk

SMART_METADATA_FIELDS = 7  # every Chunk field
NAIVE_METADATA_FIELDS = 2  # source, page


def method_stats(
    chunks: list[Chunk],
    damage: dict[str, int],
    *,
    smart: bool,
    exact_removed: int = 0,
    near_removed: int = 0,
    noise_removed: int = 0,
) -> dict[str, Any]:
    type_counts = {"prose": 0, "code": 0, "table": 0, "list": 0}
    for chunk in chunks:
        type_counts[chunk.type] += 1
    average = sum(chunk.token_count for chunk in chunks) / len(chunks) if chunks else 0.0
    return {
        "chunk_count": len(chunks),
        "avg_tokens": round(average, 1),
        "type_counts": type_counts,
        "split_code_blocks": damage["split_code_blocks"],
        "split_tables": damage["split_tables"],
        "split_lists": damage["split_lists"],
        "orphan_headings": damage["orphan_headings"],
        "exact_duplicates_removed": exact_removed if smart else 0,
        "near_duplicates_removed": near_removed if smart else 0,
        "noise_lines_removed": noise_removed if smart else 0,
        "metadata_fields_present": SMART_METADATA_FIELDS if smart else NAIVE_METADATA_FIELDS,
    }
