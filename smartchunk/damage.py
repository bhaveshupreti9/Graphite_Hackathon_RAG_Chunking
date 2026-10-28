"""Structural damage counting, the same function for both methods (spec B4).

A code, table or list block from the ORIGINAL (uncleaned) parse counts as split when its normalised
text is not contained in any single chunk. Normalisation keeps only letters and digits, so
formatting differences (Markdown fences, bullet characters, PDF line wrapping) never count as damage.
An orphan heading is a chunk whose last non-empty line is a heading with nothing after it.
Oversized blocks that SmartChunk deliberately split at safe points (rule 5) can be exempted.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from .models import Block, Chunk

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+\S")


def normalize(text: str) -> str:
    return _NON_ALNUM.sub("", text.lower())


def _block_body(block: Block) -> str:
    return normalize(block.text)


def ends_with_heading(text: str) -> bool:
    in_fence = False
    last_is_heading = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("```"):
            in_fence = not in_fence
            last_is_heading = False
            continue
        last_is_heading = not in_fence and bool(_HEADING.match(line))
    return last_is_heading


def count_structural_damage(
    blocks: list[Block], chunks: list[Chunk], exempt: Iterable[Block] = ()
) -> dict[str, int]:
    haystack = [normalize(chunk.text) for chunk in chunks]
    exempt_bodies = {_block_body(block) for block in exempt}
    counts = {"split_code_blocks": 0, "split_tables": 0, "split_lists": 0}
    key = {"code": "split_code_blocks", "table": "split_tables", "list": "split_lists"}
    for block in blocks:
        if block.kind not in key:
            continue
        body = _block_body(block)
        if not body or body in exempt_bodies:
            continue
        if not any(body in text for text in haystack):
            counts[key[block.kind]] += 1
    counts["orphan_headings"] = sum(1 for chunk in chunks if ends_with_heading(chunk.text))
    return counts
