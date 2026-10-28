"""Sentence/chunk embeddings (spec B5).

Default: sentence-transformers "all-MiniLM-L6-v2", loaded once (call `get_embedder()` at startup)
and always used with normalize_embeddings=True.

EMBEDDING_BACKEND=hash switches to a deterministic hashing embedder with no model download. It is
meant for tests and offline machines only: it captures word overlap, not meaning, so retrieval and
semantic splitting are much weaker with it. /api/health reports which one is active.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import threading
from collections import Counter
from typing import Protocol

import numpy as np

logger = logging.getLogger(__name__)

MODEL_NAME = "all-MiniLM-L6-v2"
DIMENSIONS = 384
EMBED_CHAR_LIMIT = 1500  # the model truncates at ~256 tokens; long chunks are embedded from their start


class Embedder(Protocol):
    name: str

    def encode(self, texts: list[str]) -> np.ndarray: ...


class SentenceTransformerEmbedder:
    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer

        self.name = MODEL_NAME
        self._model = SentenceTransformer(MODEL_NAME)

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(
            texts, normalize_embeddings=True, batch_size=32, show_progress_bar=False, convert_to_numpy=True
        )
        return np.asarray(vectors, dtype=np.float32)


_WORD = re.compile(r"[a-z0-9]+")


class HashEmbedder:
    """Deterministic bag-of-words (+ bigrams) hashing vectors, L2-normalised."""

    name = "hash-384 (offline test embedder)"

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), DIMENSIONS), dtype=np.float32)
        for row, text in enumerate(texts):
            words = _WORD.findall(text.lower())
            features = Counter(words)
            features.update(f"{a} {b}" for a, b in zip(words, words[1:]))
            for feature, count in features.items():
                digest = hashlib.md5(feature.encode("utf-8")).digest()
                index = int.from_bytes(digest[:4], "little") % DIMENSIONS
                sign = 1.0 if digest[4] & 1 else -1.0
                out[row, index] += sign * (1.0 + math.log(count))
            norm = float(np.linalg.norm(out[row]))
            if norm > 0:
                out[row] /= norm
        return out


_lock = threading.Lock()
_embedder: Embedder | None = None
_load_error: str | None = None


def backend_name() -> str:
    return os.getenv("EMBEDDING_BACKEND", "sentence-transformers").strip().lower()


def get_embedder() -> Embedder:
    """The process-wide embedder, created on first use (FastAPI loads it at startup)."""
    global _embedder, _load_error
    if _embedder is not None:
        return _embedder
    with _lock:
        if _embedder is None:
            if backend_name() == "hash":
                _embedder = HashEmbedder()
            else:
                try:
                    _embedder = SentenceTransformerEmbedder()
                except Exception as error:
                    _load_error = str(error)
                    logger.error("Could not load %s: %s", MODEL_NAME, error)
                    raise
    return _embedder


def is_loaded() -> bool:
    return _embedder is not None


def load_error() -> str | None:
    return _load_error


def reset_for_tests() -> None:
    global _embedder, _load_error
    _embedder = None
    _load_error = None


def embed_texts(texts: list[str]) -> np.ndarray:
    """Normalised float32 embeddings, one row per text. Empty input gives a (0, 384) array."""
    if not texts:
        return np.zeros((0, DIMENSIONS), dtype=np.float32)
    clipped = [text[:EMBED_CHAR_LIMIT] if text else " " for text in texts]
    return get_embedder().encode(clipped)
