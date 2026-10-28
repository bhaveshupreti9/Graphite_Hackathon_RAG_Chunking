"""Traditional fixed-size chunking (spec B4 "Naive path").

Plain text only (no structure, no cleaning), tokenised, cut into windows of naive_chunk_tokens
with naive_overlap_tokens overlap, decoded back to text. heading_path is always []. The type is
guessed cheaply from the window text ("prose" when unsure).
"""

from __future__ import annotations

import re
from pathlib import Path

from smartchunk.config import Settings
from smartchunk.errors import EmptyDocumentError
from smartchunk.models import Chunk, ChunkType, PageText
from smartchunk.pdf_loader import load_plain
from smartchunk.tokenizer import decode, encode

_CODE_LINE = re.compile(
    r"^\s*(def |class |import |from \S+ import|return\b|if .*:$|for .*:$|while .*:$|[{}]\s*$|.*;\s*$|.*=>|function\b|const |let |var |#include)"
)
_LIST_LINE = re.compile(r"^\s*([-*+•]|\d+[.)])\s+")


def infer_type(text: str) -> ChunkType:
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return "prose"
    if "```" in text:
        return "code"
    if sum(1 for line in lines if line.count("|") >= 2) >= 2:
        return "table"
    if sum(1 for line in lines if _CODE_LINE.match(line)) / len(lines) >= 0.3:
        return "code"
    if sum(1 for line in lines if _LIST_LINE.match(line)) / len(lines) > 0.5:
        return "list"
    return "prose"


def naive_chunk_pages(pages: list[PageText], settings: Settings, doc_id: str, source: str) -> list[Chunk]:
    tokens: list = []
    page_starts: list[tuple[int, int | None]] = []
    for page in pages:
        page_starts.append((len(tokens), page.page))
        tokens.extend(encode(page.text + "\n\n"))
    if not any(page.text.strip() for page in pages):
        raise EmptyDocumentError("No extractable text was found.")

    size = settings.naive_chunk_tokens
    step = size - settings.naive_overlap_tokens
    chunks: list[Chunk] = []
    start = 0
    while start < len(tokens):
        window = tokens[start : start + size]
        text = decode(window).strip()
        if text:
            page = None
            for token_index, page_number in page_starts:
                if token_index <= start:
                    page = page_number
                else:
                    break
            chunks.append(
                Chunk(
                    chunk_id=f"{doc_id}_naive_{len(chunks):04d}",
                    text=text,
                    source=source,
                    page=page,
                    heading_path=[],
                    type=infer_type(text),
                    token_count=len(window),
                )
            )
        if start + size >= len(tokens):
            break
        start += step
    return chunks


def naive_chunk_document(path: Path | str, settings: Settings, doc_id: str, source: str | None = None) -> list[Chunk]:
    file_path = Path(path)
    return naive_chunk_pages(load_plain(file_path), settings, doc_id, source or file_path.name)
