from __future__ import annotations

import numpy as np

from smartchunk.dedup import exact_dedup, near_dedup, text_hash
from smartchunk.models import Chunk


def _chunk(index: int, text: str, kind: str = "prose") -> Chunk:
    return Chunk(f"doc_dddddddd_smart_{index:04d}", text, "x.md", None, [], kind, 10)  # type: ignore[arg-type]


def test_exact_dedup_uses_normalised_sha256() -> None:
    chunks = [_chunk(0, "Hello   World"), _chunk(1, "hello world"), _chunk(2, "Something else")]
    kept, removed = exact_dedup(chunks)
    assert [chunk.chunk_id for chunk in kept] == ["doc_dddddddd_smart_0000", "doc_dddddddd_smart_0002"]
    assert len(removed) == 1
    assert removed[0].kind == "exact_duplicate"
    assert "doc_dddddddd_smart_0000" in removed[0].reason
    assert text_hash("A  b") == text_hash("a b")


def test_near_dedup_threshold_and_same_type_only() -> None:
    chunks = [_chunk(0, "a"), _chunk(1, "b"), _chunk(2, "c", "code"), _chunk(3, "d")]
    v = np.array([[1, 0, 0], [0.99, 0.141, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32)
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    keep, removed = near_dedup(chunks, v, threshold=0.95)
    # chunk 1 is a near copy of chunk 0; chunk 2 is identical in vector but a different type
    assert keep == [0, 2, 3]
    assert len(removed) == 1
    assert removed[0].kind == "near_duplicate"
    assert "0.99" in removed[0].reason


def test_near_dedup_handles_empty_and_single() -> None:
    assert near_dedup([], np.zeros((0, 3), dtype=np.float32), 0.9) == ([], [])
    keep, removed = near_dedup([_chunk(0, "a")], np.ones((1, 3), dtype=np.float32), 0.9)
    assert keep == [0] and removed == []
