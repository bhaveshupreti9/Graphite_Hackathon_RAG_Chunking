"""SmartChunk: structure-aware chunking for RAG."""

from __future__ import annotations

from typing import Any

from .chunker import chunk_document
from .config import DEFAULT_SETTINGS, Settings

__all__ = ["chunk_document", "naive_chunk_document", "Settings", "DEFAULT_SETTINGS"]


def __getattr__(name: str) -> Any:
    # Imported lazily: baseline.naive itself imports from this package.
    if name == "naive_chunk_document":
        from baseline.naive import naive_chunk_document

        return naive_chunk_document
    raise AttributeError(name)
