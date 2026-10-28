"""Core data structures. `Chunk` and `RemovedItem` mirror spec A6 field for field."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ChunkType = Literal["prose", "code", "table", "list"]
BlockKind = Literal["heading", "prose", "code", "table", "list"]
RemovedKind = Literal["header", "footer", "exact_duplicate", "near_duplicate"]

CHUNK_FIELDS = ("chunk_id", "text", "source", "page", "heading_path", "type", "token_count")


@dataclass
class PageText:
    """Text of one page (PDF) or of the whole file (page=None for Markdown/TXT)."""

    page: int | None
    text: str


@dataclass
class Block:
    """One top-level Markdown element: a heading, paragraph, code block, table or list."""

    kind: BlockKind
    text: str
    heading_path: list[str]
    heading_levels: list[int]
    page: int | None
    level: int = 0  # heading level (1-6) for heading blocks


@dataclass
class Chunk:
    chunk_id: str
    text: str
    source: str
    page: int | None
    heading_path: list[str]
    type: ChunkType
    token_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "text": self.text,
            "source": self.source,
            "page": self.page,
            "heading_path": list(self.heading_path),
            "type": self.type,
            "token_count": self.token_count,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Chunk":
        return cls(**{name: data[name] for name in CHUNK_FIELDS})


@dataclass
class RemovedItem:
    kind: RemovedKind
    text: str
    page: int | None
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "text": self.text, "page": self.page, "reason": self.reason}


@dataclass
class ChunkingResult:
    """Everything the SmartChunk pipeline produced for one document."""

    chunks: list[Chunk]
    removed: list[RemovedItem]
    raw_blocks: list[Block]
    pages: int
    noise_lines_removed: int
    exact_duplicates_removed: int
    near_duplicates_removed: int
    oversized_blocks: list[Block] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
