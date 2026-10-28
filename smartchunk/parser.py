"""Markdown parsing with markdown-it-py (spec B4 "Parsing").

Top-level tokens are mapped to blocks, and `token.map` is used to slice the ORIGINAL lines, so code
and tables keep their exact text. A heading stack gives every block its heading path; for PDFs the
stack is carried from page to page.
"""

from __future__ import annotations

from markdown_it import MarkdownIt

from .models import Block, BlockKind

_MD = MarkdownIt("commonmark").enable("table")

OPENING: dict[str, BlockKind] = {
    "heading_open": "heading",
    "fence": "code",
    "code_block": "code",
    "table_open": "table",
    "bullet_list_open": "list",
    "ordered_list_open": "list",
    "paragraph_open": "prose",
    "blockquote_open": "prose",
    "html_block": "prose",
}

HeadingStack = list[tuple[int, str]]


def parse_markdown(
    md_text: str, page: int | None = None, stack: HeadingStack | None = None
) -> tuple[list[Block], HeadingStack]:
    """Returns (blocks, heading stack after this text)."""
    stack = list(stack or [])
    lines = md_text.split("\n")
    tokens = _MD.parse(md_text)
    blocks: list[Block] = []

    for index, token in enumerate(tokens):
        if token.level != 0 or token.type not in OPENING or token.map is None:
            continue
        start, end = token.map
        text = "\n".join(lines[start:end]).strip("\n")
        if not text.strip():
            continue
        kind = OPENING[token.type]

        if kind == "heading":
            level = int(token.tag[1]) if token.tag.startswith("h") else 1
            inline = tokens[index + 1] if index + 1 < len(tokens) else None
            title = (inline.content if inline is not None and inline.type == "inline" else text.lstrip("# ")).strip()
            stack = [(lvl, name) for (lvl, name) in stack if lvl < level]
            stack.append((level, title))
            blocks.append(
                Block(
                    kind="heading",
                    text=text.strip(),
                    heading_path=[name for _, name in stack],
                    heading_levels=[lvl for lvl, _ in stack],
                    page=page,
                    level=level,
                )
            )
            continue

        blocks.append(
            Block(
                kind=kind,
                text=text.rstrip(),
                heading_path=[name for _, name in stack],
                heading_levels=[lvl for lvl, _ in stack],
                page=page,
            )
        )
    return blocks, stack


def parse_pages(pages: list[tuple[int | None, str]]) -> list[Block]:
    """Parses pages in order, carrying the heading stack across page breaks."""
    stack: HeadingStack = []
    blocks: list[Block] = []
    for page, text in pages:
        page_blocks, stack = parse_markdown(text, page, stack)
        blocks.extend(page_blocks)
    return blocks
