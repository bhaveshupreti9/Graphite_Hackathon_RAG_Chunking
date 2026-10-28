"""SmartChunk orchestrator: load -> parse -> clean -> chunk -> deduplicate (spec B4).

Chunk-building rules implemented here:
 1. Code, table and list blocks are atomic; the semantic step never splits them.
 2. A heading is always merged into the chunk that follows it (never left alone at a chunk end).
 3. Consecutive prose blocks under the same heading are split semantically within size limits.
 4. A new chunk always starts at a new heading.
 5. Code/tables/lists longer than max_chunk_tokens stay whole, except they may be split between
    functions / table rows / list items, with the heading repeated at the top of each part.
 6. Small adjacent blocks under the same heading may share a chunk; the chunk's type is that of its
    largest block by tokens.
 7. Chunk text starts with the nearest heading line(s).
 8. chunk_id = f"{doc_id}_smart_{index:04d}", indexed from 0 in document order (after dedup).
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .cleaner import strip_noise
from .config import Settings
from .dedup import exact_dedup, near_dedup
from .models import Block, Chunk, ChunkingResult, ChunkType, PageText
from .parser import parse_pages
from .pdf_loader import load_document
from .semantic import embed, semantic_split
from .tokenizer import count_tokens

StepCallback = Callable[[str], None]

TOP_LEVEL_DEF = re.compile(
    r"^(async\s+def\s|def\s|class\s|function\s|export\s|public\s|private\s|protected\s|fn\s|func\s|@\w)"
)
LIST_ITEM = re.compile(r"^([-*+]|\d+[.)])\s+")


@dataclass
class _Unit:
    kind: ChunkType
    text: str
    heading_path: list[str]
    heading_levels: list[int]
    page: int | None
    tokens: int
    headings: list[Block] = field(default_factory=list)
    oversized_part: bool = False


def _heading_line(path: list[str], levels: list[int]) -> str:
    if not path:
        return ""
    level = levels[-1] if levels else 1
    return f"{'#' * max(1, min(6, level))} {path[-1]}"


def _group_by_tokens(parts: list[str], max_tokens: int, joiner: str) -> list[str]:
    groups: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for part in parts:
        tokens = count_tokens(part)
        if current and current_tokens + tokens > max_tokens:
            groups.append(joiner.join(current))
            current, current_tokens = [], 0
        current.append(part)
        current_tokens += tokens
    if current:
        groups.append(joiner.join(current))
    return groups


def _split_code(text: str, max_tokens: int) -> list[str]:
    lines = text.split("\n")
    opening = closing = None
    if lines and lines[0].strip().startswith(("```", "~~~")):
        opening = lines[0]
        body = lines[1:]
        if body and body[-1].strip().startswith(("```", "~~~")):
            closing = body[-1]
            body = body[:-1]
    else:
        body = lines
    segments: list[list[str]] = [[]]
    for line in body:
        starts_new = bool(TOP_LEVEL_DEF.match(line)) and any(existing.strip() for existing in segments[-1])
        if starts_new:
            # Keep decorators and comments directly above a definition with it.
            carry: list[str] = []
            while segments[-1] and (segments[-1][-1].lstrip().startswith(("#", "//", "@")) and not segments[-1][-1].startswith((" ", "\t"))):
                carry.insert(0, segments[-1].pop())
            segments.append(carry)
        segments[-1].append(line)
    texts = ["\n".join(segment).strip("\n") for segment in segments if any(line.strip() for line in segment)]
    if len(texts) <= 1:
        return [text]
    groups = _group_by_tokens(texts, max_tokens, "\n\n")
    if opening is None:
        return groups
    return [f"{opening}\n{group}\n{closing or opening.strip()[:3]}" for group in groups]


def _split_table(text: str, max_tokens: int) -> list[str]:
    lines = [line for line in text.split("\n") if line.strip()]
    if len(lines) < 3:
        return [text]
    header, separator, rows = lines[0], lines[1], lines[2:]
    budget = max(20, max_tokens - count_tokens(header + "\n" + separator))
    groups = _group_by_tokens(rows, budget, "\n")
    return [f"{header}\n{separator}\n{group}" for group in groups]


def _split_list(text: str, max_tokens: int) -> list[str]:
    items: list[list[str]] = []
    for line in text.split("\n"):
        if LIST_ITEM.match(line) or not items:
            items.append([line])
        else:
            items[-1].append(line)
    texts = ["\n".join(item) for item in items]
    return _group_by_tokens(texts, max_tokens, "\n") if len(texts) > 1 else [text]


def _structural_parts(block: Block, max_tokens: int) -> list[str]:
    if block.kind == "code":
        return _split_code(block.text, max_tokens)
    if block.kind == "table":
        return _split_table(block.text, max_tokens)
    return _split_list(block.text, max_tokens)


def _build_units(blocks: list[Block], settings: Settings) -> tuple[list[_Unit], list[Block]]:
    units: list[_Unit] = []
    oversized: list[Block] = []
    pending: list[Block] = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        if block.kind == "heading":
            pending.append(block)
            i += 1
            continue

        if block.kind == "prose":
            run = [block]
            j = i + 1
            while j < len(blocks) and blocks[j].kind == "prose" and blocks[j].heading_path == block.heading_path:
                run.append(blocks[j])
                j += 1
            text = "\n\n".join(item.text for item in run)
            pieces = semantic_split(
                text, settings.similarity_threshold, settings.min_chunk_tokens, settings.max_chunk_tokens
            ) or [text]
            for index, piece in enumerate(pieces):
                units.append(
                    _Unit(
                        kind="prose",
                        text=piece,
                        heading_path=block.heading_path,
                        heading_levels=block.heading_levels,
                        page=block.page,
                        tokens=count_tokens(piece),
                        headings=pending if index == 0 else [],
                    )
                )
            pending = []
            i = j
            continue

        tokens = count_tokens(block.text)
        kind: ChunkType = block.kind  # type: ignore[assignment]
        if tokens > settings.max_chunk_tokens:
            parts = _structural_parts(block, settings.max_chunk_tokens)
            if len(parts) > 1:
                oversized.append(block)
            for index, part in enumerate(parts):
                units.append(
                    _Unit(
                        kind=kind,
                        text=part,
                        heading_path=block.heading_path,
                        heading_levels=block.heading_levels,
                        page=block.page,
                        tokens=count_tokens(part),
                        headings=pending if index == 0 else [],
                        oversized_part=len(parts) > 1,
                    )
                )
        else:
            units.append(
                _Unit(
                    kind=kind,
                    text=block.text,
                    heading_path=block.heading_path,
                    heading_levels=block.heading_levels,
                    page=block.page,
                    tokens=tokens,
                    headings=pending,
                )
            )
        pending = []
        i += 1
    # Headings at the very end with no content after them carry no information and are dropped,
    # so no chunk ends with a bare heading.
    return units, oversized


def _make_chunk(units: list[_Unit], doc_id: str, source: str) -> Chunk:
    first = units[0]
    if first.headings:
        prefix = "\n\n".join(heading.text for heading in first.headings)
    else:
        prefix = _heading_line(first.heading_path, first.heading_levels)
    body = "\n\n".join(unit.text for unit in units)
    text = f"{prefix}\n\n{body}".strip() if prefix else body.strip()
    weights: dict[str, int] = {}
    for unit in units:
        weights[unit.kind] = weights.get(unit.kind, 0) + unit.tokens
    dominant: ChunkType = max(weights.items(), key=lambda item: item[1])[0]  # type: ignore[assignment]
    return Chunk(
        chunk_id=f"{doc_id}_smart_pending",
        text=text,
        source=source,
        page=first.page,
        heading_path=list(first.heading_path),
        type=dominant,
        token_count=count_tokens(text),
    )


def build_chunks(blocks: list[Block], settings: Settings, doc_id: str, source: str) -> tuple[list[Chunk], list[Block]]:
    units, oversized = _build_units(blocks, settings)
    chunks: list[Chunk] = []
    current: list[_Unit] = []
    current_tokens = 0
    for unit in units:
        can_merge = (
            bool(current)
            and not unit.headings
            and unit.heading_path == current[0].heading_path
            and not unit.oversized_part
            and not any(existing.oversized_part for existing in current)
            and current_tokens + unit.tokens <= settings.max_chunk_tokens
            and (current_tokens < settings.min_chunk_tokens or unit.tokens < settings.min_chunk_tokens)
        )
        if can_merge:
            current.append(unit)
            current_tokens += unit.tokens
            continue
        if current:
            chunks.append(_make_chunk(current, doc_id, source))
        current = [unit]
        current_tokens = unit.tokens
    if current:
        chunks.append(_make_chunk(current, doc_id, source))
    return chunks, oversized


def _renumber(chunks: list[Chunk], doc_id: str) -> list[Chunk]:
    for index, chunk in enumerate(chunks):
        chunk.chunk_id = f"{doc_id}_smart_{index:04d}"
    return chunks


def chunk_pages(
    pages: list[PageText],
    settings: Settings,
    doc_id: str,
    source: str,
    on_step: StepCallback | None = None,
    warnings: list[str] | None = None,
) -> ChunkingResult:
    """Runs the pipeline on already-loaded pages."""
    step = on_step or (lambda _name: None)
    raw_blocks = parse_pages([(page.page, page.text) for page in pages])

    step("cleaning")
    clean_pages, noise = strip_noise(pages)
    blocks = parse_pages([(page.page, page.text) for page in clean_pages])

    step("semantic_split")
    chunks, oversized = build_chunks(blocks, settings, doc_id, source)
    _renumber(chunks, doc_id)  # provisional ids so duplicate reasons can name the kept chunk

    step("dedup")
    kept, exact_removed = exact_dedup(chunks)
    near_removed = []
    if len(kept) > 1:
        vectors = embed([chunk.text for chunk in kept])
        keep_indexes, near_removed = near_dedup(kept, vectors, settings.dedup_threshold)
        kept = [kept[i] for i in keep_indexes]
    final = _renumber(kept, doc_id)

    return ChunkingResult(
        chunks=final,
        removed=[*noise, *exact_removed, *near_removed],
        raw_blocks=raw_blocks,
        pages=len(pages),
        noise_lines_removed=len(noise),
        exact_duplicates_removed=len(exact_removed),
        near_duplicates_removed=len(near_removed),
        oversized_blocks=oversized,
        warnings=list(warnings or []),
    )


def chunk_document(
    path: Path | str,
    settings: Settings,
    doc_id: str,
    source: str | None = None,
    on_step: StepCallback | None = None,
) -> ChunkingResult:
    """Loads a file and runs the SmartChunk pipeline. Raises smartchunk.errors.DocumentError subclasses."""
    file_path = Path(path)
    pages, warnings = load_document(file_path, source)
    if not any(page.text.strip() for page in pages):
        from .errors import EmptyDocumentError

        raise EmptyDocumentError("No extractable text was found.")
    return chunk_pages(pages, settings, doc_id, source or file_path.name, on_step, warnings)
