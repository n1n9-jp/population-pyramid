#!/usr/bin/env python3
"""都道府県・地方ブロック別の人口ピラミッド（5歳階級、1920〜2025年の5年ごと）を構築する。

出力: data/regions.json、data/regions_by_age.csv、data/regions_build_report.json
終了コード: 0=合格, 1=検証FAIL, 2=取得失敗
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)  # python3 -I でも scripts/ 配下を import できるように

from pyramid_data import common, fetch, parse_census_ts, regions_verify  # noqa: E402
from pyramid_data.parse_census_ts import AGE_GROUPS, N, YEARS  # noqa: E402

E_STAT = fetch.E_STAT
TS_TITLE = "国勢調査 時系列データ 男女，年齢，配偶関係"
REGION_SOURCES = {
    "census_ts3": {
        "file": "census_ts3.xlsx", "url": E_STAT.format("000001085927", 0), "title": TS_TITLE,
        "table": "第3表 年齢（5歳階級），男女別人口及び人口性比 － 都道府県（大正9年～令和2年）",
    },
    "census_ts2": {
        "file": "census_ts2.xlsx", "url": E_STAT.format("000001085926", 0), "title": TS_TITLE,
        "table": "第2表 年齢（5歳階級），男女別人口及び人口性比 － 全国（大正9年～令和2年）",
    },
    "census2025": {
        "file": fetch.SOURCES["census2025"]["file"], "url": fetch.SOURCES["census2025"]["url"],
        "title": fetch.SOURCES["census2025"]["title"],
        "table": "第2－1表 男女，年齢（各歳），国籍総数か日本人別人口，平均年齢及び年齢中位数－全国，都道府県，21大都市，特別区，人口50万以上の市",
    },
}
# 全国版（scripts/pyramid_data/fetch.py）が管理するロックのキー。ここからは書き換えない
SHARED_LOCK_KEYS = set(fetch.SOURCES)

ATTRIBUTION = "出典：総務省統計局「国勢調査」（e-Stat）を加工して作成"
X_STEP_DENOM = 200  # 0.005 単位

BLOCKS = [  # id, name, 都道府県コードの範囲, tile
    ("hokkaido", "北海道", (1, 1), (3, 0)),
    ("tohoku", "東北", (2, 7), (3, 1)),
    ("kanto", "関東", (8, 14), (3, 2)),
    ("chubu", "中部", (15, 23), (2, 1)),
    ("kinki", "近畿", (24, 30), (1, 2)),
    ("chugoku", "中国", (31, 35), (0, 2)),
    ("shikoku", "四国", (36, 39), (1, 3)),
    ("kyushu", "九州・沖縄", (40, 47), (0, 3)),
]
TILES = {  # short → (x, y)
    "北海道": (12, 0), "青森": (11, 1), "秋田": (10, 2), "岩手": (11, 2),
    "石川": (8, 3), "山形": (10, 3), "宮城": (11, 3),
    "島根": (3, 4), "鳥取": (4, 4), "福井": (7, 4), "富山": (8, 4), "新潟": (9, 4), "福島": (11, 4),
    "長崎": (0, 5), "佐賀": (1, 5), "山口": (2, 5), "広島": (3, 5), "岡山": (4, 5), "兵庫": (5, 5),
    "京都": (6, 5), "滋賀": (7, 5), "岐阜": (8, 5), "長野": (9, 5), "群馬": (10, 5), "栃木": (11, 5), "茨城": (12, 5),
    "福岡": (1, 6), "大分": (2, 6), "愛媛": (3, 6), "香川": (4, 6), "大阪": (5, 6), "奈良": (6, 6),
    "三重": (7, 6), "愛知": (8, 6), "山梨": (9, 6), "埼玉": (10, 6), "東京": (11, 6), "千葉": (12, 6),
    "熊本": (1, 7), "宮崎": (2, 7), "高知": (3, 7), "徳島": (4, 7), "和歌山": (6, 7), "静岡": (8, 7), "神奈川": (11, 7),
    "鹿児島": (1, 8), "沖縄": (0, 9),
}

NOTES = {  # 表の順。文言は docs/REGIONS.md §2 のとおり
    "open-80": {"kind": "badge", "short": "80歳以上を一括",
                "text": "1920・1930・1935・1950年は、80歳以上の人口をまとめて「80〜84」の段に表示しています。",
                "appliesTo": [[1920, 1920], [1930, 1935], [1950, 1950]]},
    "okinawa-70": {"kind": "footnote", "short": "沖縄県は70歳以上を一括",
                   "text": "沖縄県の1950・1955年は、70歳以上の人口をまとめて「70〜74」の段に表示しています。九州・沖縄ブロックと全国は、この年、70歳以上をまとめた形で集計しています。",
                   "appliesTo": [[1950, 1955]]},
    "kazoe-1945": {"kind": "badge", "short": "数え年",
                   "text": "1945年は人口調査（11月1日現在）によるもので、年齢は数え年です（「0〜4」の段は数え年1〜5歳）。",
                   "appliesTo": [[1945, 1945]]},
    "okinawa-missing-1945": {"kind": "footnote", "short": "沖縄県のデータなし",
                             "text": "1945年は沖縄県のデータがありません。九州・沖縄ブロックと全国は沖縄県を除いて集計しています。",
                             "appliesTo": [[1945, 1945]]},
    "unknown-excluded": {"kind": "footnote", "short": "年齢不詳を除く割合",
                         "text": "割合は年齢不詳を除いて計算しています。2015・2020・2025年は不詳補完値を使っています。",
                         "appliesTo": [[1920, 2025]]},
}


# ---------------------------------------------------------------- 取得

def fetch_regions(raw_dir, lock_path, refresh=False, offline=False, today=None, log=print):
    """3ファイルを data/raw にそろえ、ロックに census_ts3・census_ts2 を追記して {sid: 記録} を返す。

    census2025 は全国版と共有のキー。既にあれば書き換えない。
    """
    os.makedirs(raw_dir, exist_ok=True)
    today = today or datetime.date.today().isoformat()
    lock = fetch.read_lock(lock_path)
    out = {}
    for sid, src in REGION_SOURCES.items():
        path = os.path.join(raw_dir, src["file"])
        if (refresh and not offline) or not os.path.exists(path):
            if offline:
                raise fetch.FetchError(f"--offline ですが {path} がありません")
            log(f"取得: {sid} <- {src['url']}")
            fetch._download(src["url"], path)
        with open(path, "rb") as f:
            if f.read(2) != b"PK":
                raise fetch.FetchError(f"{path} は xlsx ではありません（先頭2バイトが PK でない）")
        digest = fetch.sha256_of(path)
        prev = lock.get(sid, {})
        retrieved = prev.get("retrieved", today) if prev.get("sha256") == digest else today
        rec = {"file": src["file"], "url": src["url"], "sha256": digest, "retrieved": retrieved}
        if sid in SHARED_LOCK_KEYS and sid in lock:
            if prev.get("sha256") != digest:
                log(f"注意: {sid} の sha256 が sources.lock.json（全国版）と異なります。ロックは変更しません")
        else:
            lock[sid] = rec
        out[sid] = rec
    fetch.write_lock(lock_path, lock)
    return out


# ---------------------------------------------------------------- 組み立て

def short_name(name):
    if name == "北海道":
        return name
    for suf in ("都", "府", "県"):
        if name.endswith(suf):
            return name[:-1]
    raise common.ParseError(f"都道府県名 {name!r} の接尾辞が想定外")


def block_of(code):
    n = int(code)
    for bid, _name, (lo, hi), _t in BLOCKS:
        if lo <= n <= hi:
            return bid
    raise ValueError(code)


def note_ids_for(year):
    ids = [k for kind in ("badge", "footnote") for k, v in NOTES.items()
           if v["kind"] == kind and any(a <= year <= b for a, b in v["appliesTo"])]
    return ids


def year_meta(year):
    return {"refDate": "1945-11-01" if year == 1945 else f"{year}-10-01", "kazoe": year == 1945,
            "basis": "人口調査" if year == 1945 else "国勢調査", "noteIds": note_ids_for(year)}


def missing_entry():
    return {"male": [None] * N, "female": [None] * N, "unknown": {"male": 0, "female": 0},
            "total": 0, "openIndex": 17, "missing": True}


def pref_entry_ts3(raw, open_index):
    """表の値から1件を作る。open_index より上が None でないなら ValueError。"""
    male, female = list(raw["male"]), list(raw["female"])
    for arr in (male, female):
        for i, v in enumerate(arr):
            if (v is None) != (i > open_index):
                raise ValueError(f"段 {i} の null が上位区分 {open_index} と合いません")
    um = raw["totalMale"] - sum(male[:open_index + 1])
    uf = raw["totalFemale"] - sum(female[:open_index + 1])
    return {"male": male, "female": female, "unknown": {"male": um, "female": uf},
            "total": raw["total"], "openIndex": open_index, "missing": False}


def pref_entry_2025(rec):
    return {"male": list(rec["male"]), "female": list(rec["female"]),
            "unknown": {"male": rec["unknownMale"], "female": rec["unknownFemale"]},
            "total": rec["total"], "openIndex": 17, "missing": False}


def collapse(arr, open_index):
    """open_index より上の段を open_index に足し込む（None は 0 扱い）。"""
    head = list(arr[:open_index])
    return head + [sum(v or 0 for v in arr[open_index:])] + [None] * (N - 1 - open_index)


def aggregate(entries):
    """都道府県の entry を合計する。missing は除き、openIndex は最小にそろえる。"""
    live = [e for e in entries if not e["missing"]]
    if not live:
        return missing_entry()
    oi = min(e["openIndex"] for e in live)
    out = {"male": [0] * (oi + 1) + [None] * (N - 1 - oi), "female": [0] * (oi + 1) + [None] * (N - 1 - oi),
           "unknown": {"male": 0, "female": 0}, "total": 0, "openIndex": oi, "missing": False}
    for e in live:
        for sex in ("male", "female"):
            c = collapse(e[sex], oi)
            out[sex] = [a + b if a is not None else None for a, b in zip(out[sex], c)]
            out["unknown"][sex] += e["unknown"][sex]
        out["total"] += e["total"]
    return out


def build_document(ts3, census2025, lock):
    """パース結果から regions.json の dict を作る。shapes は年×都道府県の判定記録。"""
    shapes = regions_verify.detect_shapes(ts3)
    areas, series = [], {}
    pref_series = {}
    for code in sorted(ts3):
        name = ts3[code]["name"]
        if census2025[code]["name"] != name:
            raise common.ParseError(f"{code}: 地域名が census_ts3（{name}）と census2025（{census2025[code]['name']}）で異なる")
        sh = short_name(name)
        areas.append({"code": code, "name": name, "short": sh, "block": block_of(code),
                      "tile": {"x": TILES[sh][0], "y": TILES[sh][1]}})
        ys = {}
        for y in YEARS:
            if y == 2025:
                ys[str(y)] = pref_entry_2025(census2025[code])
                continue
            s = shapes[(code, y)]
            if s["missing"]:
                ys[str(y)] = missing_entry()
            else:
                ys[str(y)] = pref_entry_ts3(ts3[code]["years"][y], s["openIndex"])
        pref_series[code] = ys
    codes = sorted(pref_series)
    series["national"] = {str(y): aggregate([pref_series[c][str(y)] for c in codes]) for y in YEARS}
    series.update(pref_series)
    blocks = []
    for bid, bname, (lo, hi), (tx, ty) in BLOCKS:
        prefs = [f"{i:02d}" for i in range(lo, hi + 1)]
        blocks.append({"id": bid, "name": bname, "prefs": prefs, "tile": {"x": tx, "y": ty}})
        series[bid] = {str(y): aggregate([pref_series[c][str(y)] for c in prefs]) for y in YEARS}

    sources = {}
    for sid, src in REGION_SOURCES.items():
        d = {"title": src["title"], "table": src["table"], "url": src["url"]}
        if sid in lock:
            d["sha256"] = lock[sid]["sha256"]
            d["retrieved"] = lock[sid]["retrieved"]
        sources[sid] = d
    xmax, _at = regions_verify.max_share(series)
    return {
        "schemaVersion": 1, "fixture": False, "unit": "person", "ageGroups": list(AGE_GROUPS),
        "years": list(YEARS), "xMaxShare": regions_verify.ceil_step(xmax, X_STEP_DENOM),
        "yearMeta": {str(y): year_meta(y) for y in YEARS},
        "areas": areas, "blocks": blocks, "series": series, "attribution": ATTRIBUTION,
        "sources": sources,
        "notes": {k: {"kind": v["kind"], "short": v["short"], "text": v["text"],
                      "appliesTo": [list(a) for a in v["appliesTo"]]} for k, v in NOTES.items()},
    }, shapes


# ---------------------------------------------------------------- 書き出し

def area_names(doc):
    names = {"national": "全国"}
    names.update({a["code"]: a["name"] for a in doc["areas"]})
    names.update({b["id"]: b["name"] for b in doc["blocks"]})
    return names


def group_label(i, is_open):
    return f"{i * 5}+" if is_open else AGE_GROUPS[i]


def dumps_json(doc):
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"


def by_age_csv(doc):
    names = area_names(doc)
    lines = ["year,area_id,area_name,age_group,is_open,sex,population"]
    for y in doc["years"]:
        for aid, ys in doc["series"].items():
            e = ys[str(y)]
            for sex in ("male", "female"):
                for i, v in enumerate(e[sex]):
                    if v is None:
                        continue
                    is_open = i == e["openIndex"]
                    lines.append(f"{y},{aid},{names[aid]},{group_label(i, is_open)},{str(is_open).lower()},{sex},{v}")
    return "\n".join(lines) + "\n"


def _write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def write_outputs(doc, data_dir):
    _write(os.path.join(data_dir, "regions.json"), dumps_json(doc))
    _write(os.path.join(data_dir, "regions_by_age.csv"), by_age_csv(doc))


def write_report(report, data_dir):
    _write(os.path.join(data_dir, "regions_build_report.json"), json.dumps(report, ensure_ascii=False, indent=1) + "\n")


# ---------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="data/raw を取得し直す")
    ap.add_argument("--offline", action="store_true", help="取得せず data/raw のみ使う")
    ap.add_argument("-v", "--verbose", action="store_true", help="WARN も表示")
    ap.add_argument("--root", default=ROOT, help="リポジトリのルート（テスト用）")
    args = ap.parse_args(argv)

    data = os.path.join(args.root, "data")
    raw = os.path.join(data, "raw")
    try:
        lock = fetch_regions(raw, os.path.join(data, "sources.lock.json"), refresh=args.refresh, offline=args.offline)
    except fetch.FetchError as e:
        print(f"取得失敗: {e}", file=sys.stderr)
        return 2

    def p(sid):
        return os.path.join(raw, REGION_SOURCES[sid]["file"])

    try:
        ts3, anomalies = parse_census_ts.parse_ts3(p("census_ts3"))
        kazoe = parse_census_ts.parse_ts3_kazoe(p("census_ts3"))
        ts2 = parse_census_ts.parse_ts2(p("census_ts2"))
        c2025 = parse_census_ts.parse_census2025_prefs(p("census2025"))
        doc, shapes = build_document(ts3, c2025, lock)
        with open(os.path.join(data, "schema", "regions.schema.json"), encoding="utf-8") as f:
            schema = json.load(f)
        pyramid = None
        pyramid_path = os.path.join(data, "pyramid.json")
        if os.path.exists(pyramid_path):
            with open(pyramid_path, encoding="utf-8") as f:
                pyramid = json.load(f)
        report = regions_verify.verify(doc, ts3, shapes, anomalies, kazoe, ts2, schema, c2025, pyramid)
    except (common.ParseError, ValueError, KeyError) as e:
        msg = f"{type(e).__name__}: {e}"
        print(f"構築失敗: {msg}", file=sys.stderr)
        write_report({"result": "FAIL", "counts": {"FAIL": 1, "WARN": 0}, "checks": [], "stats": {},
                      "findings": [{"level": "FAIL", "check": "build", "message": msg}]}, data)
        return 1
    write_report(report, data)
    if not report["counts"]["FAIL"]:
        write_outputs(doc, data)

    print(f"検証: {report['result']}（FAIL {report['counts']['FAIL']} / WARN {report['counts']['WARN']}）"
          f" xMaxShare={doc['xMaxShare']}")
    for f in report["findings"]:
        if f["level"] == "FAIL" or args.verbose:
            print(f"  [{f['level']}] {f['check']} {f.get('area', '')} {f.get('year', '')} {f['message']}")
    return 1 if report["counts"]["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
