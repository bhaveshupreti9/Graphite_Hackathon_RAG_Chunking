"""Ugly real-world inputs must either chunk cleanly or fail with a DocumentError, never crash."""

from __future__ import annotations

from pathlib import Path

import pytest

from baseline.naive import naive_chunk_document
from eval.metrics import covers, mrr, prf, recall_at_k
from smartchunk.chunker import chunk_document
from smartchunk.config import Settings
from smartchunk.errors import DocumentError
from smartchunk.tokenizer import count_tokens

UGLY = {
    "emoji.md": "# Café ☕ notes 🚀\n\nUnicode works — even “smart quotes” and 中文 text.\n".encode(),
    "latin1.txt": "Résumé of the café menu.\n\nPrices in £ and ¥.\n".encode("latin-1"),
    "bom.md": "﻿# Title\n\nBody after a byte order mark.\n".encode("utf-8"),
    "crlf.md": b"# Title\r\n\r\nWindows line endings.\r\n\r\n- one\r\n- two\r\n",
    "only_headings.md": b"# A\n\n## B\n\n### C\n",
    "unclosed_fence.md": b"# Code\n\n```python\ndef f():\n    return 1\n",
    "one_long_line.txt": ("word " * 6000).encode(),
    "nested_lists.md": b"# Lists\n\n- a\n  - b\n    - c\n      - d\n- e\n",
    "broken_table.md": b"# T\n\n| a | b |\n| 1 | 2 |\n| 3 |\n",
    "html.md": b"# H\n\n<div><b>raw html</b></div>\n\n<script>alert(1)</script>\n",
    "whitespace.txt": b"   \n\n\t\n",
}


@pytest.mark.parametrize("name", sorted(UGLY))
def test_ugly_inputs(name: str, tmp_path: Path) -> None:
    path = tmp_path / name
    path.write_bytes(UGLY[name])
    settings = Settings()
    try:
        result = chunk_document(path, settings, "doc_0badf00d")
    except DocumentError:
        assert name in {"whitespace.txt"}, f"{name} should be readable"
        return
    naive = naive_chunk_document(path, settings, "doc_0badf00d")
    for chunk in result.chunks:
        assert chunk.text.strip()
        assert chunk.type in ("prose", "code", "table", "list")
        assert chunk.token_count == count_tokens(chunk.text)
        # Code may legitimately exceed max when it cannot be split safely; prose may not.
        if chunk.type == "prose":
            assert chunk.token_count <= settings.max_chunk_tokens + 40, (name, chunk.token_count)
    assert [c.chunk_id for c in result.chunks] == [f"doc_0badf00d_smart_{i:04d}" for i in range(len(result.chunks))]
    assert all(c.chunk_id.startswith("doc_0badf00d_naive_") for c in naive)


def test_metrics() -> None:
    assert recall_at_k([1, None, 6, 2], 5) == 0.5
    assert mrr([1, None, 2, 4]) == round((1 + 0.5 + 0.25) / 4, 4)
    assert prf([1, 0, 1, 0], [1, 1, 0, 0]) == {"precision": 0.5, "recall": 0.5, "f1": 0.5}
    assert covers("def f():\n    return 1\nprint(f())", "def f(): return 1")
    assert not covers("def f():", "def f(): return the value of one plus two")


def test_eval_runs_and_matches_contract(tmp_path: Path) -> None:
    from eval.run_eval import HERE, run

    result = run(Settings(), HERE / "questions.json", with_classifier=True)
    assert result["questions_count"] >= 30
    assert set(result["documents"]) == {"python_tutorial.md", "api_reference.md", "company_handbook.txt"}
    assert result["damage"]["smart"]["split_code_blocks"] == 0
    assert result["damage"]["smart"]["split_tables"] == 0
    assert result["classifier"] is None or result["classifier"]["test_pairs"] > 0
