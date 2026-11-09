"""地域別（5歳階級）の入力表のパーサ。

- census_ts3: 国勢調査 時系列データ 第3表（都道府県、1920〜2020年）
- census_ts2: 同 第2表（全国）。照合にだけ使う
- census2025: 令和7年国勢調査【不詳補完値】第2-1表の都道府県の行

戻り値の段（groups）は長さ18の list。値は int か None（「-」・空欄）。
"""
from __future__ import annotations

import re

import openpyxl

from .common import ParseError, norm, num

AGE_GROUPS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49",
              "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84", "85+"]
N = len(AGE_GROUPS)
YEARS = list(range(1920, 2026, 5))
TS_YEARS = [y for y in YEARS if y <= 2020]

TS3_SHEET = "da03"
TS2_SHEET = "da02"
CENSUS2025_SHEET = "wb02_01"

# census_ts3 の行ラベル（NFKC・空白除去後）→ 段の添字。「80～84歳（80歳以上）」も 16。
_GROUP_RE = re.compile(r"(\d+)[~～〜](\d+)歳(?:\((\d+)歳以上\))?")


def _group_index(label):
    """'0～4歳' → 0、'85歳以上' → 17、'総数' → 'total'、再掲や不明は None。"""
    s = norm(label)
    if s == "総数":
        return "total"
    if s == "85歳以上":
        return 17
    m = _GROUP_RE.fullmatch(s)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    if hi != lo + 4 or lo % 5 or lo > 80:
        return None
    return lo // 5


def _rows(path, sheet):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if sheet not in wb.sheetnames:
        raise ParseError(f"シート {sheet!r} がありません（{path}）")
    return [list(r) for r in wb[sheet].iter_rows(values_only=True)]


def _cell(r, c):
    return r[c] if c < len(r) else None


# ---------------------------------------------------------------- census_ts3

def ts3_year_columns(header):
    """年見出しの行から {年: 総数の列} を返す。2015・2020年は後ろに出る方（不詳補完値）。

    年ごとの7列は 総数・男・女・割合×3・性比。
    """
    seen = {}
    for c, v in enumerate(header):
        m = re.fullmatch(r"(\d{4})年", norm(v))
        if m:
            seen.setdefault(int(m.group(1)), []).append(c)
    cols = {}
    for y in TS_YEARS:
        cs = seen.get(y, [])
        want = 2 if y in (2015, 2020) else 1
        if len(cs) != want:
            raise ParseError(f"census_ts3: {y}年の見出しが {len(cs)} 個（{want} 個のはず）")
        cols[y] = cs[-1]
    extra = sorted(set(seen) - set(TS_YEARS))
    if extra:
        raise ParseError(f"census_ts3: 想定外の年見出し {extra}")
    return cols


def parse_ts3(path):
    """({pref_code: {"name": str, "years": {year: raw}}}, anomalies) を返す。

    anomalies は、段の行で 総数 ≠ 男 + 女 だった箇所（男・女の列を正とする）。

    raw = {"male": [18], "female": [18], "total": int|None, "totalMale": int|None,
           "totalFemale": int|None, "labels": [18 個の行ラベル]}
    """
    rows = _rows(path, TS3_SHEET)
    hi = next((i for i, r in enumerate(rows) if norm(_cell(r, 0)) == "地域" and norm(_cell(r, 1)).startswith("年齢")), None)
    if hi is None:
        raise ParseError("census_ts3: 見出し行（地域・年齢）がありません")
    cols = ts3_year_columns(rows[hi])
    # 総数・男・女の単位が「人」であることを見出しで確かめる
    for y, c in cols.items():
        sub = [norm(_cell(rows[hi + 2], c + k)) for k in range(3)]
        if sub != ["総数", "男", "女"]:
            raise ParseError(f"census_ts3: {y}年の列見出しが想定外 {sub}")
    if 2015 in cols and norm(_cell(rows[hi + 3], cols[2015])) != "※":
        raise ParseError("census_ts3: 2015年の後ろの列に不詳補完値の印（※）がありません")

    out, anomalies = {}, []
    for r in rows[hi + 1:]:
        area = norm(_cell(r, 0))
        m = re.fullmatch(r"(\d{2})000_(.+)", area)
        if not m:
            continue
        code, name = m.group(1), m.group(2)
        idx = _group_index(_cell(r, 1))
        if idx is None:
            continue
        a = out.setdefault(code, {"name": name, "years": {}, "_seen": set()})
        if a["name"] != name:
            raise ParseError(f"census_ts3: {code} の地域名が一定でない")
        if idx in a["_seen"]:
            raise ParseError(f"census_ts3: {code} の行 {_cell(r, 1)!r} が重複")
        a["_seen"].add(idx)
        for y, c in cols.items():
            raw = a["years"].setdefault(y, {"male": [None] * N, "female": [None] * N, "total": None,
                                             "totalMale": None, "totalFemale": None, "labels": [None] * N})
            both, male, female = (num(_cell(r, c + k)) for k in range(3))
            if idx == "total":
                raw["total"], raw["totalMale"], raw["totalFemale"] = both, male, female
            else:
                raw["male"][idx], raw["female"][idx] = male, female
                raw["labels"][idx] = norm(_cell(r, 1))
                if both is not None and male is not None and female is not None and both != male + female:
                    # 表の「総数」列の誤り。男・女の列を使い、レポートに残す
                    anomalies.append({"area": code, "year": y, "group": idx, "label": norm(_cell(r, 1)),
                                      "both": both, "male": male, "female": female})
    for code, a in out.items():
        if a.pop("_seen") != set(range(N)) | {"total"}:
            raise ParseError(f"census_ts3: {code} の年齢区分の行がそろっていません")
    codes = sorted(out)
    if codes != [f"{i:02d}" for i in range(1, 48)]:
        raise ParseError(f"census_ts3: 都道府県が47件そろっていません: {codes}")
    return out, anomalies


# ---------------------------------------------------------------- census_ts2

def parse_ts2(path):
    """{year: {"male": [18], "female": [18], "totalMale", "totalFemale", "total"}}。

    2015・2020年は不詳補完値（※の付いた方）を使う。85歳以上は 85〜89歳以降の行も合算する。
    """
    rows = _rows(path, TS2_SHEET)
    hi = next((i for i, r in enumerate(rows) if norm(_cell(r, 0)).startswith("年次")), None)
    if hi is None:
        raise ParseError("census_ts2: 見出し行がありません")
    if [norm(_cell(rows[hi + 1], c)) for c in (4, 5, 6)] != ["総数", "男", "女"]:
        raise ParseError("census_ts2: 総数・男・女の列見出しが想定外")
    # 年ごとのブロック（総数の行から次の総数の行まで）を集める
    blocks = []
    for r in rows[hi + 1:]:
        m = re.fullmatch(r"(\d{4})年", norm(_cell(r, 0)))
        if not m:
            continue
        y = int(m.group(1))
        if norm(_cell(r, 2)) == "総数":
            blocks.append({"year": y, "rows": []})
        if not blocks or blocks[-1]["year"] != y:
            raise ParseError(f"census_ts2: {y}年の行の並びが想定外")
        blocks[-1]["rows"].append(r)
    out = {}
    for b in blocks:
        y = b["year"]
        imputed = any(norm(_cell(r, 3)) == "※" for r in b["rows"])
        if y in (2015, 2020) and not imputed:
            continue  # 原数値の方は使わない
        if y in out:
            raise ParseError(f"census_ts2: {y}年が重複")
        d = {"male": [0] * N, "female": [0] * N, "seen": set()}
        for r in b["rows"]:
            lab = norm(_cell(r, 2))
            both, male, female = (num(_cell(r, c)) for c in (4, 5, 6))
            if lab == "総数":
                d["total"], d["totalMale"], d["totalFemale"] = both, male, female
                continue
            if lab.startswith("(再掲)"):
                continue
            idx = _group_index(lab)
            if idx is None:
                m = re.fullmatch(r"(\d+)(?:[~～〜](\d+))?歳(以上)?", lab)
                if not m or int(m.group(1)) < 85:
                    raise ParseError(f"census_ts2: {y}年の年齢区分 {lab!r} が想定外")
                idx = 17
            if male is None or female is None:
                raise ParseError(f"census_ts2: {y}年 {lab} に値がありません")
            d["male"][idx] += male
            d["female"][idx] += female
            d["seen"].add(idx)
        if d.pop("seen") != set(range(N)):
            raise ParseError(f"census_ts2: {y}年の年齢区分がそろっていません")
        out[y] = d
    if sorted(out) != TS_YEARS:
        raise ParseError(f"census_ts2: 年がそろっていません: {sorted(out)}")
    return out


# ---------------------------------------------------------------- census2025

def parse_census2025_prefs(path):
    """{pref_code: {"name", "male": [18], "female": [18], "unknownMale", "unknownFemale",
    "totalMale", "totalFemale", "total"}}（国籍総数）。"""
    rows = _rows(path, CENSUS2025_SHEET)
    hi = next((i for i, r in enumerate(rows) if len(r) > 3 and r[3] == "項目名"), None)
    if hi is None:
        raise ParseError("census2025: 項目名の行がありません")
    cols = {}
    for c, v in enumerate(rows[hi]):
        if isinstance(v, str) and re.match(r"\d{3}_", v):
            cols.setdefault(int(v[:3]), (c, v))
    if cols.get(0, (0, ""))[1] != "000_総数" or 112 not in cols or "不詳" not in cols[112][1]:
        raise ParseError("census2025: 総数 / 不詳の列が見つかりません")
    for code in range(1, 112):
        lab = cols.get(code, (0, ""))[1]
        m = re.fullmatch(rf"{code:03d}_(\d+)歳(以上)?", lab)
        if not m or int(m.group(1)) != code - 1 or (code == 111) != bool(m.group(2)):
            raise ParseError(f"census2025: 年齢列 {code} のラベルが想定外: {lab!r}")
    sexes = {"1_男": "male", "2_女": "female", "0_総数": "both"}
    data = {}
    for r in rows[hi + 1:]:
        m = re.fullmatch(r"(\d{2})000_(.+)", str(_cell(r, 3) or ""))
        if r[0] != "0_国籍総数" or not m or m.group(1) == "00" or r[1] not in sexes:
            continue
        key = (m.group(1), sexes[r[1]])
        if key in data:
            raise ParseError(f"census2025: 行が重複 {key}")
        data[key] = (m.group(2), r)

    def ints(r, codes):
        # この表の「-」は該当者なし（0人）。都道府県の高齢の各歳や不詳に現れる
        vs = [0 if r[cols[c][0]] == "-" else r[cols[c][0]] for c in codes]
        if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in vs):
            raise ParseError("census2025: 数値でないセルがあります")
        return vs

    out = {}
    for code in sorted({k[0] for k in data}):
        rec = {}
        for sex in ("male", "female", "both"):
            if (code, sex) not in data:
                raise ParseError(f"census2025: {code} の {sex} の行がありません")
            name, r = data[(code, sex)]
            rec["name"] = name
            ages = ints(r, range(1, 112))  # 0歳〜110歳以上
            groups = [sum(ages[g * 5:g * 5 + 5]) for g in range(17)] + [sum(ages[85:])]
            tot, unk = ints(r, (0, 112))
            rec[sex] = (groups, tot, unk)
        (m, tm, um), (f, tf, uf), (_b, tb, _ub) = rec["male"], rec["female"], rec["both"]
        out[code] = {"name": rec["name"], "male": m, "female": f, "unknownMale": um, "unknownFemale": uf,
                     "totalMale": tm, "totalFemale": tf, "total": tb}
    if sorted(out) != [f"{i:02d}" for i in range(1, 48)]:
        raise ParseError(f"census2025: 都道府県が47件そろっていません: {sorted(out)}")
    return out


# ---------------------------------------------------------------- census_ts3「参考」シート

def parse_ts3_kazoe(path):
    """「参考」シート（1945年の年齢区分）から、1945年の「0～4歳」「85歳以上」の行の中身を読む。

    {"nonOkinawa": {"first": "1~5歳", "top": "86歳以上", "kazoe": bool}, "okinawa": {...}}
    """
    rows = _rows(path, "参考")
    hi = next((i for i, r in enumerate(rows) if norm(_cell(r, 0)).startswith("年齢")), None)
    if hi is None:
        raise ParseError("census_ts3 参考: 見出し行がありません")
    head = [norm(v) for v in rows[hi]]
    c_non = next((c for c, v in enumerate(head) if "沖縄県以外" in v), None)
    c_oki = next((c for c, v in enumerate(head) if v.startswith("昭和20年") and "沖縄県以外" not in v and "沖縄県" in v), None)
    if c_non is None or c_oki is None:
        raise ParseError("census_ts3 参考: 1945年の列がありません")
    kazoe_mark = "※" in head[c_non]
    kazoe_note = any("数え年" in norm(_cell(r, 0)) or "数え年" in norm(_cell(r, 1)) for r in rows[hi:])
    by_label = {norm(_cell(r, 0)): r for r in rows[hi + 1:] if _cell(r, 0)}
    if "0~4歳" not in by_label or "85歳以上" not in by_label:
        raise ParseError("census_ts3 参考: 0～4歳・85歳以上の行がありません")

    def col(c):
        return {"first": norm(_cell(by_label["0~4歳"], c)) + ("歳" if not norm(_cell(by_label["0~4歳"], c)).endswith("歳") else ""),
                "top": norm(_cell(by_label["85歳以上"], c))}
    return {"nonOkinawa": dict(col(c_non), kazoe=kazoe_mark and kazoe_note), "okinawa": col(c_oki)}
