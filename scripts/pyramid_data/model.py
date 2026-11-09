"""Shared intermediate representation and per-year metadata (the contract).

Every parser returns ``list[YearTable]``. Values are in persons.
Per-year metadata (open age, kazoe, ref date, Okinawa, basis, source) is
fixed here so that parsers, the merger and the verifier agree.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

AGE_MAX = 100  # arrays are indexed 0..100
YEARS = list(range(1920, 1941)) + list(range(1944, 2026))  # 103 years
GAP = (1941, 1943)

KAZOE_YEARS = {1944, 1945, 1946}
REF_DATES = {1944: "1944-02-22", 1945: "1945-11-01", 1946: "1946-04-26"}
CENSUS_YEARS = {1920, 1925, 1930, 1935, 1940, 1947} | set(range(1950, 2026, 5))
INTERCENSAL_YEARS = (
    {y for y in range(1921, 1940) if y not in CENSUS_YEARS}
    | {1948, 1949}
    | set(range(2016, 2020))
)


def open_age(year: int) -> int:
    if year in (1945, 1946):
        return 86
    if year < 1980:
        return 85
    if year < 2000:
        return 90
    return 100


def source_id(year: int) -> str:
    if year < 2000:
        return "lt1920"
    if year <= 2020:
        return "lt2000"
    if year <= 2024:
        return f"est{year}"
    return "census2025"


def basis(year: int) -> str:
    if year in CENSUS_YEARS:
        return "census"
    if year in KAZOE_YEARS:
        return "survey"
    if year in INTERCENSAL_YEARS:
        return "intercensal"
    return "estimate"


def year_meta(year: int) -> dict:
    kazoe = year in KAZOE_YEARS
    return {
        "year": year,
        "ref_date": REF_DATES.get(year, f"{year}-10-01"),
        "kazoe": kazoe,
        "min_age": 1 if kazoe else 0,
        "open_age": open_age(year),
        "excludes_okinawa": 1945 <= year <= 1971,
        "basis": basis(year),
        "source_id": source_id(year),
        "precision": 1 if year == 2025 else 1000,
    }


@dataclass
class YearTable:
    year: int
    ref_date: str
    kazoe: bool
    min_age: int
    open_age: int
    male: list  # len 101; int persons or None (None iff age<min_age or age>open_age)
    female: list
    total_male: int  # the table's 総数 row, persons
    total_female: int
    total_both: int
    unknown_male: int = 0
    unknown_female: int = 0
    precision: int = 1000
    excludes_okinawa: bool = False
    basis: str = "estimate"
    source_id: str = ""
    sheet: str = ""
    both_by_age: Optional[list] = None  # 男女計 column (verification only)
    raw_notes: list = field(default_factory=list)
