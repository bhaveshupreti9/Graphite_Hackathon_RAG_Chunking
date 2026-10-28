"""Shared test setup.

Tests use the offline hashing embedder (no model download) and temporary data folders, so they run
anywhere. The LLM is faked where a test needs one.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("EMBEDDING_BACKEND", "hash")
os.environ["SMARTCHUNK_SKIP_DOTENV"] = "1"  # never let a developer's real .env leak into tests

SAMPLES = ROOT / "data" / "samples"
CONTRACTS = ROOT / "contracts"


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_BACKEND", "hash")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("OUTPUTS_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("CHROMA_PATH", str(tmp_path / "chroma"))
    monkeypatch.setenv("SAMPLES_DIR", str(SAMPLES))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)


@pytest.fixture
def samples_dir() -> Path:
    return SAMPLES


@pytest.fixture
def make_pdf(tmp_path: Path):
    """Factory for small PDFs with optional repeated header/footer lines."""
    import pymupdf

    def build(pages: list[list[tuple[str, float, str]]], header: str | None = None, footer: bool = False,
              name: str = "doc.pdf", password: str | None = None) -> Path:
        doc = pymupdf.open()
        for index, lines in enumerate(pages):
            page = doc.new_page(width=595, height=842)
            y = 90
            for text, size, font in lines:
                page.insert_text((56, y), text, fontsize=size, fontname=font)
                y += size + 6
            if header:
                page.insert_text((56, 40), header, fontsize=8, fontname="helv")
            if footer:
                page.insert_text((450, 810), f"Page {index + 1} of {len(pages)}", fontsize=8, fontname="helv")
        target = tmp_path / name
        if password:
            doc.save(str(target), encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)
        else:
            doc.save(str(target))
        doc.close()
        return target

    return build
