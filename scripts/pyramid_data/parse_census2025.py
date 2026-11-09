"""令和7年国勢調査 第2-1表（人、不詳補完値）のパーサ。国籍総数×男/女×全国。"""
from __future__ import annotations

import re

import openpyxl

from .common import ParseError, check_meta
from .model import YearTable, year_meta

SHEET = "wb02_01"
YEAR = 2025


def parse(path) -> list:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if SHEET not in wb.sheetnames:
        raise ParseError(f"シート {SHEET!r} がありません")
    rows = [list(r) for r in wb[SHEET].iter_rows(values_only=True)]
    hi = next((i for i, r in enumerate(rows) if len(r) > 3 and r[3] == "項目名"), None)
    if hi is None:
        raise ParseError("項目名の行がありません")
    cols = {}
    for c, v in enumerate(rows[hi]):
        if isinstance(v, str) and re.match(r"\d{3}_", v):
            cols[int(v[:3])] = (c, v)
    if cols.get(0, (0, ""))[1] != "000_総数" or 112 not in cols or "不詳" not in cols[112][1]:
        raise ParseError("総数 / 不詳の列が見つかりません")
    # 001_0歳 … 101_100歳 … 111_110歳以上
    for code in range(1, 112):
        lab = cols.get(code, (0, ""))[1]
        m = re.fullmatch(rf"{code:03d}_(\d+)歳(以上)?", lab)
        if not m or int(m.group(1)) != code - 1:
            raise ParseError(f"年齢列 {code} のラベルが想定外: {lab!r}")
    if not cols[111][1].endswith("110歳以上") or cols[101][1] != "101_100歳":
        raise ParseError("100歳以上の列が想定外")
    data = {}
    for r in rows[hi + 1:]:
        if r[0] == "0_国籍総数" and r[3] == "00000_全国":
            data[r[1]] = r
    sexes = {"1_男": "male", "2_女": "female", "0_総数": "both"}
    if set(data) != set(sexes):
        raise ParseError(f"全国の行が想定と異なる: {sorted(data)}")

    def pick(r):
        ages = [r[cols[c][0]] for c in range(1, 101)]
        ages.append(sum(r[cols[c][0]] for c in range(101, 112)))
        if any(not isinstance(v, int) for v in ages):
            raise ParseError("数値でないセルがあります")
        return ages, r[cols[0][0]], r[cols[112][0]]

    (male, tm, um), (female, tf, uf), (_both, tb, _ub) = (pick(data[k]) for k in ("1_男", "2_女", "0_総数"))
    m = year_meta(YEAR)
    t = YearTable(
        year=YEAR, ref_date=m["ref_date"], kazoe=False, min_age=0, open_age=m["open_age"],
        male=male, female=female, total_male=tm, total_female=tf, total_both=tb,
        unknown_male=um, unknown_female=uf, precision=1, excludes_okinawa=False,
        basis=m["basis"], source_id="census2025", sheet=SHEET,
        both_by_age=_both,
    )
    check_meta(t, YEAR, 100)
    return [t]
