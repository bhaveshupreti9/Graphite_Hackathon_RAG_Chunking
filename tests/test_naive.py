from __future__ import annotations

from pathlib import Path

from baseline.naive import infer_type, naive_chunk_document, naive_chunk_pages
from smartchunk.config import Settings
from smartchunk.models import PageText
from smartchunk.tokenizer import count_tokens, encode


def _settings(size: int, overlap: int) -> Settings:
    return Settings(naive_chunk_tokens=size, naive_overlap_tokens=overlap)


def test_windows_have_requested_size_and_overlap() -> None:
    text = " ".join(f"word{i}" for i in range(1000))
    chunks = naive_chunk_pages([PageText(None, text)], _settings(200, 50), "doc_aaaaaaaa", "t.txt")
    total = len(encode(text + "\n\n"))
    assert all(chunk.token_count == 200 for chunk in chunks[:-1])
    assert chunks[-1].token_count <= 200
    # windows start every (size - overlap) tokens
    assert len(chunks) == 1 + -(-(total - 200) // 150)
    # overlap: the end of one window reappears at the start of the next
    first_tail = chunks[0].text.split()[-10:]
    assert " ".join(first_tail) in chunks[1].text


def test_ids_metadata_and_types(samples_dir: Path) -> None:
    chunks = naive_chunk_document(samples_dir / "python_tutorial.md", Settings(), "doc_bbbbbbbb")
    assert [chunk.chunk_id for chunk in chunks] == [f"doc_bbbbbbbb_naive_{i:04d}" for i in range(len(chunks))]
    assert all(chunk.heading_path == [] for chunk in chunks)
    assert all(chunk.page is None for chunk in chunks)
    assert all(chunk.type in {"prose", "code", "table", "list"} for chunk in chunks)
    assert all(chunk.source == "python_tutorial.md" for chunk in chunks)


def test_pdf_pages_are_tracked(samples_dir: Path) -> None:
    chunks = naive_chunk_document(samples_dir / "python_tutorial_print.pdf", _settings(150, 20), "doc_cccccccc")
    pages = [chunk.page for chunk in chunks]
    assert pages[0] == 1
    assert pages == sorted(pages)
    assert max(pages) > 1


def test_infer_type() -> None:
    assert infer_type("```python\nx = 1\n```") == "code"
    assert infer_type("| a | b |\n|---|---|\n| 1 | 2 |") == "table"
    assert infer_type("- one\n- two\n- three") == "list"
    assert infer_type("Just a normal sentence about things.") == "prose"


def test_token_count_matches_text() -> None:
    assert count_tokens("") == 0
    assert count_tokens("hello world") >= 2
