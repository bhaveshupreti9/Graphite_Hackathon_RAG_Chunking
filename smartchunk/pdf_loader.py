"""Document loading.

PDFs are read with PyMuPDF and converted page by page to Markdown-like text so the same
markdown-it parser can find structure (spec B4 "Loading"):
  - lines clearly larger than the body text (or short, fully bold lines) become #/##/### headings,
    ranked by font size;
  - lines starting with a bullet character become "- " list items;
  - runs of monospaced lines become fenced code blocks.
Markdown and text files are read as UTF-8 (latin-1 fallback) and treated as a single page.
CSV, TSV and Excel files are converted to Markdown tables by smartchunk.tabular.
"""

from __future__ import annotations

import re
import statistics
from pathlib import Path

from .errors import EmptyDocumentError, EncryptedPdfError, ScannedPdfError, UnsupportedFileError
from .models import PageText
from .tabular import TABULAR_EXTENSIONS, load_tabular, plain_tabular, sheet_count

TEXT_EXTENSIONS = {".md", ".markdown", ".txt"}
PDF_EXTENSIONS = {".pdf"}
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | PDF_EXTENSIONS | TABULAR_EXTENSIONS

BULLET = re.compile(r"^\s*([•◦▪▫‣●○■□·∙\-–—*])\s+")
MONO_HINTS = ("mono", "courier", "consol", "menlo", "code", "inconsolata")
MIN_TEXT_CHARS = 20


def read_text_file(path: Path) -> tuple[str, list[str]]:
    """Returns (text, warnings)."""
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig"), []
    except UnicodeDecodeError:
        return raw.decode("latin-1"), ["The file is not valid UTF-8; it was read as Latin-1."]


def _is_mono(font: str, flags: int) -> bool:
    return bool(flags & 8) or any(hint in font.lower() for hint in MONO_HINTS)


def _open_pdf(path: Path):  # noqa: ANN202 - pymupdf has no stable public type for Document
    import pymupdf

    try:
        doc = pymupdf.open(str(path))
    except Exception as error:  # noqa: BLE001
        raise EmptyDocumentError(f"The PDF could not be opened: {error}") from error
    if doc.needs_pass:
        doc.close()
        raise EncryptedPdfError("This PDF is password protected.")
    return doc


def pdf_plain_pages(path: Path) -> list[PageText]:
    """Plain text per page, no structure and no cleaning (used by the naive baseline)."""
    doc = _open_pdf(path)
    try:
        return [PageText(page=index + 1, text=page.get_text("text")) for index, page in enumerate(doc)]
    finally:
        doc.close()


def load_pdf(path: Path) -> list[PageText]:
    """Markdown-like text per page. Raises EncryptedPdfError / ScannedPdfError / EmptyDocumentError."""
    doc = _open_pdf(path)
    try:
        page_lines: list[list[tuple[str, float, bool, bool]]] = []
        sizes: list[float] = []
        total_chars = 0
        for page in doc:
            lines: list[tuple[str, float, bool, bool]] = []
            data = page.get_text("dict", sort=True)
            for block in data.get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    spans = [span for span in line.get("spans", []) if span.get("text", "").strip()]
                    if not spans:
                        continue
                    text = "".join(span["text"] for span in line.get("spans", [])).rstrip()
                    size = max(float(span.get("size", 0)) for span in spans)
                    bold = all(bool(span.get("flags", 0) & 16) or "bold" in span.get("font", "").lower() for span in spans)
                    mono = all(_is_mono(span.get("font", ""), int(span.get("flags", 0))) for span in spans)
                    lines.append((text, size, bold, mono))
                    total_chars += len(text.strip())
                    sizes.extend([round(size, 1)] * max(1, len(text.strip())))
                # Blank marker between PyMuPDF blocks keeps paragraphs apart.
                lines.append(("", 0.0, False, False))
            page_lines.append(lines)

        if total_chars < MIN_TEXT_CHARS:
            raise ScannedPdfError("This PDF contains only images. OCR is not supported.")

        body = statistics.median(sizes) if sizes else 10.0
        heading_sizes = sorted({size for lines in page_lines for (_, size, _, _) in lines if size > body * 1.15}, reverse=True)
        level_of = {size: min(3, index + 1) for index, size in enumerate(heading_sizes)}

        pages: list[PageText] = []
        for index, lines in enumerate(page_lines):
            out: list[str] = []
            in_code = False
            for text, size, bold, mono in lines:
                stripped = text.strip()
                if not stripped:
                    if in_code:
                        out.append("")
                    else:
                        out.append("")
                    continue
                if mono:
                    if not in_code:
                        out.append("```")
                        in_code = True
                    out.append(text)
                    continue
                if in_code:
                    out.append("```")
                    in_code = False
                rounded = round(size, 1)
                if rounded in level_of and len(stripped) <= 120:
                    out.append(f"{'#' * level_of[rounded]} {stripped}")
                    out.append("")
                elif bold and len(stripped) <= 80 and not stripped.endswith((".", ",", ";", ":")) and abs(size - body) < 0.6:
                    out.append(f"### {stripped}")
                    out.append("")
                elif BULLET.match(stripped):
                    out.append("- " + BULLET.sub("", stripped, count=1))
                else:
                    out.append(stripped)
            if in_code:
                out.append("```")
            text = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip("\n")
            pages.append(PageText(page=index + 1, text=text))
        return pages
    finally:
        doc.close()


def pdf_page_count(path: Path) -> int:
    doc = _open_pdf(path)
    try:
        return len(doc)
    finally:
        doc.close()


_TITLE_END = (".", ",", ";", ":", "!", "?")


def promote_text_headings(text: str) -> str:
    """Plain-text files have no Markdown headings. A short standalone line (blank line before and
    after, no closing punctuation, followed by more text) is treated as a heading: the first one as
    "#", the rest as "##". Files that already contain Markdown headings are left unchanged."""
    lines = text.split("\n")
    if any(re.match(r"^\s{0,3}#{1,6}\s", line) for line in lines):
        return text
    out: list[str] = []
    seen_heading = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        before_blank = i == 0 or not lines[i - 1].strip()
        after_blank = i + 1 < len(lines) and not lines[i + 1].strip()
        has_more = any(other.strip() for other in lines[i + 1 :])
        title_like = (
            0 < len(stripped) <= 60
            and not stripped.endswith(_TITLE_END)
            and not BULLET.match(stripped)
            and not re.match(r"^\d+[.)]\s", stripped)
        )
        if title_like and before_blank and after_blank and has_more:
            out.append(("## " if seen_heading else "# ") + stripped)
            seen_heading = True
        else:
            out.append(line)
    return "\n".join(out)


def load_document(path: Path, display_name: str | None = None) -> tuple[list[PageText], list[str]]:
    """Structured pages for SmartChunk plus warnings. Raises the DocumentError subclasses.

    `display_name` is the original upload name, used to title spreadsheet sheets."""
    extension = path.suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileError(f"Unsupported file type: {extension or '(none)'}.")
    if extension in PDF_EXTENSIONS:
        return load_pdf(path), []
    if extension in TABULAR_EXTENSIONS:
        return load_tabular(path, display_name)
    text, warnings = read_text_file(path)
    if not text.strip():
        raise EmptyDocumentError("The file contains no text.")
    if extension == ".txt":
        text = promote_text_headings(text)
    return [PageText(page=None, text=text)], warnings


def load_plain(path: Path) -> list[PageText]:
    """Unstructured pages for the naive baseline."""
    if path.suffix.lower() in PDF_EXTENSIONS:
        return pdf_plain_pages(path)
    if path.suffix.lower() in TABULAR_EXTENSIONS:
        return plain_tabular(path)
    text, _ = read_text_file(path)
    return [PageText(page=None, text=text)]


def document_page_count(path: Path) -> int:
    """Pages for a PDF, sheets for a workbook, 1 for everything else."""
    extension = path.suffix.lower()
    if extension in PDF_EXTENSIONS:
        return pdf_page_count(path)
    if extension in TABULAR_EXTENSIONS:
        return sheet_count(path)
    return 1
