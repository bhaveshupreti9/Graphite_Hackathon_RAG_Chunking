"""Builds python_tutorial_print.pdf from python_tutorial.md with PyMuPDF.

Headings use larger fonts, code uses Courier, and every page gets a running header, a copyright
footer and a page number, so the PDF loader and the header/footer cleaner have real work to do.
Run from the repo root: python data/samples/make_sample_pdf.py
"""

from pathlib import Path

import pymupdf

HERE = Path(__file__).parent
SOURCE = HERE / "python_tutorial.md"
TARGET = HERE / "python_tutorial_print.pdf"

PAGE_W, PAGE_H = 595, 842
MARGIN_X, TOP, BOTTOM = 56, 90, 770
SIZES = {1: 20, 2: 15, 3: 12.5}


def build() -> None:
    lines = SOURCE.read_text(encoding="utf-8").split("\n")
    doc = pymupdf.open()
    page = None
    y = BOTTOM + 1
    in_code = False

    def new_page():
        nonlocal page, y
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        y = TOP

    def write(text: str, size: float, font: str, gap: float = 4) -> None:
        nonlocal y
        if page is None or y + size > BOTTOM:
            new_page()
        page.insert_text((MARGIN_X, y), text, fontsize=size, fontname=font)
        y += size + gap

    for raw in lines:
        if raw.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            write(raw if raw else " ", 9, "cour", 2)
            continue
        if not raw.strip():
            y += 6
            continue
        if raw.startswith("#"):
            level = len(raw) - len(raw.lstrip("#"))
            y += 6
            write(raw.lstrip("# ").strip(), SIZES.get(level, 12), "hebo", 6)
            continue
        text = raw
        if text.lstrip().startswith(("- ", "* ")):
            text = "• " + text.lstrip()[2:]
        # simple word wrap at ~95 characters
        while len(text) > 95:
            cut = text.rfind(" ", 0, 95)
            cut = cut if cut > 0 else 95
            write(text[:cut], 10, "helv", 3)
            text = text[cut:].lstrip()
        write(text, 10, "helv", 3)

    total = len(doc)
    for index, p in enumerate(doc):
        p.insert_text((MARGIN_X, 40), "Python Tutorial - Release 3.12", fontsize=8, fontname="helv")
        p.insert_text((MARGIN_X, 810), "(c) 2026 Example Corp. All rights reserved.", fontsize=8, fontname="helv")
        p.insert_text((PAGE_W - 120, 810), f"Page {index + 1} of {total}", fontsize=8, fontname="helv")
    doc.save(str(TARGET))
    print(f"wrote {TARGET} ({total} pages)")


if __name__ == "__main__":
    build()
