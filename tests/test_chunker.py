from __future__ import annotations

from pathlib import Path

import pytest

from baseline.naive import naive_chunk_document
from smartchunk.chunker import chunk_document
from smartchunk.config import Settings
from smartchunk.damage import count_structural_damage, ends_with_heading
from smartchunk.errors import EmptyDocumentError, EncryptedPdfError, ScannedPdfError, UnsupportedFileError
from smartchunk.tokenizer import count_tokens

SAMPLES = ["python_tutorial.md", "python_tutorial_print.pdf", "api_reference.md", "company_handbook.txt"]


@pytest.mark.parametrize("name", SAMPLES)
def test_smart_chunks_never_damage_structure(samples_dir: Path, name: str) -> None:
    result = chunk_document(samples_dir / name, Settings(), "doc_eeeeeeee")
    damage = count_structural_damage(result.raw_blocks, result.chunks, result.oversized_blocks)
    assert damage == {"split_code_blocks": 0, "split_tables": 0, "split_lists": 0, "orphan_headings": 0}


@pytest.mark.parametrize("name", SAMPLES)
def test_chunk_fields(samples_dir: Path, name: str) -> None:
    result = chunk_document(samples_dir / name, Settings(), "doc_eeeeeeee")
    assert result.chunks
    for index, chunk in enumerate(result.chunks):
        assert chunk.chunk_id == f"doc_eeeeeeee_smart_{index:04d}"
        assert chunk.source == name
        assert chunk.type in {"prose", "code", "table", "list"}
        assert chunk.token_count == count_tokens(chunk.text)
        assert chunk.text.lstrip().startswith("#") or not chunk.heading_path


def test_headings_are_attached_and_chunks_start_with_heading(samples_dir: Path) -> None:
    result = chunk_document(samples_dir / "python_tutorial.md", Settings(), "doc_eeeeeeee")
    for chunk in result.chunks:
        assert not ends_with_heading(chunk.text)
        first_line = chunk.text.split("\n", 1)[0]
        assert first_line.startswith("#"), first_line
    code = [chunk for chunk in result.chunks if chunk.heading_path[-1:] == ["Binary Search"]]
    assert code and "def binary_search" in code[0].text and "return -1" in code[0].text


def test_pdf_cleaning_and_metadata(samples_dir: Path) -> None:
    result = chunk_document(samples_dir / "python_tutorial_print.pdf", Settings(), "doc_eeeeeeee")
    assert result.pages > 1
    assert result.noise_lines_removed >= result.pages * 2
    assert not any("Release 3.12" in chunk.text for chunk in result.chunks)
    assert all(isinstance(chunk.page, int) and chunk.page >= 1 for chunk in result.chunks)
    assert any(chunk.type == "code" for chunk in result.chunks)


def test_exact_duplicate_section_removed(samples_dir: Path) -> None:
    result = chunk_document(samples_dir / "python_tutorial.md", Settings(), "doc_eeeeeeee")
    assert result.exact_duplicates_removed >= 1
    texts = [chunk.text for chunk in result.chunks]
    assert len(texts) == len(set(texts))


def test_oversized_code_is_split_between_functions_with_heading_repeated(tmp_path: Path) -> None:
    functions = "\n\n".join(
        f"def function_{i}(value):\n    total = value * {i}\n    for step in range({i + 3}):\n        total += step\n    return total"
        for i in range(30)
    )
    doc = tmp_path / "big.md"
    doc.write_text(f"# Big module\n\n```python\n{functions}\n```\n", encoding="utf-8")
    settings = Settings(min_chunk_tokens=20, max_chunk_tokens=150)
    result = chunk_document(doc, settings, "doc_ffffffff")
    assert len(result.chunks) > 1
    assert result.oversized_blocks
    for chunk in result.chunks:
        assert chunk.text.startswith("# Big module")
        assert chunk.text.count("```") == 2
        body = chunk.text.split("```python\n", 1)[1]
        assert body.startswith("def function_")  # split only at function boundaries
    damage = count_structural_damage(result.raw_blocks, result.chunks, result.oversized_blocks)
    assert damage["split_code_blocks"] == 0


def test_oversized_table_repeats_header(tmp_path: Path) -> None:
    rows = "\n".join(f"| item {i} | value {i} | note number {i} |" for i in range(80))
    doc = tmp_path / "table.md"
    doc.write_text(f"# Data\n\n| Name | Value | Note |\n|---|---|---|\n{rows}\n", encoding="utf-8")
    result = chunk_document(doc, Settings(min_chunk_tokens=20, max_chunk_tokens=120), "doc_ffffffff")
    assert len(result.chunks) > 1
    for chunk in result.chunks:
        lines = chunk.text.split("\n")
        assert lines[0] == "# Data"
        assert "| Name | Value | Note |" in lines


def test_naive_breaks_structure_that_smart_keeps(tmp_path: Path) -> None:
    blocks = []
    for i in range(12):
        blocks.append(f"## Part {i}\n\nSome explanation for part {i}, written as a normal sentence.\n")
        blocks.append("```python\n" + "\n".join(f"line_{i}_{j} = {j} * {i}" for j in range(12)) + "\n```\n")
        blocks.append("| col a | col b |\n|---|---|\n" + "\n".join(f"| a{i}{j} | b{i}{j} |" for j in range(6)) + "\n")
    doc = tmp_path / "mixed.md"
    doc.write_text("# Mixed\n\n" + "\n".join(blocks), encoding="utf-8")
    settings = Settings(naive_chunk_tokens=120, naive_overlap_tokens=10)
    smart = chunk_document(doc, settings, "doc_ffffffff")
    naive = naive_chunk_document(doc, settings, "doc_ffffffff")
    smart_damage = count_structural_damage(smart.raw_blocks, smart.chunks, smart.oversized_blocks)
    naive_damage = count_structural_damage(smart.raw_blocks, naive)
    assert smart_damage["split_code_blocks"] == smart_damage["split_tables"] == 0
    assert naive_damage["split_code_blocks"] + naive_damage["split_tables"] > 0


def test_document_errors(tmp_path: Path, make_pdf) -> None:
    empty = tmp_path / "empty.md"
    empty.write_text("   \n\n", encoding="utf-8")
    with pytest.raises(EmptyDocumentError):
        chunk_document(empty, Settings(), "doc_ffffffff")
    bad = tmp_path / "notes.docx"
    bad.write_text("x", encoding="utf-8")
    with pytest.raises(UnsupportedFileError):
        chunk_document(bad, Settings(), "doc_ffffffff")
    scanned = make_pdf([[]], name="scanned.pdf")
    with pytest.raises(ScannedPdfError):
        chunk_document(scanned, Settings(), "doc_ffffffff")
    locked = make_pdf([[("Secret text on the page", 11, "helv")]], name="locked.pdf", password="pw")
    with pytest.raises(EncryptedPdfError):
        chunk_document(locked, Settings(), "doc_ffffffff")


def test_settings_validation() -> None:
    from smartchunk.config import SettingsError

    with pytest.raises(SettingsError):
        Settings(min_chunk_tokens=300, max_chunk_tokens=200).validate()
    with pytest.raises(SettingsError):
        Settings(naive_chunk_tokens=100, naive_overlap_tokens=100).validate()
    with pytest.raises(SettingsError):
        Settings(top_k=0).validate()
    Settings().validate()
