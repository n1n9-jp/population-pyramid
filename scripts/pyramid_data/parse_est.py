"""est2021〜est2024（人口推計 第1表、2段組、千人→人）のパーサ。"""
from __future__ import annotations

import re

import openpyxl

from .common import ParseError, age_label, check_meta, norm, num
from .model import AGE_MAX, YearTable, year_meta

SHEET = "第1表"


def _year_of(rows):
    for r in rows[:8]:
        for c in r:
            m = re.search(r"(\d{4})年10月", norm(c))
            if m:
                return int(m.group(1))
    raise ParseError("標題から年を読めません")


def parse(path) -> list:
    wb = openpyxl.load_workbook(path, data_only=True)
    if SHEET not in wb.sheetnames:
        raise ParseError(f"シート {SHEET!r} がありません")
    rows = [list(r) for r in wb[SHEET].iter_rows(values_only=True)]
    year = _year_of(rows)
    if not 2021 <= year <= 2024:
        raise ParseError(f"想定外の年 {year}")
    m = year_meta(year)
    # 左の段は列0（ラベル）、右の段は「年齢」見出しの2つ目の列
    heads = [c for c, v in enumerate(next(r for r in rows if sum(norm(x) == "年齢" for x in r) >= 2)) if norm(v) == "年齢"]
    if len(heads) != 2:
        raise ParseError("年齢列が2つありません")
    left, right = heads
    total = None
    male, female, both = ([None] * (AGE_MAX + 1) for _ in range(3))
    seen = set()
    open_label = None
    for r in rows:
        for blk, base in (("L", left), ("R", right)):
            lab = age_label(r[base]) if base < len(r) else None
            if lab is None:
                continue
            vals = [num(r[base + k]) for k in (1, 2, 3)]
            if lab[0] == "total":
                if blk != "L":
                    raise ParseError("総数が右の段にあります")
                total = vals
                continue
            a = lab[1]
            if lab[0] == "open":
                if a != 100:
                    raise ParseError(f"想定外の最終区分 {a}歳以上")
                open_label = a
            if a in seen or None in vals or not (0 <= a <= 100):
                raise ParseError(f"{year}: 年齢行 {a} が不正 {vals}")
            if (blk == "L") != (a < 50):
                raise ParseError(f"{year}: {a}歳が想定外の段にあります")
            seen.add(a)
            both[a], male[a], female[a] = (v * 1000 for v in vals)
    if seen != set(range(101)) or total is None or None in total:
        raise ParseError(f"{year}: 0〜100歳 / 総数がそろっていません")
    t = YearTable(
        year=year, ref_date=m["ref_date"], kazoe=m["kazoe"], min_age=m["min_age"], open_age=m["open_age"],
        male=male, female=female, total_male=total[1] * 1000, total_female=total[2] * 1000,
        total_both=total[0] * 1000, precision=m["precision"], excludes_okinawa=m["excludes_okinawa"],
        basis=m["basis"], source_id=f"est{year}", sheet=SHEET, both_by_age=both,
    )
    check_meta(t, year, open_label)
    return [t]
