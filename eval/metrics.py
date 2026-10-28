"""Retrieval metrics. `ranks` holds, per question, the 1-based rank of the first hit in the top k,
or None when nothing in the top k answered the question."""

from __future__ import annotations

import re
from collections.abc import Sequence

HIT_COVERAGE = 0.8
_WORD = re.compile(r"[a-z0-9_]+")


def words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def covers(chunk_text: str, gold_text: str, coverage: float = HIT_COVERAGE) -> bool:
    """True when the chunk contains at least `coverage` of the gold passage's distinct words."""
    gold = words(gold_text)
    if not gold:
        return False
    return len(gold & words(chunk_text)) / len(gold) >= coverage


def first_hit_rank(chunk_texts: Sequence[str], gold_text: str) -> int | None:
    for index, text in enumerate(chunk_texts, start=1):
        if covers(text, gold_text):
            return index
    return None


def recall_at_k(ranks: Sequence[int | None], k: int = 5) -> float:
    if not ranks:
        return 0.0
    return round(sum(1 for rank in ranks if rank is not None and rank <= k) / len(ranks), 4)


def mrr(ranks: Sequence[int | None]) -> float:
    if not ranks:
        return 0.0
    return round(sum(1.0 / rank for rank in ranks if rank) / len(ranks), 4)


def prf(true: Sequence[int], predicted: Sequence[int]) -> dict[str, float]:
    tp = sum(1 for t, p in zip(true, predicted) if t == 1 and p == 1)
    fp = sum(1 for t, p in zip(true, predicted) if t == 0 and p == 1)
    fn = sum(1 for t, p in zip(true, predicted) if t == 1 and p == 0)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4)}
