from __future__ import annotations

from smartchunk.parser import parse_markdown, parse_pages

DOC = """# Guide

Intro paragraph.

## Install

```bash
pip install thing
# comment that is not a heading
```

| a | b |
|---|---|
| 1 | 2 |

- one
- two
  - nested

### Deep

Deep text.

## Next

Next text.
"""


def test_block_kinds_and_exact_text() -> None:
    blocks, _ = parse_markdown(DOC)
    kinds = [block.kind for block in blocks]
    assert kinds == ["heading", "prose", "heading", "code", "table", "list", "heading", "prose", "heading", "prose"]
    code = blocks[3]
    assert code.text == "```bash\npip install thing\n# comment that is not a heading\n```"
    table = blocks[4]
    assert table.text.splitlines()[0] == "| a | b |"
    lst = blocks[5]
    assert "  - nested" in lst.text  # the whole top-level list is one block


def test_heading_stack() -> None:
    blocks, stack = parse_markdown(DOC)
    paths = {block.text.split("\n")[0][:12]: block.heading_path for block in blocks if block.kind != "heading"}
    assert paths["Intro paragr"] == ["Guide"]
    assert paths["```bash"] == ["Guide", "Install"]
    assert paths["Deep text."] == ["Guide", "Install", "Deep"]
    assert paths["Next text."] == ["Guide", "Next"]
    assert stack == [(1, "Guide"), (2, "Next")]


def test_heading_stack_carries_across_pages() -> None:
    blocks = parse_pages([(1, "# Chapter\n\n## Part\n\nText on page one."), (2, "More text on page two.")])
    last = blocks[-1]
    assert last.page == 2
    assert last.heading_path == ["Chapter", "Part"]
