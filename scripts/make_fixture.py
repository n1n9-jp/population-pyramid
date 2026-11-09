"""合成データから tests/fixtures/pyramid.fixture.json を生成する（実データではない）。

使い方: python3 -I scripts/make_fixture.py
契約は docs/PLAN.md §3、スキーマは data/schema/pyramid.schema.json。
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from pyramid_data.model import YEARS, GAP, year_meta  # noqa: E402

NOTES = {
    "open-85": ("callout", "85歳以上", "1920〜1944年と1947〜1979年は、85歳以上の人口をまとめて「85」の行に表示しています。", [[1920, 1940], [1944, 1944], [1947, 1979]]),
    "open-86": ("callout", "86歳以上", "1945・1946年は、数え年86歳以上の人口をまとめて「86」の行に表示しています。", [[1945, 1946]]),
    "open-90": ("callout", "90歳以上", "1980〜1999年は、90歳以上の人口をまとめて「90」の行に表示しています。", [[1980, 1999]]),
    "open-100": ("callout", "100歳以上", "2000年以降は、100歳以上の人口をまとめて「100」の行に表示しています。", [[2000, 2025]]),
    "kazoe": ("badge", "数え年", "1944〜1946年の年齢は数え年（生まれた年を1歳とし、正月ごとに1歳を加える数え方）です。0歳の区分がなく、満年齢より1〜2歳高く表示されます。調査日も1944年2月22日、1945年11月1日、1946年4月26日と異なります。", [[1944, 1946]]),
    "no-okinawa": ("badge", "沖縄県を含まない", "1945〜1971年の人口は沖縄県を含みません。", [[1945, 1971]]),
    "est-base-2020": ("footnote", "2020年国勢調査基準", "2021〜2024年は令和2年国勢調査を基準とする推計人口で、2025年国勢調査による補正前の値です。", [[2021, 2024]]),
    "unknown-age": ("footnote", "年齢不詳を除く", "2025年は年齢「不詳」の男565人・女506人を図に含めていません（総人口には含みます）。", [[2025, 2025]]),
    "gap-1941-1943": ("timeline", "推計なし", "1941〜1943年は年齢別の人口推計が行われていないため、表示していません。", [[1941, 1943]]),
}
KIND_ORDER = ["callout", "badge", "footnote"]

SOURCES = {
    "lt1920": ("人口推計 長期時系列データ 我が国の推計人口（大正9年～平成12年）", "第4表 年齢（各歳），男女別人口", "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000000090264&fileKind=0", "千人"),
    "lt2000": ("人口推計 長期時系列データ 我が国の推計人口（平成12年～令和2年）", "総人口（2000年～2015年）・総人口（2015年～2020年）", "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000013168604&fileKind=4", "千人"),
    "census2025": ("令和7年国勢調査 人口等基本集計", "年齢（各歳），男女別人口", "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040506653&fileKind=0", "人"),
}
for _y in range(2021, 2025):
    SOURCES[f"est{_y}"] = (f"人口推計（{_y}年10月1日現在）", "第1表 年齢（各歳），男女別人口", f"https://www.stat.go.jp/data/jinsui/{_y}np/zuhyou/05k{_y}-1.xlsx", "千人")
SOURCE_ORDER = ["lt1920", "lt2000", "est2021", "est2022", "est2023", "est2024", "census2025"]


def births(b):
    """出生年 b の出生数（合成）。1950年より前は戦前の死亡の多さを雑に反映して小さくする。"""
    return _births(b) * (0.65 if b < 1950 else 1.0)


def _births(b):
    if b < 1920:
        return 1.2e6 + (b - 1850) * 1.1e4
    if b <= 1940:
        return 2.0e6 + (b - 1920) * 8e3
    if b <= 1946:
        return 1.7e6
    if b <= 1949:
        return 2.7e6
    if b <= 1957:
        return 2.7e6 - (b - 1949) * 1.2e5
    if b <= 1972:
        base = 1.7e6 + (b - 1957) * 2.0e4 + 2.5e5 * max(0, (b - 1969)) / 3
        return 1.36e6 if b == 1966 else base
    if b <= 1974:
        return 2.1e6
    if b <= 2000:
        return 2.0e6 - (b - 1974) * 3.2e4
    return 1.2e6 - (b - 2000) * 2.0e4


def survival(age, year):
    scale = 62 + (year - 1920) * 0.24
    return math.exp(-((max(age, 0) / scale) ** 10))


def person_at(year, age):
    return births(year - age) * survival(age, year) / 2


def build_year(year):
    m = year_meta(year)
    kz, minage, openage, prec = m["kazoe"], m["min_age"], m["open_age"], m["precision"]

    def series(sex_factor):
        out = [None] * 101
        for a in range(minage, openage + 1):
            real = a - 1.5 if kz else a
            if a < openage:
                v = person_at(year, real) * sex_factor
            else:
                v = sum(person_at(year, x) * sex_factor for x in range(openage, 111)) if not kz else sum(person_at(year, x - 1.5) * sex_factor for x in range(openage, 111))
            out[a] = int(round(v / prec) * prec)
        return out

    male, female = series(1.025), series(0.975)
    unk = {"male": 565, "female": 506} if year == 2025 else {"male": 0, "female": 0}
    tm, tf = sum(v for v in male if v) + unk["male"], sum(v for v in female if v) + unk["female"]
    note_ids = []
    for kind in KIND_ORDER:
        for nid, (k, _s, _t, applies) in NOTES.items():
            if k == kind and any(a <= year <= b for a, b in applies):
                note_ids.append(nid)
    return {
        "year": year, "refDate": m["ref_date"], "kazoe": kz, "minAge": minage, "openAge": openage,
        "excludesOkinawa": m["excludes_okinawa"], "basis": m["basis"], "sourceId": m["source_id"],
        "precision": prec, "total": {"male": tm, "female": tf, "both": tm + tf},
        "unknownAge": unk, "noteIds": note_ids, "male": male, "female": female,
    }


def main():
    years = [build_year(y) for y in YEARS]
    vmax = max(v for y in years for s in (y["male"], y["female"]) for v in s if v is not None)
    doc = {
        "schemaVersion": 1, "fixture": True, "unit": "person", "ageMax": 100,
        "yearMin": 1920, "yearMax": 2025,
        "xMaxPerSex": int(math.ceil(vmax / 250000) * 250000),
        "gaps": [{"start": GAP[0], "end": GAP[1], "noteId": "gap-1941-1943"}],
        "basisLabels": {"census": "国勢調査", "survey": "人口調査", "intercensal": "補間補正人口", "estimate": "推計人口"},
        "attribution": "出典：総務省統計局「人口推計」「令和7年国勢調査」（e-Stat）を加工して作成",
        "sources": {k: {"title": SOURCES[k][0], "table": SOURCES[k][1], "url": SOURCES[k][2], "unitInSource": SOURCES[k][3]} for k in SOURCE_ORDER},
        "notes": {k: {"kind": v[0], "short": v[1], "text": v[2], "appliesTo": v[3]} for k, v in NOTES.items()},
        "years": years,
    }
    out = os.path.join(ROOT, "tests", "fixtures", "pyramid.fixture.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    try:
        import jsonschema
        with open(os.path.join(ROOT, "data", "schema", "pyramid.schema.json"), encoding="utf-8") as f:
            jsonschema.validate(doc, json.load(f))
        print("schema OK")
    except ImportError:
        print("jsonschema 未導入: スキーマ検証を省略")
    print(out, "xMaxPerSex", doc["xMaxPerSex"], "max", vmax)


if __name__ == "__main__":
    main()
