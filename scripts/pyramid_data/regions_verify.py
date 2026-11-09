"""地域別データ（regions.json）の表の形の判定と検証。FAIL が1件でもあればビルドは失敗。"""
from __future__ import annotations

import math
from fractions import Fraction

from .parse_census_ts import AGE_GROUPS, N, TS_YEARS, YEARS

TOTAL_2025 = 122972528  # 令和7年国勢調査 全国の総数（人）
SHARE_TOL = 0.0001
OKINAWA = "47"


# ---------------------------------------------------------------- 表の形（決め打ちの期待値）

def expected_shape(code, year):
    """docs/REGIONS.md §1 の脚注どおりの (openIndex, missing)。"""
    if code == OKINAWA and year == 1945:
        return 17, True
    if code == OKINAWA and year in (1950, 1955):
        return 14, False
    if year in (1920, 1930, 1935, 1950):
        return 16, False
    return 17, False


def detect_open_index(raw):
    """表の値の形から上位区分を判定する。

    「-」・空欄（None）が上の段から連続していて、その下の段に値があれば、その段が「…歳以上」。
    総数もなく全段が None なら None（データなし）を返す。判定できなければ ValueError。
    """
    if raw["total"] is None and all(v is None for s in ("male", "female") for v in raw[s]):
        return None
    if raw["total"] is None or raw["totalMale"] is None or raw["totalFemale"] is None:
        raise ValueError("総数がありません")
    found = set()
    for sex in ("male", "female"):
        arr = raw[sex]
        k = N - 1
        while k >= 0 and arr[k] is None:
            k -= 1
        if k < 0 or any(v is None for v in arr[:k + 1]):
            raise ValueError(f"{sex} の「-」の並びが想定外")
        found.add(k)
    if len(found) != 1:
        raise ValueError("男女で上位区分が異なります")
    k = found.pop()
    if k not in (14, 16, 17):
        raise ValueError(f"上位区分が想定外の段 {AGE_GROUPS[k]}")
    return k


def detect_shapes(ts3):
    """{(code, year): {"openIndex", "missing", "detectedOpenIndex", "detectedMissing", "error"}}。

    データの組み立てには期待値（expected_shape）を使い、判定値との食い違いは verify で FAIL にする。
    """
    out = {}
    for code, a in ts3.items():
        for y in TS_YEARS:
            raw = a["years"][y]
            oi, miss = expected_shape(code, y)
            rec = {"openIndex": oi, "missing": miss, "detectedOpenIndex": None, "detectedMissing": None, "error": None}
            try:
                d = detect_open_index(raw)
                rec["detectedMissing"] = d is None
                rec["detectedOpenIndex"] = d
            except ValueError as e:
                rec["error"] = str(e)
            # 上位区分の行ラベルが「（80歳以上）」「（70歳以上）」を含むこと
            if not miss and oi < 17 and f"({oi * 5}歳以上)" not in (raw["labels"][oi] or ""):
                rec["error"] = f"{AGE_GROUPS[oi]} の行ラベル {raw['labels'][oi]!r} に「{oi * 5}歳以上」がありません"
            out[(code, y)] = rec
    return out


# ---------------------------------------------------------------- 割合

def denom(e):
    return e["total"] - e["unknown"]["male"] - e["unknown"]["female"]


def max_share(series):
    """全 series・全年・男女の「段の値 / 分母」の最大（Fraction）と、その場所。"""
    best, at = Fraction(0), None
    for aid, ys in series.items():
        for y, e in ys.items():
            if e["missing"]:
                continue
            d = denom(e)
            for sex in ("male", "female"):
                for i, v in enumerate(e[sex]):
                    if v is None:
                        continue
                    s = Fraction(v, d)
                    if s > best:
                        best, at = s, {"area": aid, "year": int(y), "group": AGE_GROUPS[i], "groupIndex": i,
                                       "isOpen": i == e["openIndex"], "sex": sex}
    return best, at


def ceil_step(x, denom_steps=200):
    """x を 1/denom_steps 単位で切り上げた float（0.005 単位なら 200）。"""
    k = math.ceil(Fraction(x) * denom_steps)
    return round(k / denom_steps, 6)


# ---------------------------------------------------------------- 全国表との照合で、理由の分かっている差

# 差 = 47都道府県の合計 − census_ts2（全国）。段は全国 series の openIndex にそろえた添字
KNOWN_TS2_DIFFS = {
    1925: {
        "diff": {"male": {"groups": {}, "total": 0}, "female": {"groups": {16: -50}, "total": 0}},
        "reason": "第3表の広島県1925年「80～84歳」の女が 4,534 人で、同じ行の総数 7,648 − 男 3,064 = 4,584 人より 50 人少ない。"
                  "第3表の女の値の誤記とみられる。総数（女）は全国表と一致するので、この 50 人は広島県の女の年齢不詳として扱われる。",
    },
    1950: {
        "diff": {
            "male": {"groups": {0: -400, 1: -513, 2: -516, 3: -508, 4: -437, 5: -357, 6: -265, 7: -298, 8: -258,
                                9: -226, 10: -166, 11: -117, 12: -78, 13: -63}, "total": -4257},
            "female": {"groups": {0: -389, 1: -449, 2: -569, 3: -479, 4: -376, 5: -308, 6: -299, 7: -250, 8: -191,
                                  9: -155, 10: -86, 11: -80, 12: -60, 13: -54}, "total": -3826},
        },
        "reason": "全国表は1950年の沖縄県の外国人を含むとみられる（第2表脚注5：70歳以上の各段から沖縄県の70歳以上の外国人136人"
                  "〈男55人、女81人〉を除く）。都道府県の合計は全国表より男 4,257 人・女 3,826 人少なく、"
                  "差のうち男55・女81は各段ではなく不詳の差で、70歳以上の外国人が全国表では総数にだけ入っているとみられる。70歳以上（全国は70歳以上で一括）は一致する。",
    },
    1955: {
        "diff": {"male": {"groups": {14: 8090}, "total": 0}, "female": {"groups": {14: 15238}, "total": 0}},
        "reason": "全国表は1955年の70歳以上の各段から沖縄県を除く（第2表脚注6：沖縄県の70歳以上は男8,090人、女15,238人）。"
                  "都道府県の合計は沖縄県の70歳以上を含むので、70歳以上（全国は70歳以上で一括）がちょうどその人数だけ多い。",
    },
}

KNOWN_ROW_ANOMALIES = {("34", 1925, 16): ("広島県1925年「80～84歳（80歳以上）」の行で、総数列 7,648 が 男 3,064 + 女 4,534 = 7,598 と 50 人合わない。"
                                         "男・女の列を使う（全国表との照合でも女が 50 人少ない差として現れる）。")}


# ---------------------------------------------------------------- 検証本体

class Report:
    def __init__(self):
        self.findings, self.checks = [], []

    def add(self, level, check, message, **kw):
        f = {"level": level, "check": check}
        f.update({k: v for k, v in kw.items() if v is not None})
        f["message"] = message
        self.findings.append(f)

    def ran(self, name):
        self.checks.append(name)

    def count(self, level):
        return sum(1 for f in self.findings if f["level"] == level)


def check_shapes(rep, ts3, shapes):
    rep.ran("shapes")
    for (code, y), s in sorted(shapes.items()):
        name = ts3[code]["name"]
        if s["error"]:
            rep.add("FAIL", "shapes", f"{name}: {s['error']}", area=code, year=y)
            continue
        if s["missing"] and not s["detectedMissing"]:
            if (code, y) == (OKINAWA, 1945):
                raw = ts3[code]["years"][y]
                rep.add("WARN", "shapes",
                        f"沖縄県1945年は表に値がある（総数 {raw['total']:,} 人）が、契約どおり missing として扱う。"
                        "表の脚注4によればこの値は「沖縄群島要覧 1950年版」（12月末日現在）によるもので、"
                        "調査日・出典が他県と異なり、「参考」シートでは最上位の区分も86～90歳（以上ではない）。"
                        "全国表（第2表）も1945年は沖縄県を除く。", area=code, year=y)
                continue
            rep.add("FAIL", "shapes", f"{name}: データなしのはずが値がある", area=code, year=y)
            continue
        if s["missing"]:
            continue
        if s["detectedMissing"]:
            rep.add("FAIL", "shapes", f"{name}: 値があるはずがデータなし", area=code, year=y)
        elif s["detectedOpenIndex"] != s["openIndex"]:
            rep.add("FAIL", "shapes", f"{name}: 上位区分が表では {AGE_GROUPS[s['detectedOpenIndex']]}、"
                                      f"期待は {AGE_GROUPS[s['openIndex']]}", area=code, year=y)


def check_kazoe(rep, kazoe, doc):
    rep.ran("kazoe-1945")
    m = doc["yearMeta"]["1945"]
    ok = kazoe["nonOkinawa"]["kazoe"] and kazoe["nonOkinawa"]["first"] == "1~5歳" and m["kazoe"] and m["refDate"] == "1945-11-01"
    if not ok:
        rep.add("FAIL", "kazoe-1945", f"1945年の年齢区分が想定（数え年、0～4歳=1～5歳）と異なる: {kazoe}", year=1945)


def check_row_anomalies(rep, anomalies):
    rep.ran("row-anomalies")
    for a in anomalies:
        key = (a["area"], a["year"], a["group"])
        msg = KNOWN_ROW_ANOMALIES.get(key)
        if msg and a["both"] - a["male"] - a["female"] == 50:
            rep.add("WARN", "row-anomalies", msg, area=a["area"], year=a["year"])
        else:
            rep.add("FAIL", "row-anomalies", f"{a['label']} の行で 総数 {a['both']} ≠ 男 {a['male']} + 女 {a['female']}",
                    area=a["area"], year=a["year"])


def check_pref_sums(rep, doc, ts3, c2025):
    """都道府県×年ごとに、各段の合計 + 不詳 = 総数（人単位で完全一致）。"""
    rep.ran("pref-sums")
    for a in doc["areas"]:
        code = a["code"]
        for y in YEARS:
            e = doc["series"][code][str(y)]
            if e["missing"]:
                continue
            if y == 2025:
                src = c2025[code]
            else:
                src = ts3[code]["years"][y]
            tm, tf, tt = src["totalMale"], src["totalFemale"], src["total"]
            sm = sum(v for v in e["male"] if v is not None)
            sf = sum(v for v in e["female"] if v is not None)
            um, uf = e["unknown"]["male"], e["unknown"]["female"]
            problems = []
            if sm + um != tm:
                problems.append(f"男 {sm}+{um}≠{tm}")
            if sf + uf != tf:
                problems.append(f"女 {sf}+{uf}≠{tf}")
            if e["total"] != tt or tt != tm + tf:
                problems.append(f"総数 {e['total']} / 表 {tt} / 男+女 {tm + tf}")
            if um < 0 or uf < 0:
                problems.append(f"不詳が負 {um},{uf}")
            if problems:
                rep.add("FAIL", "pref-sums", "; ".join(problems), area=code, year=y)
            elif y in (2015, 2020) and (um or uf):
                rep.add("FAIL", "pref-sums", f"不詳補完値の年なのに不詳が {um}+{uf}", area=code, year=y)


def check_total_2025(rep, doc):
    rep.ran("total-2025")
    s = sum(doc["series"][a["code"]]["2025"]["total"] for a in doc["areas"])
    if s != TOTAL_2025 or doc["series"]["national"]["2025"]["total"] != TOTAL_2025:
        rep.add("FAIL", "total-2025", f"2025年の47都道府県の総数の合計 {s:,} が {TOTAL_2025:,} と不一致", year=2025)
    return s


def _collapse(arr, oi):
    return list(arr[:oi]) + [sum(v or 0 for v in arr[oi:])]


def ts2_diffs(doc, ts2):
    """年ごとに {sex: {"groups": {i: d}, "total": d}}（差 = 都道府県の合計 − 全国表）。"""
    out = {}
    for y in TS_YEARS:
        nat = doc["series"]["national"][str(y)]
        oi = nat["openIndex"]
        d = {}
        for sex in ("male", "female"):
            ours = _collapse(nat[sex], oi)
            theirs = _collapse(ts2[y][sex], oi)
            groups = {i: a - b for i, (a, b) in enumerate(zip(ours, theirs)) if a != b}
            tot_ours = sum(v for v in nat[sex] if v is not None) + nat["unknown"][sex]
            d[sex] = {"groups": groups, "total": tot_ours - ts2[y]["total" + sex.title()]}
        out[y] = d
    return out


def check_ts2(rep, doc, ts2):
    rep.ran("national-vs-ts2")
    diffs = ts2_diffs(doc, ts2)
    listed = []
    for y, d in diffs.items():
        clean = all(not d[s]["groups"] and not d[s]["total"] for s in d)
        known = KNOWN_TS2_DIFFS.get(y)
        if clean and not known:
            continue
        brief = {s: {"groups": {AGE_GROUPS[i]: v for i, v in d[s]["groups"].items()}, "total": d[s]["total"]} for s in d}
        listed.append({"year": y, "diff": brief, "openIndex": doc["series"]["national"][str(y)]["openIndex"]})
        if known and d == known["diff"]:
            listed[-1]["reason"] = known["reason"]
            rep.add("WARN", "national-vs-ts2", f"全国表と差がある（理由あり）: {brief}。{known['reason']}", year=y)
        else:
            rep.add("FAIL", "national-vs-ts2", f"全国表との差の理由が不明: {brief}", year=y)
    return listed


def check_blocks(rep, doc):
    """ブロックと national が構成都道府県の合計と一致するか（組み立てとは別の書き方で再計算）。"""
    rep.ran("blocks")
    groups = [(b["id"], b["prefs"]) for b in doc["blocks"]] + [("national", [a["code"] for a in doc["areas"]])]
    for gid, prefs in groups:
        for y in YEARS:
            e = doc["series"][gid][str(y)]
            live = [doc["series"][p][str(y)] for p in prefs if not doc["series"][p][str(y)]["missing"]]
            oi = min(p["openIndex"] for p in live)
            problems = []
            if e["openIndex"] != oi or e["missing"]:
                problems.append(f"openIndex {e['openIndex']}≠{oi}")
            for sex in ("male", "female"):
                for i in range(N):
                    if i < oi:
                        want = sum(p[sex][i] for p in live)
                    elif i == oi:
                        want = sum(v for p in live for v in p[sex][oi:] if v is not None)
                    else:
                        want = None
                    if e[sex][i] != want:
                        problems.append(f"{sex}[{i}] {e[sex][i]}≠{want}")
                        break
                if e["unknown"][sex] != sum(p["unknown"][sex] for p in live):
                    problems.append(f"unknown.{sex}")
            if e["total"] != sum(p["total"] for p in live):
                problems.append("total")
            if problems:
                rep.add("FAIL", "blocks", "; ".join(problems), area=gid, year=y)
    # 8ブロックで47都道府県をちょうど1回ずつ覆う
    covered = sorted(p for b in doc["blocks"] for p in b["prefs"])
    if covered != sorted(a["code"] for a in doc["areas"]):
        rep.add("FAIL", "blocks", "ブロックが47都道府県をちょうど1回ずつ覆っていない")
    for a in doc["areas"]:
        if a["code"] not in next(b["prefs"] for b in doc["blocks"] if b["id"] == a["block"]):
            rep.add("FAIL", "blocks", "areas の block と blocks の prefs が食い違い", area=a["code"])


def check_entries(rep, doc):
    """null の並び・割合の合計（1±0.0001）・missing の形。"""
    rep.ran("entries")
    for aid, ys in doc["series"].items():
        if list(ys) != [str(y) for y in YEARS]:
            rep.add("FAIL", "entries", "年がそろっていない", area=aid)
            continue
        for y, e in ys.items():
            if e["missing"]:
                if any(v is not None for s in ("male", "female") for v in e[s]) or e["total"] != 0:
                    rep.add("FAIL", "entries", "missing なのに値がある", area=aid, year=int(y))
                if not (aid == OKINAWA and y == "1945"):
                    rep.add("FAIL", "entries", "想定外の missing", area=aid, year=int(y))
                continue
            oi = e["openIndex"]
            bad = [i for s in ("male", "female") for i, v in enumerate(e[s])
                   if (v is None) != (i > oi) or (v is not None and (not isinstance(v, int) or v < 0))]
            if bad:
                rep.add("FAIL", "entries", f"段 {sorted(set(bad))} の値か null が不正", area=aid, year=int(y))
                continue
            d = denom(e)
            if d <= 0:
                rep.add("FAIL", "entries", f"分母が {d}", area=aid, year=int(y))
                continue
            share = sum(v for s in ("male", "female") for v in e[s] if v is not None) / d
            if abs(share - 1) > SHARE_TOL:
                rep.add("FAIL", "entries", f"割合の合計 {share}", area=aid, year=int(y))


def check_structure(rep, doc):
    rep.ran("structure")
    want_keys = ["national"] + [a["code"] for a in doc["areas"]] + [b["id"] for b in doc["blocks"]]
    if list(doc["series"]) != want_keys or len(want_keys) != 56:
        rep.add("FAIL", "structure", "series のキーが想定（national、01〜47、8ブロック）と異なる")
    if [a["code"] for a in doc["areas"]] != [f"{i:02d}" for i in range(1, 48)]:
        rep.add("FAIL", "structure", "areas がコード順の47件でない")
    tiles = [(a["tile"]["x"], a["tile"]["y"]) for a in doc["areas"]]
    if len(set(tiles)) != 47 or any(not (0 <= x < 13 and 0 <= y < 10) for x, y in tiles):
        rep.add("FAIL", "structure", "都道府県タイルが重複しているか 13×10 の外")
    btiles = [(b["tile"]["x"], b["tile"]["y"]) for b in doc["blocks"]]
    if len(set(btiles)) != 8 or any(not (0 <= x < 4 and 0 <= y < 4) for x, y in btiles):
        rep.add("FAIL", "structure", "ブロックタイルが重複しているか 4×4 の外")
    if doc["years"] != YEARS or doc["ageGroups"] != AGE_GROUPS:
        rep.add("FAIL", "structure", "years / ageGroups が想定外")
    for y in YEARS:
        ids = doc["yearMeta"][str(y)]["noteIds"]
        for nid in ids:
            if not any(a <= y <= b for a, b in doc["notes"][nid]["appliesTo"]):
                rep.add("FAIL", "structure", f"noteIds の {nid} が appliesTo と合わない", year=y)
        kinds = [doc["notes"][n]["kind"] for n in ids]
        if kinds != sorted(kinds):  # badge < footnote
            rep.add("FAIL", "structure", "noteIds が badge → footnote の順でない", year=y)


def check_xmax(rep, doc):
    rep.ran("xmax")
    best, at = max_share(doc["series"])
    want = ceil_step(best)
    if doc["xMaxShare"] != want or not (best <= doc["xMaxShare"] < best + Fraction(1, 200)):
        rep.add("FAIL", "xmax", f"xMaxShare {doc['xMaxShare']} が最大の割合 {float(best)} の 0.005 切り上げ {want} と不一致")
    return best, at


def check_schema(rep, doc, schema):
    rep.ran("schema")
    try:
        import jsonschema
    except ImportError:
        rep.add("FAIL", "schema", "jsonschema が import できません")
        return
    errs = sorted(jsonschema.Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.absolute_path))
    for e in errs[:20]:
        rep.add("FAIL", "schema", f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message}")


def verify(doc, ts3, shapes, anomalies, kazoe, ts2, schema, c2025):
    rep = Report()
    check_structure(rep, doc)
    check_shapes(rep, ts3, shapes)
    check_kazoe(rep, kazoe, doc)
    check_row_anomalies(rep, anomalies)
    check_pref_sums(rep, doc, ts3, c2025)
    total2025 = check_total_2025(rep, doc)
    listed = check_ts2(rep, doc, ts2)
    check_blocks(rep, doc)
    check_entries(rep, doc)
    best, at = check_xmax(rep, doc)
    check_schema(rep, doc, schema)
    nat = doc["series"]["national"]
    fails, warns = rep.count("FAIL"), rep.count("WARN")
    return {
        "result": "FAIL" if fails else ("WARN" if warns else "PASS"),
        "counts": {"FAIL": fails, "WARN": warns},
        "checks": rep.checks,
        "stats": {
            "xMaxShare": doc["xMaxShare"],
            "maxShare": round(float(best), 6),
            "maxShareAt": at,
            "total2025": total2025,
            "nationalTotals": {y: nat[y]["total"] for y in nat},
            "nationalOpenIndex": {y: nat[y]["openIndex"] for y in nat},
            "ts2Diffs": listed,
        },
        "findings": rep.findings,
    }
