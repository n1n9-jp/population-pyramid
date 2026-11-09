"""地域別データ（build_regions.py・parse_census_ts・regions_verify）のテスト。"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from fractions import Fraction

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import build_regions  # noqa: E402
from pyramid_data import parse_census_ts, regions_verify  # noqa: E402
from pyramid_data.parse_census_ts import N, YEARS  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")
RAW_FILES = ("census_ts3.xlsx", "census_ts2.xlsx", "census2025.xlsx")


def have_raw():
    return all(os.path.exists(os.path.join(RAW, f)) for f in RAW_FILES)


def entry(base, oi=17, unknown=(0, 0), missing=False):
    if missing:
        return build_regions.missing_entry()
    male = [base + i if i <= oi else None for i in range(N)]
    female = [base * 2 + i if i <= oi else None for i in range(N)]
    tot = sum(male[:oi + 1]) + sum(female[:oi + 1]) + sum(unknown)
    return {"male": male, "female": female, "unknown": {"male": unknown[0], "female": unknown[1]},
            "total": tot, "openIndex": oi, "missing": False}


class GroupLabelTest(unittest.TestCase):
    def test_group_index(self):
        g = parse_census_ts._group_index
        self.assertEqual(g("総数"), "total")
        self.assertEqual(g("0～4歳"), 0)
        self.assertEqual(g("80～84歳（80歳以上）"), 16)
        self.assertEqual(g("70～74歳（70歳以上）"), 14)
        self.assertEqual(g("85歳以上"), 17)
        self.assertIsNone(g("（再掲）15歳未満"))
        self.assertIsNone(g("85～89歳"))

    def test_year_columns_prefers_imputed(self):
        header = ["地域", "年齢"]
        for y in parse_census_ts.TS_YEARS:
            header += [f"{y}年", "", "", "", "", "", ""]
        header += ["2015年", "", "", "", "", "", "", "2020年", "", "", "", "", "", ""]
        cols = parse_census_ts.ts3_year_columns(header)
        self.assertEqual(cols[1920], 2)
        self.assertEqual(cols[1925], 9)
        self.assertEqual(cols[2015], len(header) - 14)
        self.assertEqual(cols[2020], len(header) - 7)


class ShapeTest(unittest.TestCase):
    def raw(self, oi):
        vals = [10 if i <= oi else None for i in range(N)]
        return {"male": list(vals), "female": list(vals), "total": 999, "totalMale": 500, "totalFemale": 499}

    def test_detect(self):
        for oi in (14, 16, 17):
            self.assertEqual(regions_verify.detect_open_index(self.raw(oi)), oi)
        empty = {"male": [None] * N, "female": [None] * N, "total": None, "totalMale": None, "totalFemale": None}
        self.assertIsNone(regions_verify.detect_open_index(empty))
        bad = self.raw(17)
        bad["male"][3] = None
        with self.assertRaises(ValueError):
            regions_verify.detect_open_index(bad)

    def test_expected(self):
        e = regions_verify.expected_shape
        self.assertEqual(e("13", 1920), (16, False))
        self.assertEqual(e("13", 1925), (17, False))
        self.assertEqual(e("47", 1935), (16, False))
        self.assertEqual(e("47", 1950), (14, False))
        self.assertEqual(e("01", 1950), (16, False))
        self.assertEqual(e("47", 1955), (14, False))
        self.assertEqual(e("47", 1945), (17, True))
        self.assertEqual(e("13", 2020), (17, False))


class AggregateTest(unittest.TestCase):
    def test_align_to_smallest_open_index(self):
        a, b = entry(100, oi=17, unknown=(1, 2)), entry(1000, oi=14)
        out = build_regions.aggregate([a, b])
        self.assertEqual(out["openIndex"], 14)
        self.assertEqual(out["male"][13], a["male"][13] + b["male"][13])
        self.assertEqual(out["male"][14], sum(a["male"][14:]) + b["male"][14])
        self.assertEqual(out["male"][15:], [None] * 3)
        self.assertEqual(out["unknown"], {"male": 1, "female": 2})
        self.assertEqual(out["total"], a["total"] + b["total"])

    def test_missing_is_excluded(self):
        a = entry(100)
        out = build_regions.aggregate([a, entry(0, missing=True)])
        self.assertEqual(out["male"], a["male"])
        self.assertEqual(out["total"], a["total"])
        self.assertFalse(out["missing"])

    def test_missing_shape(self):
        m = build_regions.missing_entry()
        self.assertEqual(m["male"], [None] * N)
        self.assertEqual(m["total"], 0)
        self.assertTrue(m["missing"])


class SmallPartsTest(unittest.TestCase):
    def test_ceil_step(self):
        self.assertEqual(regions_verify.ceil_step(Fraction(85011, 1000000)), 0.09)
        self.assertEqual(regions_verify.ceil_step(Fraction(75, 1000)), 0.075)
        self.assertEqual(regions_verify.ceil_step(Fraction(70001, 1000000)), 0.075)

    def test_short_name(self):
        s = build_regions.short_name
        self.assertEqual([s("北海道"), s("青森県"), s("東京都"), s("京都府"), s("大阪府")],
                         ["北海道", "青森", "東京", "京都", "大阪"])

    def test_note_ids(self):
        f = build_regions.note_ids_for
        self.assertEqual(f(1920), ["open-80", "unknown-excluded"])
        self.assertEqual(f(1945), ["kazoe-1945", "okinawa-missing-1945", "unknown-excluded"])
        self.assertEqual(f(1950), ["open-80", "okinawa-70", "unknown-excluded"])
        self.assertEqual(f(1955), ["okinawa-70", "unknown-excluded"])
        self.assertEqual(f(2025), ["unknown-excluded"])

    def test_notes_match_contract(self):
        with open(os.path.join(ROOT, "docs", "REGIONS.md"), encoding="utf-8") as f:
            text = f.read()
        for nid, n in build_regions.NOTES.items():
            spans = ",".join(f"[{a},{b}]" for a, b in n["appliesTo"])
            row = f"| {nid} | {n['kind']} | {n['short']} | {n['text']} | {spans} |"
            self.assertIn(row, text, nid)

    def test_tiles_cover_47(self):
        self.assertEqual(len(build_regions.TILES), 47)
        self.assertEqual(len(set(build_regions.TILES.values())), 47)

    def test_csv_skips_null(self):
        doc = {"years": [1950], "areas": [{"code": "47", "name": "沖縄県"}], "blocks": [],
               "series": {"national": {"1950": entry(1, oi=14)}, "47": {"1950": entry(1, missing=True)}}}
        lines = build_regions.by_age_csv(doc).splitlines()
        self.assertEqual(lines[0], "year,area_id,area_name,age_group,is_open,sex,population")
        self.assertEqual(len(lines), 1 + 15 * 2)
        self.assertIn("1950,national,全国,70+,true,male,15", lines)


@unittest.skipUnless(have_raw(), "data/raw に census_ts3/ts2/2025 がありません（build_regions.py を先に実行）")
class RealDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ts3, cls.anomalies = parse_census_ts.parse_ts3(os.path.join(RAW, "census_ts3.xlsx"))
        cls.c2025 = parse_census_ts.parse_census2025_prefs(os.path.join(RAW, "census2025.xlsx"))
        cls.ts2 = parse_census_ts.parse_ts2(os.path.join(RAW, "census_ts2.xlsx"))

    def test_shapes_match_footnotes(self):
        shapes = regions_verify.detect_shapes(self.ts3)
        for (code, y), s in shapes.items():
            self.assertIsNone(s["error"], (code, y))
            if (code, y) == ("47", 1945):
                self.assertFalse(s["detectedMissing"])  # 表には値がある（契約では missing）
                continue
            self.assertEqual(s["detectedOpenIndex"], s["openIndex"], (code, y))

    def test_2025_total(self):
        self.assertEqual(sum(r["total"] for r in self.c2025.values()), 122972528)

    def test_ts2_imputed_2020(self):
        self.assertEqual(self.ts2[2020]["totalMale"] + self.ts2[2020]["totalFemale"], 126146099)
        self.assertEqual(sum(self.ts2[2020]["male"]), self.ts2[2020]["totalMale"])  # 不詳補完値は不詳なし

    def test_kazoe_sheet(self):
        k = parse_census_ts.parse_ts3_kazoe(os.path.join(RAW, "census_ts3.xlsx"))
        self.assertTrue(k["nonOkinawa"]["kazoe"])
        self.assertEqual(k["nonOkinawa"]["first"], "1~5歳")

    def test_only_known_anomaly(self):
        self.assertEqual([(a["area"], a["year"], a["group"]) for a in self.anomalies], [("34", 1925, 16)])


@unittest.skipUnless(have_raw(), "data/raw に census_ts3/ts2/2025 がありません（build_regions.py を先に実行）")
class BuildTest(unittest.TestCase):
    """一時ディレクトリで --offline 構築を2回行い、終了コード0とバイト一致を確かめる。"""

    OUTS = ("regions.json", "regions_by_age.csv", "regions_build_report.json")

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        data = os.path.join(self.tmp, "data")
        os.makedirs(os.path.join(data, "raw"))
        shutil.copytree(os.path.join(ROOT, "data", "schema"), os.path.join(data, "schema"))
        shutil.copy(os.path.join(ROOT, "data", "sources.lock.json"), os.path.join(data, "sources.lock.json"))
        for f in RAW_FILES:
            os.symlink(os.path.join(RAW, f), os.path.join(data, "raw", f))
        self.data = data

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def digests(self):
        out = {}
        for f in self.OUTS:
            with open(os.path.join(self.data, f), "rb") as fh:
                out[f] = hashlib.sha256(fh.read()).hexdigest()
        return out

    def run_build(self):
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            return build_regions.main(["--offline", "--root", self.tmp])

    def test_build_twice_identical_and_valid(self):
        self.assertEqual(self.run_build(), 0)
        first = self.digests()
        self.assertEqual(self.run_build(), 0)
        self.assertEqual(self.digests(), first)
        with open(os.path.join(self.data, "regions.json"), encoding="utf-8") as f:
            doc = json.load(f)
        with open(os.path.join(self.data, "regions_build_report.json"), encoding="utf-8") as f:
            rep = json.load(f)
        self.assertEqual(rep["counts"]["FAIL"], 0)
        self.assertEqual(len(doc["series"]), 56)
        self.assertEqual(doc["series"]["national"]["2025"]["total"], 122972528)
        self.assertTrue(doc["series"]["47"]["1945"]["missing"])
        self.assertEqual(doc["series"]["kyushu"]["1950"]["openIndex"], 14)
        self.assertEqual(doc["series"]["national"]["1955"]["openIndex"], 14)
        self.assertEqual(doc["series"]["national"]["1920"]["openIndex"], 16)
        self.assertEqual([int(y) for y in doc["series"]["01"]], YEARS)
        # 既存のロックのキーは変わらない
        with open(os.path.join(ROOT, "data", "sources.lock.json"), encoding="utf-8") as f:
            before = json.load(f)
        with open(os.path.join(self.data, "sources.lock.json"), encoding="utf-8") as f:
            after = json.load(f)
        for k, v in before.items():
            self.assertEqual(after[k], v, k)
        # 決定的な出力（committed のファイルと同一）
        for f in self.OUTS:
            committed = os.path.join(ROOT, "data", f)
            if os.path.exists(committed):
                with open(committed, "rb") as fh:
                    self.assertEqual(hashlib.sha256(fh.read()).hexdigest(), first[f], f)

    def test_offline_without_raw_exits_2(self):
        os.unlink(os.path.join(self.data, "raw", "census_ts2.xlsx"))
        self.assertEqual(self.run_build(), 2)

    def test_not_xlsx_exits_2(self):
        p = os.path.join(self.data, "raw", "census_ts2.xlsx")
        os.unlink(p)
        with open(p, "wb") as f:
            f.write(b"<html>")
        self.assertEqual(self.run_build(), 2)


if __name__ == "__main__":
    unittest.main()
