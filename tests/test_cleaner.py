from __future__ import annotations

from pathlib import Path

from smartchunk.cleaner import detect_repeated_lines, normalize_line, strip_noise
from smartchunk.models import PageText
from smartchunk.pdf_loader import load_pdf


def _pages(count: int) -> list[PageText]:
    return [
        PageText(
            page=i + 1,
            text=f"ACME Manual v2\n\n# Section {i}\n\nBody text {i} about topic {i}.\n\nPage {i + 1} of {count}",
        )
        for i in range(count)
    ]


def test_normalize_line() -> None:
    assert normalize_line("  Page 12 of  40 ") == "page ## of ##"


def test_detects_header_and_footer() -> None:
    repeated = detect_repeated_lines(_pages(5))
    assert repeated["acme manual v#"][0] == "header"
    assert repeated["page # of #"][0] == "footer"
    assert "body text # about topic #." not in repeated


def test_strip_noise_removes_and_reports() -> None:
    clean, removed = strip_noise(_pages(5))
    assert all("ACME Manual" not in page.text and "Page " not in page.text for page in clean)
    assert all("Body text" in page.text for page in clean)
    kinds = {item.kind for item in removed}
    assert kinds == {"header", "footer"}
    assert len(removed) == 10
    assert all(item.page is not None and "pages" in item.reason for item in removed)


def test_needs_at_least_three_pages() -> None:
    assert detect_repeated_lines(_pages(2)) == {}


def test_real_pdf_header_footer(samples_dir: Path) -> None:
    pages = load_pdf(samples_dir / "python_tutorial_print.pdf")
    clean, removed = strip_noise(pages)
    texts = {item.text for item in removed}
    assert "Python Tutorial - Release 3.12" in texts
    assert any(text.startswith("Page ") for text in texts)
    header_items = [item for item in removed if item.text == "Python Tutorial - Release 3.12"]
    assert all(item.kind == "header" for item in header_items)
    assert all("Release 3.12" not in page.text for page in clean)
