"""Spreadsheet loading: CSV, TSV and Excel (.xlsx / .xlsm).

A sheet becomes Markdown that the normal pipeline understands:

    # <sheet name>
    <one paragraph describing the sheet>
    ## Column overview      <- a table: type, filled, unique, min, max, average, sum, top values
    ## Data                 <- the rows as a Markdown table (row numbers in the first column)

The chunker keeps tables whole and, when a table is too big for one chunk, splits it between rows
and repeats the header row, so every data chunk can be read on its own. Statistics are computed
over up to MAX_STATS_ROWS rows; the Data table holds the first MAX_TABLE_ROWS rows.

All sheets go into ONE page on purpose: the header/footer cleaner compares pages, and identical
column-header rows on several sheets must never be mistaken for repeated page headers.
"""

from __future__ import annotations

import csv
import io
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from .errors import EmptyDocumentError, UnsupportedFileError
from .models import PageText

CSV_EXTENSIONS = {".csv", ".tsv"}
EXCEL_EXTENSIONS = {".xlsx", ".xlsm"}
TABULAR_EXTENSIONS = CSV_EXTENSIONS | EXCEL_EXTENSIONS

MAX_TABLE_ROWS = 2000
MAX_STATS_ROWS = 50_000
MAX_COLUMNS = 60
MAX_CELL_CHARS = 200

_NUMBER_JUNK = re.compile(r"[\s,$€£¥₹%]")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$")


@dataclass
class Sheet:
    name: str
    header: list[str]
    rows: list[list[str]] = field(default_factory=list)  # rows kept for the Data table
    stats_rows: list[list[str]] = field(default_factory=list)  # rows used for statistics
    total_rows: int = 0  # every non-empty data row seen (may exceed what was kept)


# Cell and header cleaning -----------------------------------------------------------------------


def cell_text(value: Any) -> str:
    """A spreadsheet value as display text (no Markdown escaping yet)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == time(0, 0) else value.isoformat(sep=" ", timespec="minutes")
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return ""
        return str(int(value)) if value.is_integer() and abs(value) < 1e15 else f"{value:.10g}"
    return " ".join(str(value).split())


def _md_cell(text: str) -> str:
    text = text.replace("\\", "\\\\").replace("|", "\\|")
    return text if len(text) <= MAX_CELL_CHARS else text[: MAX_CELL_CHARS - 1] + "…"


def _unique_header(raw: list[str]) -> list[str]:
    header: list[str] = []
    seen: Counter[str] = Counter()
    for index, name in enumerate(raw):
        name = name.strip() or f"Column {index + 1}"
        seen[name.lower()] += 1
        header.append(name if seen[name.lower()] == 1 else f"{name} ({seen[name.lower()]})")
    return header


def _looks_like_header(row: list[str]) -> bool:
    """A first row of mostly numbers is data, not column names."""
    filled = [cell for cell in row if cell]
    if not filled:
        return False
    numeric = sum(1 for cell in filled if to_number(cell) is not None)
    return numeric < max(1, len(filled)) / 2


def _add_rows(sheet: Sheet, rows: list[list[str]]) -> None:
    width = len(sheet.header)
    for row in rows:
        if not any(row):
            continue
        row = (row + [""] * width)[:width]
        sheet.total_rows += 1
        if len(sheet.stats_rows) < MAX_STATS_ROWS:
            sheet.stats_rows.append(row)
        if len(sheet.rows) < MAX_TABLE_ROWS:
            sheet.rows.append(row)


def _build_sheet(name: str, raw_rows: list[list[str]]) -> Sheet | None:
    rows = [row for row in raw_rows if any(cell for cell in row)]
    if not rows:
        return None
    width = min(MAX_COLUMNS, max(len(row) for row in rows))
    # Drop columns that are empty in every row (common at the right edge of Excel sheets).
    used = [i for i in range(width) if any(i < len(row) and row[i] for row in rows)]
    if not used:
        return None
    rows = [[row[i] if i < len(row) else "" for i in used] for row in rows]
    if _looks_like_header(rows[0]):
        header, data = _unique_header(rows[0]), rows[1:]
    else:
        header, data = [f"Column {i + 1}" for i in range(len(used))], rows
    sheet = Sheet(name=name, header=header)
    _add_rows(sheet, data)
    return sheet


# Readers ----------------------------------------------------------------------------------------


def _decode(data: bytes) -> tuple[str, list[str]]:
    try:
        return data.decode("utf-8-sig"), []
    except UnicodeDecodeError:
        return data.decode("latin-1"), ["The file is not valid UTF-8, so it was read as Latin-1."]


def _read_csv(path: Path) -> tuple[list[Sheet], list[str]]:
    text, warnings = _decode(path.read_bytes())
    if not text.strip():
        raise EmptyDocumentError("The file contains no data.")
    if path.suffix.lower() == ".tsv":
        delimiter = "\t"
    else:
        try:
            delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    raw: list[list[str]] = []
    for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter):
        raw.append([" ".join(cell.split()) for cell in row])
        if len(raw) > MAX_STATS_ROWS + 1:
            warnings.append(f"Only the first {MAX_STATS_ROWS:,} rows were analysed.")
            break
    sheet = _build_sheet(path.stem, raw)
    if sheet is None:
        raise EmptyDocumentError("The file contains no data.")
    return [sheet], warnings


def _read_excel(path: Path) -> tuple[list[Sheet], list[str]]:
    try:
        import openpyxl
    except ImportError as error:  # pragma: no cover - depends on the installation
        raise UnsupportedFileError(
            "Excel files need the openpyxl package. Run: pip install -r requirements.txt"
        ) from error
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as error:  # noqa: BLE001 - corrupt, encrypted or not really an xlsx file
        raise EmptyDocumentError(f"The spreadsheet could not be opened: {error}") from error
    sheets: list[Sheet] = []
    warnings: list[str] = []
    try:
        for worksheet in workbook.worksheets:
            raw: list[list[str]] = []
            for values in worksheet.iter_rows(values_only=True):
                raw.append([cell_text(value) for value in values[:MAX_COLUMNS]])
                if len(raw) > MAX_STATS_ROWS + 1:
                    warnings.append(f"Sheet '{worksheet.title}': only the first {MAX_STATS_ROWS:,} rows were analysed.")
                    break
            sheet = _build_sheet(worksheet.title, raw)
            if sheet is not None:
                sheets.append(sheet)
    finally:
        workbook.close()
    if not sheets:
        raise EmptyDocumentError("Every sheet in this workbook is empty.")
    return sheets, warnings


def read_sheets(path: Path) -> tuple[list[Sheet], list[str]]:
    extension = path.suffix.lower()
    if extension in CSV_EXTENSIONS:
        return _read_csv(path)
    if extension in EXCEL_EXTENSIONS:
        return _read_excel(path)
    raise UnsupportedFileError(f"Unsupported spreadsheet type: {extension}.")


# Column statistics ------------------------------------------------------------------------------


def to_number(text: str) -> float | None:
    cleaned = _NUMBER_JUNK.sub("", text)
    if cleaned.startswith("(") and cleaned.endswith(")"):  # accounting negative: (120)
        cleaned = "-" + cleaned[1:-1]
    if not cleaned or not re.match(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$", cleaned):
        return None
    value = float(cleaned)
    return value if math.isfinite(value) else None


def format_number(value: float) -> str:
    if value.is_integer() and abs(value) < 1e15:
        return f"{int(value):,}"
    if abs(value) >= 1000:
        return f"{value:,.2f}"
    return f"{value:.4g}"


def column_profile(name: str, values: list[str]) -> dict[str, str]:
    filled = [value for value in values if value]
    profile = {"Column": name, "Type": "empty", "Filled": f"{len(filled):,} of {len(values):,}",
               "Unique": f"{len(set(filled)):,}", "Min": "", "Max": "", "Average": "", "Sum": "", "Most common": ""}
    if not filled:
        return profile
    numbers = [n for n in (to_number(value) for value in filled) if n is not None]
    if len(numbers) >= 0.9 * len(filled):
        profile.update(Type="number", Min=format_number(min(numbers)), Max=format_number(max(numbers)),
                       Average=format_number(sum(numbers) / len(numbers)), Sum=format_number(sum(numbers)))
    elif sum(1 for value in filled if _ISO_DATE.match(value)) >= 0.9 * len(filled):
        dates = sorted(value for value in filled if _ISO_DATE.match(value))
        profile.update(Type="date", Min=dates[0], Max=dates[-1])
    else:
        profile["Type"] = "text"
    if profile["Type"] != "number":
        common = Counter(filled).most_common(3)
        profile["Most common"] = ", ".join(f"{value} ({count:,})" for value, count in common if count > 1 or len(common) == 1)
    return profile


# Markdown output ---------------------------------------------------------------------------------


def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(_md_cell(cell) for cell in header) + " |",
             "|" + "|".join("---" for _ in header) + "|"]
    lines.extend("| " + " | ".join(_md_cell(cell) for cell in row) + " |" for row in rows)
    return "\n".join(lines)


def sheet_markdown(sheet: Sheet, title: str) -> str:
    columns = len(sheet.header)
    profiles = [column_profile(name, [row[i] for row in sheet.stats_rows]) for i, name in enumerate(sheet.header)]
    numeric = [p["Column"] for p in profiles if p["Type"] == "number"]
    described = ", ".join(sheet.header[:12]) + (f" and {columns - 12} more" if columns > 12 else "")
    summary = (
        f"The sheet {title} has {sheet.total_rows:,} data rows and {columns} columns: {described}."
        + (f" Numeric columns: {', '.join(numeric[:10])}." if numeric else "")
    )
    if sheet.total_rows > len(sheet.rows):
        summary += f" The data table below shows the first {len(sheet.rows):,} rows; the column overview covers {len(sheet.stats_rows):,}."
    overview_columns = ["Column", "Type", "Filled", "Unique", "Min", "Max", "Average", "Sum", "Most common"]
    overview = _table(overview_columns, [[p[key] for key in overview_columns] for p in profiles])
    data_header = ["Row", *sheet.header]
    data_rows = [[str(index + 1), *row] for index, row in enumerate(sheet.rows)]
    parts = [f"# {title}", summary, "## Column overview", overview]
    if data_rows:
        parts += ["## Data", _table(data_header, data_rows)]
    return "\n\n".join(parts) + "\n"


def load_tabular(path: Path, display_name: str | None = None) -> tuple[list[PageText], list[str]]:
    """Structured Markdown for SmartChunk: one page holding every sheet.

    `display_name` is the file name the user uploaded (stored copies are renamed to the doc id);
    a CSV's single sheet is titled after it."""
    sheets, warnings = read_sheets(path)
    csv_title = Path(display_name).stem if display_name else path.stem
    texts = [sheet_markdown(sheet, csv_title if path.suffix.lower() in CSV_EXTENSIONS else sheet.name)
             for sheet in sheets]
    for sheet in sheets:
        if sheet.total_rows > MAX_TABLE_ROWS:
            warnings.append(
                f"'{sheet.name}' has {sheet.total_rows:,} rows; the first {MAX_TABLE_ROWS:,} were chunked for chat."
            )
    return [PageText(page=None, text="\n".join(texts))], warnings


def plain_tabular(path: Path) -> list[PageText]:
    """What a traditional chunker sees: the raw delimited text, sheet after sheet."""
    if path.suffix.lower() in CSV_EXTENSIONS:
        text, _ = _decode(path.read_bytes())
        return [PageText(page=None, text=text)]
    sheets, _ = read_sheets(path)
    blocks = []
    for sheet in sheets:
        lines = [", ".join(sheet.header)] + [", ".join(row) for row in sheet.rows]
        blocks.append(f"Sheet: {sheet.name}\n" + "\n".join(lines))
    return [PageText(page=None, text="\n\n".join(blocks))]


def sheet_count(path: Path) -> int:
    if path.suffix.lower() in EXCEL_EXTENSIONS:
        try:
            sheets, _ = read_sheets(path)
            return max(1, len(sheets))
        except Exception:  # noqa: BLE001 - only used for a display count
            return 1
    return 1
