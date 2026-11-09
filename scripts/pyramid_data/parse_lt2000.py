"""lt2000（2000–2020年、総人口シートのみ、千人→人）のパーサ。

既知の食い違い：2000–2004年の列は「90歳以上」の合計が「95」の行に1つだけ入っており
（90〜94・96〜99・100歳以上は空欄）、year_meta の open_age=100 と一致しない。
表のとおり open_age=90 の YearTable として返す（KNOWN_OPEN_AGE）。
"""
from __future__ import annotations

import re

import openpyxl

from .common import ParseError, age_label, check_meta, norm, num
from .model import AGE_MAX, YearTable, year_meta

SOURCE_ID = "lt2000"
SHEETS = ["総人口（2000年～2015年）", "総人口（2015年～2020年）"]  # 2015 は後のシート優先
KNOWN_OPEN_AGE = {y: 90 for y in range(2000, 2005)}
EXPECTED_YEARS = list(range(2000, 2021))


def _heading_year(v):
    s = norm(v)
    if not s:
        return None
    m = re.fullmatch(r"(?:[^\d]*\d+年)?(\d{4})(?:年)?(?:\d\))?", s)
    return int(m.group(1)) if m else None


def _parse_sheet(ws):
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    head = next((i for i, r in enumerate(rows) if sum(_heading_year(c) is not None for c in r) >= 3), None)
    if head is None:
        raise ParseError(f"{ws.title}: 年見出しの行がありません")
    cols = [(c, _heading_year(v)) for c, v in enumerate(rows[head]) if _heading_year(v) is not None]
    total_row = next((i for i in range(head, len(rows)) if age_label(rows[i][0]) == ("total", None)), None)
    if total_row is None:
        raise ParseError(f"{ws.title}: 総数の行がありません")
    age_rows = {}
    for i in range(total_row + 1, len(rows)):
        lab = age_label(rows[i][0])
        if lab is None:
            if any(c is not None for c in rows[i][:3]) and age_rows:
                break
            continue
        if lab[0] == "total":
            break
        age_rows[lab[1]] = (i, lab[0])
    if sorted(age_rows) != list(range(0, 101)) or age_rows[100][1] != "open":
        raise ParseError(f"{ws.title}: 年齢行が0〜99歳と100歳以上になっていません")
    out = {}
    for col, year in cols:
        if year in out:
            raise ParseError(f"{ws.title}: {year}年が重複")
        hdr = [norm(rows[head + k][col]) for k in (2, 3, 4, 5) if head + k < len(rows)]
        if not any("男女計" in h for h in hdr):
            raise ParseError(f"{ws.title}: {year}年の列が男女計でない")
        out[year] = (col, rows, total_row, age_rows)
    return out


def _series(rows, age_rows, c):
    return {a: num(rows[i][c]) for a, (i, _k) in age_rows.items()}


def _build(ws_title, year, col, rows, total_row, age_rows):
    m = year_meta(year)
    both, male, female = (_series(rows, age_rows, col + k) for k in (0, 1, 2))
    totals = [num(rows[total_row][col + k]) for k in (0, 1, 2)]
    if None in totals:
        raise ParseError(f"{year}: 総数が欠損")
    m_arr, f_arr, b_arr = [None] * (AGE_MAX + 1), [None] * (AGE_MAX + 1), [None] * (AGE_MAX + 1)
    open_age = KNOWN_OPEN_AGE.get(year, m["open_age"])
    if open_age == 100:
        for a in range(101):
            for arr, ser in ((m_arr, male), (f_arr, female), (b_arr, both)):
                if ser[a] is None:
                    raise ParseError(f"{year}: {a}歳が欠損")
                arr[a] = ser[a] * 1000
    else:  # 90歳以上が「95」の行にだけある列
        for a in range(open_age):
            for arr, ser in ((m_arr, male), (f_arr, female), (b_arr, both)):
                if ser[a] is None:
                    raise ParseError(f"{year}: {a}歳が欠損")
                arr[a] = ser[a] * 1000
        for ser in (male, female, both):
            extra = [a for a in range(open_age, 101) if a != 95 and ser[a] is not None]
            if extra or ser[95] is None:
                raise ParseError(f"{year}: 90歳以上の置き場所が想定と異なる {extra}")
        m_arr[open_age], f_arr[open_age], b_arr[open_age] = male[95] * 1000, female[95] * 1000, both[95] * 1000
    t = YearTable(
        year=year, ref_date=m["ref_date"], kazoe=m["kazoe"], min_age=m["min_age"], open_age=open_age,
        male=m_arr, female=f_arr, total_male=totals[1] * 1000, total_female=totals[2] * 1000,
        total_both=totals[0] * 1000, precision=m["precision"], excludes_okinawa=m["excludes_okinawa"],
        basis=m["basis"], source_id=SOURCE_ID, sheet=ws_title, both_by_age=b_arr,
    )
    check_meta(t, year, open_age, KNOWN_OPEN_AGE.get(year))
    if open_age != m["open_age"]:
        t.raw_notes.append(f"表の最終区分は{open_age}歳以上（year_meta は{m['open_age']}）")
    return t


def parse(path) -> list:
    wb = openpyxl.load_workbook(path, data_only=True)
    chosen = {}
    for name in SHEETS:
        if name not in wb.sheetnames:
            raise ParseError(f"シート {name!r} がありません")
        for year, spec in _parse_sheet(wb[name]).items():
            chosen[year] = (name, spec)  # 後のシートが前を上書き（2015年）
    missing = sorted(set(EXPECTED_YEARS) - set(chosen))
    extra = sorted(set(chosen) - set(EXPECTED_YEARS))
    if missing or extra:
        raise ParseError(f"年の集合が想定と異なる: missing={missing} extra={extra}")
    return [_build(n, y, *spec[:4]) for y, (n, spec) in sorted(chosen.items())]
