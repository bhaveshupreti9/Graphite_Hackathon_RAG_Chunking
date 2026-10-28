"""Duplicate removal (spec B4 "Deduplication").

Exact duplicates: SHA-256 of normalised text (hashlib). Near duplicates: cosine similarity of
embeddings (scikit-learn), compared only within the same chunk type, processed in batches and only
against earlier chunks that were kept (upper triangle), so memory stays small.
"""

from __future__ import annotations

import hashlib
import re

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from .models import Chunk, RemovedItem

BATCH = 256


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def text_hash(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def _preview(text: str, limit: int = 160) -> str:
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def exact_dedup(chunks: list[Chunk]) -> tuple[list[Chunk], list[RemovedItem]]:
    seen: dict[str, Chunk] = {}
    kept: list[Chunk] = []
    removed: list[RemovedItem] = []
    for chunk in chunks:
        digest = text_hash(chunk.text)
        first = seen.get(digest)
        if first is None:
            seen[digest] = chunk
            kept.append(chunk)
        else:
            removed.append(
                RemovedItem(
                    kind="exact_duplicate",
                    text=_preview(chunk.text),
                    page=chunk.page,
                    reason=f"Identical (SHA-256) to chunk {first.chunk_id}",
                )
            )
    return kept, removed


def near_dedup(
    chunks: list[Chunk], embeddings: np.ndarray, threshold: float
) -> tuple[list[int], list[RemovedItem]]:
    """Returns (indexes of chunks to keep, removed items). `embeddings` rows match `chunks`."""
    if len(chunks) == 0:
        return [], []
    keep = np.ones(len(chunks), dtype=bool)
    removed: list[RemovedItem] = []
    by_type: dict[str, list[int]] = {}
    for index, chunk in enumerate(chunks):
        by_type.setdefault(chunk.type, []).append(index)

    for indexes in by_type.values():
        if len(indexes) < 2:
            continue
        group = embeddings[indexes]
        for start in range(0, len(indexes), BATCH):
            rows = group[start : start + BATCH]
            sims = cosine_similarity(rows, group)
            for offset in range(rows.shape[0]):
                i_local = start + offset
                i = indexes[i_local]
                if not keep[i]:
                    continue
                earlier = sims[offset, :i_local]
                if earlier.size == 0:
                    continue
                candidates = [j for j in np.where(earlier >= threshold)[0] if keep[indexes[j]]]
                if candidates:
                    j = indexes[int(candidates[0])]
                    keep[i] = False
                    removed.append(
                        RemovedItem(
                            kind="near_duplicate",
                            text=_preview(chunks[i].text),
                            page=chunks[i].page,
                            reason=(
                                f"Cosine similarity {float(sims[offset, candidates[0]]):.2f} with chunk "
                                f"{chunks[j].chunk_id} (threshold {threshold:.2f})"
                            ),
                        )
                    )
    return [i for i in range(len(chunks)) if keep[i]], removed
