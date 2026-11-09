"""Parser for 人口推計 長期時系列データ 第4表 (lt1920, 1920–2000, 各歳・男女別).

``parse(path) -> list[YearTable]`` returns 1920–1940 and 1944–2000 (78 years).
Values in the source are in thousands of persons and are converted to persons.

Layout (0-based rows): row 5 holds year headings such as
「昭 和 20 年 1 9 4 5 2)」 at the 男女計 column (+1 = 男, +2 = 女).
Age-label columns (列0 and columns titled 「年齢」/「（数え年）」 in rows 6–9)
may appear between years; each year uses the nearest label column to its left.

Known disagreements with ``year_meta`` (checked strictly against the table
labels via ``TABLE_OPEN_AGE``):
- 1951–1954 end at 「80 歳以上」 (1952: 「79 歳以上」), not 85.
- 2000 ends at 「90 歳以上」; ``year_meta(2000)`` describes lt2000 (100 歳以上),
  so 2000 is returned with source_id "lt1920" and the merger prefers lt2000.
"""
from __future__ import annotations

import re
import unicodedata

import openpyxl

from .model import AGE_MAX, YearTable, year_meta

SOURCE_ID = "lt1920"
YEAR_ROW = 5
LABEL_HEADER_ROWS = range(6, 10)
FIRST_DATA_ROW = 10
EXPECTED_YEARS = list(range(1920, 1941)) + list(range(1944, 2001))
DASHES = {"－", "-", "‐", "−", "—", "―", "…", "***", "x", "X", ""}


# Open age printed in the table where it differs from model.open_age().
TABLE_OPEN_AGE = {1951: 80, 1952: 79, 1953: 80, 1954: 80, 2000: 90}


class ParseError(ValueError):
    pass


def _norm(v) -> str:
    if v is None:
        return ""
    s = unicodedata.normalize("NFKC", str(v))
    return re.sub(r"\s+", "", s)


def _heading_year(v):
    s = _norm(v)
    m = re.search(r"年(\d{4})", s)
    return int(m.group(1)) if m else None


def _label(v):
    """Return ("total", None) | ("age", n) | ("open", n) | None."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if float(v).is_integer():
            return ("age", int(v))
        return None
    s = _norm(v)
    if s == "総数":
        return ("total", None)
    m = re.fullmatch(r"(\d+)歳以上", s)
    if m:
        return ("open", int(m.group(1)))
    m = re.fullmatch(r"(\d+)(歳)?", s)
    if m:
        return ("age", int(m.group(1)))
    return None


def _value(v):
    """Thousands -> persons (int), or None for 「－」 etc."""
    if v is None:
        return None
    if isinstance(v, bool):
        raise ParseError(f"unexpected boolean cell {v!r}")
    if isinstance(v, (int, float)):
        return int(round(v * 1000))
    s = _norm(v).replace(",", "")
    if s in DASHES:
        return None
    try:
        return int(round(float(s) * 1000))
    except ValueError:
        raise ParseError(f"unexpected value cell {v!r}") from None


def _cell(row, c):
    return row[c] if c < len(row) else None


def _label_columns(rows):
    cols = {0}
    width = max(len(r) for r in rows)
    for c in range(width):
        for r in LABEL_HEADER_ROWS:
            if r < len(rows):
                s = _norm(_cell(rows[r], c))
                if "年齢" in s or "数え年" in s:
                    cols.add(c)
    return sorted(cols)


def _sheet_notes(rows, label_cols):
    last = FIRST_DATA_ROW
    for i in range(FIRST_DATA_ROW, len(rows)):
        if any(_label(_cell(rows[i], c)) for c in label_cols):
            last = i
    notes = []
    for row in rows[last + 1:]:
        for v in row:
            if isinstance(v, str) and v.strip():
                notes.append(v.strip())
    return notes


def _parse_year(ws_title, rows, year, col, label_col, notes):
    meta = year_meta(year)
    min_age = meta["min_age"]
    open_age = meta["open_age"]
    src = meta["source_id"]
    open_age = TABLE_OPEN_AGE.get(year, open_age)  # see module doc
    if year == 2000:
        src = SOURCE_ID
    if src != SOURCE_ID:
        raise ParseError(f"{year}: year_meta source_id={src!r}, expected {SOURCE_ID!r}")

    sexes = ("both", "male", "female")
    total = {}
    by_age = {s: [None] * (AGE_MAX + 1) for s in sexes}
    seen_open = None
    seen_ages = set()
    for i in range(FIRST_DATA_ROW, len(rows)):
        lab = _label(_cell(rows[i], label_col))
        if lab is None:
            continue
        vals = {s: _value(_cell(rows[i], col + k)) for k, s in enumerate(sexes)}
        kind, age = lab
        if kind == "total":
            if any(v is None for v in vals.values()):
                raise ParseError(f"{year}: 総数 has missing values {vals}")
            total = vals
            continue
        if kind == "open":
            if seen_open is not None:
                raise ParseError(f"{year}: two open-ended classes ({seen_open}, {age})")
            seen_open = age
            if age != open_age:
                raise ParseError(
                    f"{year}: table open class 「{age} 歳以上」 != open_age {open_age}")
        else:
            if age in seen_ages or age > AGE_MAX:
                raise ParseError(f"{year}: unexpected age row {age}")
            seen_ages.add(age)
            if age >= open_age:
                raise ParseError(f"{year}: single-age row {age} >= open_age {open_age}")
        if age < min_age:
            if any(v is not None for v in vals.values()):
                raise ParseError(f"{year}: age {age} < min_age {min_age} has values {vals}")
            continue
        for s in sexes:
            by_age[s][age] = vals[s]

    if not total:
        raise ParseError(f"{year}: 総数 row not found")
    if seen_open is None:
        raise ParseError(f"{year}: open-ended class not found")
    for s in sexes:
        for a in range(min_age, open_age + 1):
            if by_age[s][a] is None:
                raise ParseError(f"{year}: missing {s} value at age {a}")

    return YearTable(
        year=year,
        ref_date=meta["ref_date"],
        kazoe=meta["kazoe"],
        min_age=min_age,
        open_age=open_age,
        male=by_age["male"],
        female=by_age["female"],
        total_male=total["male"],
        total_female=total["female"],
        total_both=total["both"],
        precision=meta["precision"],
        excludes_okinawa=meta["excludes_okinawa"],
        basis=meta["basis"],
        source_id=src,
        sheet=ws_title,
        both_by_age=by_age["both"],
        raw_notes=list(notes),
    )


def parse(path) -> list:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        out = {}
        for ws in wb.worksheets:
            rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
            if len(rows) <= YEAR_ROW:
                continue
            label_cols = _label_columns(rows)
            notes = _sheet_notes(rows, label_cols)
            for col, v in enumerate(rows[YEAR_ROW]):
                year = _heading_year(v)
                if year is None:
                    continue
                if year in out:
                    raise ParseError(f"{year}: appears twice")
                left = [c for c in label_cols if c < col]
                if not left:
                    raise ParseError(f"{year}: no label column left of column {col}")
                out[year] = _parse_year(ws.title, rows, year, col, left[-1], notes)
    finally:
        wb.close()

    years = sorted(out)
    if years != EXPECTED_YEARS:
        missing = sorted(set(EXPECTED_YEARS) - set(years))
        extra = sorted(set(years) - set(EXPECTED_YEARS))
        raise ParseError(f"year set mismatch: missing={missing} extra={extra}")
    return [out[y] for y in years]
