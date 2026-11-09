"""合成データから tests/fixtures/regions.fixture.json を生成する（実データではない）。

使い方: python3 -I scripts/make_regions_fixture.py
契約は docs/REGIONS.md §2、スキーマは data/schema/regions.schema.json。
地域ごとに形を変える（都市部は若く、地方は高齢）。年とともに高齢化する。
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "regions.fixture.json")

YEARS = list(range(1920, 2026, 5))
AGE_GROUPS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49",
              "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84", "85+"]

# (code, name, short, block, x, y, 2020年人口の概数(万人), 高齢化度 0=若い〜1=高齢)
AREAS = [
    ("01", "北海道", "北海道", "hokkaido", 12, 0, 522, 0.60),
    ("02", "青森県", "青森", "tohoku", 11, 1, 123, 0.85),
    ("03", "岩手県", "岩手", "tohoku", 11, 2, 121, 0.82),
    ("04", "宮城県", "宮城", "tohoku", 11, 3, 230, 0.40),
    ("05", "秋田県", "秋田", "tohoku", 10, 2, 96, 1.00),
    ("06", "山形県", "山形", "tohoku", 10, 3, 107, 0.80),
    ("07", "福島県", "福島", "tohoku", 11, 4, 183, 0.70),
    ("08", "茨城県", "茨城", "kanto", 12, 5, 285, 0.55),
    ("09", "栃木県", "栃木", "kanto", 11, 5, 193, 0.50),
    ("10", "群馬県", "群馬", "kanto", 10, 5, 194, 0.52),
    ("11", "埼玉県", "埼玉", "kanto", 10, 6, 734, 0.22),
    ("12", "千葉県", "千葉", "kanto", 12, 6, 628, 0.28),
    ("13", "東京都", "東京", "kanto", 11, 6, 1405, 0.00),
    ("14", "神奈川県", "神奈川", "kanto", 11, 7, 923, 0.12),
    ("15", "新潟県", "新潟", "chubu", 9, 4, 220, 0.75),
    ("16", "富山県", "富山", "chubu", 8, 4, 103, 0.62),
    ("17", "石川県", "石川", "chubu", 8, 3, 113, 0.45),
    ("18", "福井県", "福井", "chubu", 7, 4, 77, 0.55),
    ("19", "山梨県", "山梨", "chubu", 9, 6, 81, 0.65),
    ("20", "長野県", "長野", "chubu", 9, 5, 204, 0.65),
    ("21", "岐阜県", "岐阜", "chubu", 8, 5, 197, 0.55),
    ("22", "静岡県", "静岡", "chubu", 8, 7, 364, 0.45),
    ("23", "愛知県", "愛知", "chubu", 8, 6, 754, 0.10),
    ("24", "三重県", "三重", "kinki", 7, 6, 177, 0.55),
    ("25", "滋賀県", "滋賀", "kinki", 7, 5, 141, 0.18),
    ("26", "京都府", "京都", "kinki", 6, 5, 258, 0.35),
    ("27", "大阪府", "大阪", "kinki", 5, 6, 884, 0.25),
    ("28", "兵庫県", "兵庫", "kinki", 5, 5, 546, 0.40),
    ("29", "奈良県", "奈良", "kinki", 6, 6, 132, 0.60),
    ("30", "和歌山県", "和歌山", "kinki", 6, 7, 92, 0.85),
    ("31", "鳥取県", "鳥取", "chugoku", 4, 4, 55, 0.75),
    ("32", "島根県", "島根", "chugoku", 3, 4, 67, 0.95),
    ("33", "岡山県", "岡山", "chugoku", 4, 5, 188, 0.45),
    ("34", "広島県", "広島", "chugoku", 3, 5, 280, 0.42),
    ("35", "山口県", "山口", "chugoku", 2, 5, 134, 0.85),
    ("36", "徳島県", "徳島", "shikoku", 4, 7, 72, 0.85),
    ("37", "香川県", "香川", "shikoku", 4, 6, 95, 0.65),
    ("38", "愛媛県", "愛媛", "shikoku", 3, 6, 133, 0.75),
    ("39", "高知県", "高知", "shikoku", 3, 7, 69, 0.95),
    ("40", "福岡県", "福岡", "kyushu", 1, 6, 513, 0.20),
    ("41", "佐賀県", "佐賀", "kyushu", 1, 5, 81, 0.55),
    ("42", "長崎県", "長崎", "kyushu", 0, 5, 131, 0.75),
    ("43", "熊本県", "熊本", "kyushu", 1, 7, 174, 0.50),
    ("44", "大分県", "大分", "kyushu", 2, 6, 112, 0.70),
    ("45", "宮崎県", "宮崎", "kyushu", 2, 7, 107, 0.65),
    ("46", "鹿児島県", "鹿児島", "kyushu", 1, 8, 159, 0.70),
    ("47", "沖縄県", "沖縄", "kyushu", 0, 7, 146, -0.30),
]

BLOCKS = [
    ("hokkaido", "北海道", 3, 0), ("tohoku", "東北", 3, 1), ("kanto", "関東", 3, 2), ("chubu", "中部", 2, 1),
    ("kinki", "近畿", 1, 2), ("chugoku", "中国", 0, 2), ("shikoku", "四国", 1, 3), ("kyushu", "九州・沖縄", 0, 3),
]

NOTES = [
    ("open-80", "badge", "80歳以上を一括",
     "1920・1930・1935・1950年は、80歳以上の人口をまとめて「80〜84」の段に表示しています。", [[1920, 1920], [1930, 1935], [1950, 1950]]),
    ("okinawa-70", "footnote", "沖縄県は70歳以上を一括",
     "沖縄県の1950・1955年は、70歳以上の人口をまとめて「70〜74」の段に表示しています。九州・沖縄ブロックと全国は、この年、70歳以上をまとめた形で集計しています。", [[1950, 1955]]),
    ("kazoe-1945", "badge", "数え年",
     "1945年は人口調査（11月1日現在）によるもので、年齢は数え年です（「0〜4」の段は数え年1〜5歳）。", [[1945, 1945]]),
    ("okinawa-missing-1945", "footnote", "沖縄県のデータなし",
     "1945年は沖縄県のデータがありません。九州・沖縄ブロックと全国は沖縄県を除いて集計しています。", [[1945, 1945]]),
    ("unknown-excluded", "footnote", "年齢不詳を除く割合",
     "割合は年齢不詳を除いて計算しています。2015・2020・2025年は不詳補完値を使っています。", [[1920, 2025]]),
]


def open_index(code, year):
    if code == "47" and year in (1950, 1955):
        return 14
    if year in (1920, 1930, 1935, 1950):
        return 16
    return 17


def births(b):
    """出生年 b の全国出生数（合成）。"""
    if b < 1920:
        return 1.8e6 + (b - 1850) * 2e3
    if b <= 1940:
        return 2.0e6 + (b - 1920) * 1.0e4
    if b <= 1946:
        return 2.0e6 - (b - 1940) * 5e4
    if b <= 1949:
        return 2.7e6
    if b <= 1957:
        return 2.7e6 - (b - 1949) * 1.5e5
    if b <= 1973:
        return 1.36e6 if b == 1966 else 1.55e6 + (b - 1958) * 3.2e4
    if b <= 1974:
        return 2.05e6
    if b <= 2000:
        return 2.0e6 - (b - 1974) * 3.1e4
    return 1.2e6 - (b - 2000) * 2.0e4


def survival(age, year, male):
    p = (year - 1920) / 105
    mid = 44 + 46 * p ** 0.7 + (-2.5 if male else 3.0)
    width = 15 - 7 * p
    return 1 / (1 + math.exp((age - mid) / width))


def group_weight(g, year, aging, male, kazoe):
    age = 5 * g + 2.5 + (1 if kazoe else 0)
    b = year - age
    w = births(b) * survival(age, year, male) * (1.05 if male else 1.0)
    # 出生数の地域差：戦前は地方が多く、1975年以降は地方ほど少ない
    q = min(1.0, max(0.0, (b - 1975) / 49))
    w *= (1 + 0.15 * aging) if b < 1950 else (1 - 0.30 * aging * q)
    # 進学・就職での移動：都市が若年層を集める
    if 3 <= g <= 6:
        mig = min(1.0, max(0.0, (year - 1950) / 25))
        w *= 1 + (0.5 - aging) * 0.5 * mig
    # 戦争の影響（1945年前後の男性）
    if male and 3 <= g <= 8 and year in (1940, 1945, 1950):
        w *= 0.82
    w *= 1 + 0.03 * math.sin(aging * 7.3 + g * 2.1 + year * 0.05)
    return w


def make_entry(code, base_pop, aging, year):
    yi = (year - 1920) / 105
    growth = (0.46 + 0.54 * min(1.0, yi / 0.86)) if yi <= 0.86 else (1.0 - 0.02 * (yi - 0.86) / 0.14)
    pop = base_pop * 1e4 * growth ** (1 + 0.6 * (0.5 - aging))
    kazoe = year == 1945
    oi = open_index(code, year)
    if code == "47" and year == 1945:
        return {"male": [None] * 18, "female": [None] * 18, "unknown": {"male": 0, "female": 0},
                "total": 0, "openIndex": 17, "missing": True}
    out = {}
    raw = {}
    for sex, male in (("male", True), ("female", False)):
        ws = [group_weight(g, year, aging, male, kazoe) for g in range(23)]
        arr = ws[:oi] + [sum(ws[oi:])]
        raw[sex] = arr
    tot = sum(raw["male"]) + sum(raw["female"])
    for sex in ("male", "female"):
        vals = [int(round(v / tot * pop)) for v in raw[sex]]
        out[sex] = vals + [None] * (17 - oi)
    unk = 0 if year < 1960 else int(pop * 0.0004)
    unknown = {"male": unk // 2, "female": unk - unk // 2}
    known = sum(v for v in out["male"] if v is not None) + sum(v for v in out["female"] if v is not None)
    return {"male": out["male"], "female": out["female"], "unknown": unknown,
            "total": known + unknown["male"] + unknown["female"], "openIndex": oi, "missing": False}


def aggregate(entries):
    live = [e for e in entries if not e["missing"]]
    o = min(e["openIndex"] for e in live)
    res = {"male": [], "female": []}
    for sex in ("male", "female"):
        arr = []
        for g in range(o):
            arr.append(sum(e[sex][g] for e in live))
        arr.append(sum(v for e in live for v in e[sex][o:] if v is not None))
        res[sex] = arr + [None] * (17 - o)
    return {"male": res["male"], "female": res["female"],
            "unknown": {"male": sum(e["unknown"]["male"] for e in live), "female": sum(e["unknown"]["female"] for e in live)},
            "total": sum(e["total"] for e in live), "openIndex": o, "missing": False}


def notes_for(year):
    ids = [n for n in NOTES if any(a <= year <= b for a, b in n[4])]
    ids.sort(key=lambda n: 0 if n[1] == "badge" else 1)  # sort は安定。同じ kind の中では表の順
    return [n[0] for n in ids]


def main():
    series = {}
    for code, _n, _s, _b, _x, _y, pop, aging in AREAS:
        series[code] = {str(y): make_entry(code, pop, aging, y) for y in YEARS}
    for bid, _n, _x, _y in BLOCKS:
        members = [a[0] for a in AREAS if a[3] == bid]
        series[bid] = {str(y): aggregate([series[c][str(y)] for c in members]) for y in YEARS}
    series["national"] = {str(y): aggregate([series[a[0]][str(y)] for a in AREAS]) for y in YEARS}
    ordered = {"national": series["national"]}
    for a in AREAS:
        ordered[a[0]] = series[a[0]]
    for b in BLOCKS:
        ordered[b[0]] = series[b[0]]

    share_max = 0.0
    for per_year in ordered.values():
        for e in per_year.values():
            if e["missing"]:
                continue
            den = sum(v for v in e["male"] if v is not None) + sum(v for v in e["female"] if v is not None)
            for v in e["male"] + e["female"]:
                if v is not None:
                    share_max = max(share_max, v / den)
    x_max = round(math.ceil(share_max / 0.005) * 0.005, 3)

    year_meta = {}
    for y in YEARS:
        k = y == 1945
        year_meta[str(y)] = {"refDate": "1945-11-01" if k else f"{y}-10-01", "kazoe": k,
                             "basis": "人口調査" if k else "国勢調査", "noteIds": notes_for(y)}

    data = {
        "schemaVersion": 1,
        "fixture": True,
        "unit": "person",
        "ageGroups": AGE_GROUPS,
        "years": YEARS,
        "xMaxShare": x_max,
        "yearMeta": year_meta,
        "areas": [{"code": c, "name": n, "short": s, "block": b, "tile": {"x": x, "y": y}}
                  for c, n, s, b, x, y, _p, _a in AREAS],
        "blocks": [{"id": i, "name": n, "prefs": [a[0] for a in AREAS if a[3] == i], "tile": {"x": x, "y": y}}
                   for i, n, x, y in BLOCKS],
        "series": ordered,
        "attribution": "【合成データ】実際の統計ではありません。実データの出典：総務省統計局「国勢調査」（e-Stat）",
        "sources": {
            "census_ts3": {"title": "国勢調査 時系列データ（合成データのため実データではありません）",
                           "table": "第3表 年齢（5歳階級），男女別人口及び人口性比 － 都道府県（大正9年～令和2年）",
                           "url": "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000001085927&fileKind=0",
                           "sha256": "0" * 64, "retrieved": "2026-01-01"},
            "census2025": {"title": "令和7年国勢調査【不詳補完値】（合成データのため実データではありません）",
                           "table": "第2-1表",
                           "url": "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040506653&fileKind=0",
                           "sha256": "0" * 64, "retrieved": "2026-01-01"},
        },
        "notes": {i: {"kind": k, "short": s, "text": t, "appliesTo": a} for i, k, s, t, a in NOTES},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {os.path.relpath(OUT, ROOT)} xMaxShare={x_max}")


if __name__ == "__main__":
    main()
