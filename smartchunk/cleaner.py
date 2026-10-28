"""Repeated header/footer removal (spec B4 "Cleaning", SmartChunk path only).

A line is a header or footer when its normalised form (lowercase, digits replaced by '#', spaces
collapsed) appears in the first 3 or last 3 lines of at least 40% of pages (minimum 3 pages).
"""

from __future__ import annotations

import math
import re
from collections import Counter

from .models import PageText, RemovedItem

EDGE_LINES = 3
MIN_PAGES = 3
SHARE = 0.4


def normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\d", "#", line.lower())).strip()


def _content_lines(text: str) -> list[tuple[int, str]]:
    """(line index, line) for non-empty lines, ignoring Markdown code fences."""
    return [(i, line) for i, line in enumerate(text.split("\n")) if line.strip() and line.strip() != "```"]


def _edge_size(line_count: int) -> int:
    """3 lines at each edge, fewer on very short pages so header and footer zones never overlap."""
    return max(1, min(EDGE_LINES, (line_count - 1) // 2))


def _is_section_heading(line: str) -> bool:
    # Running headers are small text; real section headings were converted to Markdown headings.
    return bool(re.match(r"^\s{0,3}#{1,6}\s", line))


def _edges(text: str) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    lines = [(i, line) for i, line in _content_lines(text) if not _is_section_heading(line)]
    size = _edge_size(len(lines))
    return lines[:size], lines[-size:]


def _strip_markup(line: str) -> str:
    return re.sub(r"^\s*(#{1,6}\s+|-\s+)", "", line)


def detect_repeated_lines(pages: list[PageText]) -> dict[str, tuple[str, int]]:
    """Normalised line -> (kind, number of pages it appears on) for every header/footer line."""
    if len(pages) < MIN_PAGES:
        return {}
    header_counts: Counter[str] = Counter()
    footer_counts: Counter[str] = Counter()
    for page in pages:
        top, bottom = _edges(page.text)
        heads = {normalize_line(_strip_markup(line)) for _, line in top}
        feet = {normalize_line(_strip_markup(line)) for _, line in bottom}
        header_counts.update(line for line in heads if line)
        footer_counts.update(line for line in feet if line)
    needed = max(MIN_PAGES, math.ceil(SHARE * len(pages)))
    repeated: dict[str, tuple[str, int]] = {}
    for line, count in footer_counts.items():
        if count >= needed:
            repeated[line] = ("footer", count)
    for line, count in header_counts.items():
        if count >= needed and (line not in repeated or count >= repeated[line][1]):
            repeated[line] = ("header", count)
    return repeated


def strip_noise(pages: list[PageText]) -> tuple[list[PageText], list[RemovedItem]]:
    """Returns (clean pages, removed header/footer items)."""
    repeated = detect_repeated_lines(pages)
    if not repeated:
        return pages, []
    total = len(pages)
    clean: list[PageText] = []
    removed: list[RemovedItem] = []
    for page in pages:
        all_lines = page.text.split("\n")
        top, bottom = _edges(page.text)
        edge_indexes = {i for i, _ in top} | {i for i, _ in bottom}
        drop: set[int] = set()
        for i in edge_indexes:
            key = normalize_line(_strip_markup(all_lines[i]))
            if key in repeated:
                kind, count = repeated[key]
                position = "first" if kind == "header" else "last"
                drop.add(i)
                removed.append(
                    RemovedItem(
                        kind="header" if kind == "header" else "footer",
                        text=_strip_markup(all_lines[i]).strip(),
                        page=page.page,
                        reason=(
                            f"Repeated on {count} of {total} pages ({round(100 * count / total)}%) "
                            f"within the {position} {EDGE_LINES} lines"
                        ),
                    )
                )
        kept = [line for i, line in enumerate(all_lines) if i not in drop]
        clean.append(PageText(page=page.page, text=re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip("\n")))
    return clean, removed
