"""取得・パーサ・merge・notes・writers・verify・build_data のテスト。"""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from pyramid_data import (fetch, merge, notes, parse_census2025, parse_est,  # noqa: E402
                          parse_lt2000, verify, writers)
from pyramid_data.model import YEARS, YearTable, year_meta  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")


def raw(name):
    return os.path.join(RAW, name)


def have(*names):
    return all(os.path.exists(raw(n)) for n in names)


def make_table(year, base=1000, ratio=1.05):
    m = year_meta(year)
    male, female = [None] * 101, [None] * 101
    for a in range(m["min_age"], m["open_age"] + 1):
        female[a] = base * 1000
        male[a] = int(base * 1000 * ratio)
    return YearTable(
        year=year, ref_date=m["ref_date"], kazoe=m["kazoe"], min_age=m["min_age"], open_age=m["open_age"],
        male=male, female=female, total_male=sum(v for v in male if v is not None),
        total_female=sum(v for v in female if v is not None),
        total_both=sum(v for v in male + female if v is not None), precision=m["precision"],
        excludes_okinawa=m["excludes_okinawa"], basis=m["basis"], source_id=m["source_id"],
    )


class NotesTest(unittest.TestCase):
    def test_matches_plan_table(self):
        with open(os.path.join(ROOT, "docs", "PLAN.md"), encoding="utf-8") as f:
            text = f.read()
        rows = {}
        for line in text.splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == 5 and cells[0] in notes.NOTES:
                rows[cells[0]] = cells
        self.assertEqual(set(rows), set(notes.NOTES))
        for nid, (_i, kind, short, body, applies) in rows.items():
            n = notes.NOTES[nid]
            self.assertEqual((n["kind"], n["short"], n["text"]), (kind, short, body), nid)
            spans = [[int(a), int(b)] for a, b in re.findall(r"\[(\d+),(\d+)\]", applies)]
            self.assertEqual(n["appliesTo"], spans, nid)

    def test_note_ids_order(self):
        self.assertEqual(notes.note_ids_for(1920), ["open-85"])
        self.assertEqual(notes.note_ids_for(1945), ["open-86", "kazoe", "no-okinawa"])
        self.assertEqual(notes.note_ids_for(1944), ["open-85", "kazoe"])
        self.assertEqual(notes.note_ids_for(1960), ["open-85", "no-okinawa"])
        self.assertEqual(notes.note_ids_for(2022), ["open-100", "est-base-2020"])
        self.assertEqual(notes.note_ids_for(2025), ["open-100", "unknown-age"])
        self.assertEqual(notes.note_ids_for(1990), ["open-90"])


class FetchTest(unittest.TestCase):
    def test_offline_missing_raises(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(fetch.FetchError):
                fetch.fetch_all(os.path.join(d, "raw"), os.path.join(d, "lock.json"), offline=True)

    def test_non_xlsx_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            rd = os.path.join(d, "raw")
            os.makedirs(rd)
            for src in fetch.SOURCES.values():
                with open(os.path.join(rd, src["file"]), "wb") as f:
                    f.write(b"<html>")
            with self.assertRaises(fetch.FetchError):
                fetch.fetch_all(rd, os.path.join(d, "lock.json"), offline=True)

    def test_lock_records_sha_and_keeps_date(self):
        with tempfile.TemporaryDirectory() as d:
            rd, lock_path = os.path.join(d, "raw"), os.path.join(d, "lock.json")
            os.makedirs(rd)
            for src in fetch.SOURCES.values():
                with open(os.path.join(rd, src["file"]), "wb") as f:
                    f.write(b"PK-test-" + src["file"].encode())
            lock = fetch.fetch_all(rd, lock_path, offline=True, today="2026-01-01", log=lambda *_: None)
            want = hashlib.sha256(b"PK-test-lt2000.xlsx").hexdigest()
            self.assertEqual(lock["lt2000"]["sha256"], want)
            again = fetch.fetch_all(rd, lock_path, offline=True, today="2030-01-01", log=lambda *_: None)
            self.assertEqual(again, lock)  # 内容が同じなら取得日は変わらない
            self.assertEqual(set(lock), {"lt1920", "lt2000", "est2021", "est2022", "est2023", "est2024", "census2025"})

    def test_refresh_same_content_keeps_retrieved(self):
        with tempfile.TemporaryDirectory() as d:
            rd, lock_path = os.path.join(d, "raw"), os.path.join(d, "lock.json")
            os.makedirs(rd)
            for src in fetch.SOURCES.values():
                with open(os.path.join(rd, src["file"]), "wb") as f:
                    f.write(b"PK-test-" + src["file"].encode())
            lock = fetch.fetch_all(rd, lock_path, offline=True, today="2026-01-01", log=lambda *_: None)

            def same(url, dest):  # 同じ内容を再取得したことにする
                src = next(s for s in fetch.SOURCES.values() if s["url"] == url)
                with open(dest, "wb") as f:
                    f.write(b"PK-test-" + src["file"].encode())

            orig, fetch._download = fetch._download, same
            try:
                again = fetch.fetch_all(rd, lock_path, refresh=True, today="2030-01-01", log=lambda *_: None)
            finally:
                fetch._download = orig
            self.assertEqual(again, lock)


class BuildFailureTest(unittest.TestCase):
    def setUp(self):
        import build_data

        self.bd = build_data
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = self.tmp.name
        os.makedirs(os.path.join(d, "data", "schema"))
        os.makedirs(os.path.join(d, "data", "raw"))
        shutil.copy(os.path.join(ROOT, "data", "schema", "pyramid.schema.json"), os.path.join(d, "data", "schema"))
        for src in fetch.SOURCES.values():
            with open(os.path.join(d, "data", "raw", src["file"]), "wb") as f:
                f.write(b"PK-test")
        self.data = os.path.join(d, "data")

    def run_main(self):
        import contextlib
        import io

        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code = self.bd.main(["--offline", "--root", self.tmp.name])
        return code, err.getvalue()

    def test_parse_error_exits_1_with_report(self):
        from pyramid_data import common

        def boom(_path):
            raise common.ParseError("壊れた表")

        orig, parse_lt2000.parse = parse_lt2000.parse, boom
        self.addCleanup(setattr, parse_lt2000, "parse", orig)
        self.addCleanup(setattr, self.bd.parse_lt1920, "parse", self.bd.parse_lt1920.parse)
        self.bd.parse_lt1920.parse = lambda _p: []
        code, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("壊れた表", err)
        with open(os.path.join(self.data, "build_report.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["result"], "FAIL")
        self.assertFalse(os.path.exists(os.path.join(self.data, "pyramid.json")))

    def test_verify_fail_writes_only_report(self):
        self.addCleanup(setattr, self.bd.parse_lt1920, "parse", self.bd.parse_lt1920.parse)
        self.bd.parse_lt1920.parse = lambda _p: []
        for mod in (parse_lt2000, parse_census2025):
            self.addCleanup(setattr, mod, "parse", mod.parse)
            mod.parse = lambda _p: []
        self.addCleanup(setattr, parse_est, "parse", parse_est.parse)
        parse_est.parse = lambda _p: []
        self.addCleanup(setattr, self.bd.merge, "merge", self.bd.merge.merge)
        self.bd.merge.merge = lambda tables: ([], {})
        self.addCleanup(setattr, self.bd.writers, "build_document", self.bd.writers.build_document)
        self.bd.writers.build_document = lambda chosen, lock: {}
        self.addCleanup(setattr, self.bd.verify, "verify", self.bd.verify.verify)
        self.addCleanup(setattr, self.bd.verify, "to_report", self.bd.verify.to_report)
        self.bd.verify.verify = lambda *a: object()
        self.bd.verify.to_report = lambda rep, doc: {
            "result": "FAIL", "counts": {"FAIL": 1, "WARN": 0}, "findings": []}
        code, _ = self.run_main()
        self.assertEqual(code, 1)
        self.assertTrue(os.path.exists(os.path.join(self.data, "build_report.json")))
        for n in ("pyramid.json", "population_by_age.csv", "population_totals.csv"):
            self.assertFalse(os.path.exists(os.path.join(self.data, n)), n)


@unittest.skipUnless(have("lt2000.xlsx"), "data/raw/lt2000.xlsx がありません")
class Lt2000Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables = {t.year: t for t in parse_lt2000.parse(raw("lt2000.xlsx"))}

    def test_years_and_totals(self):
        self.assertEqual(sorted(self.tables), list(range(2000, 2021)))
        self.assertEqual(self.tables[2000].total_both, 126926000)
        self.assertEqual(self.tables[2020].total_both, 126146000)

    def test_2015_from_later_sheet(self):
        self.assertIn("2015年～2020年", self.tables[2015].sheet)
        self.assertEqual(self.tables[2015].total_both, 127095000)

    def test_open_age_2000_2004(self):
        t = self.tables[2000]
        self.assertEqual(t.open_age, 90)
        self.assertIsNone(t.male[91])
        self.assertEqual(t.male[90], 177000)
        self.assertEqual(self.tables[2005].open_age, 100)
        self.assertEqual(self.tables[2015].male[100], 8000)


@unittest.skipUnless(have("est2021.xlsx", "est2022.xlsx", "est2023.xlsx", "est2024.xlsx"), "est がありません")
class EstTest(unittest.TestCase):
    def test_each_year(self):
        for y, total in ((2021, 125502000), (2022, 124947000), (2023, 124352000), (2024, 123802000)):
            (t,) = parse_est.parse(raw(f"est{y}.xlsx"))
            self.assertEqual((t.year, t.source_id, t.total_both), (y, f"est{y}", total))
            self.assertEqual(t.open_age, 100)
            self.assertTrue(all(v is not None for v in t.male))
        (t,) = parse_est.parse(raw("est2021.xlsx"))
        self.assertEqual((t.male[0], t.female[0], t.male[49], t.male[50], t.male[100]), (425000, 405000, 1009000, 978000, 10000))


@unittest.skipUnless(have("census2025.xlsx"), "census2025.xlsx がありません")
class Census2025Test(unittest.TestCase):
    def test_parse(self):
        (t,) = parse_census2025.parse(raw("census2025.xlsx"))
        self.assertEqual((t.total_both, t.total_male, t.total_female), (122972528, 59772092, 63200436))
        self.assertEqual((t.unknown_male, t.unknown_female), (565, 506))
        self.assertEqual(sum(t.male) + t.unknown_male, t.total_male)
        self.assertEqual(sum(t.female) + t.unknown_female, t.total_female)
        self.assertEqual(t.precision, 1)
        self.assertEqual(t.both_by_age[0], 667940)


class MergeTest(unittest.TestCase):
    def test_picks_lt2000_for_2000(self):
        a, b = make_table(2000), make_table(2000)
        a.source_id, a.open_age = "lt1920", 90
        chosen, by_key = merge.merge([a, b], allow_missing_sources={"lt1920", "est2021", "est2022", "est2023", "est2024", "census2025"} | {"lt2000"})
        self.assertEqual([t.source_id for t in chosen if t.year == 2000], ["lt2000"])
        self.assertEqual(set(by_key), {(2000, "lt1920"), (2000, "lt2000")})

    def test_missing_year_raises(self):
        with self.assertRaises(merge.MergeError):
            merge.merge([make_table(2001)])


class WritersTest(unittest.TestCase):
    def doc(self):
        tables = [make_table(y) for y in (1920, 1944, 2025)]
        return writers.build_document(tables, {}), tables

    def test_json_deterministic_and_shape(self):
        doc, _ = self.doc()
        a, b = writers.dumps_json(doc), writers.dumps_json(json.loads(writers.dumps_json(doc)))
        self.assertEqual(a, b)
        self.assertNotIn("\n ", a)
        self.assertEqual(list(doc)[:3], ["schemaVersion", "fixture", "unit"])
        y = doc["years"][1]
        self.assertEqual((y["year"], y["noteIds"], y["minAge"], y["male"][0]), (1944, ["open-85", "kazoe"], 1, None))
        self.assertEqual(doc["xMaxPerSex"], 1250000)

    def test_csv(self):
        doc, _ = self.doc()
        text = writers.age_csv(doc)
        self.assertFalse(text.startswith("﻿"))
        self.assertNotIn("\r", text)
        lines = text.splitlines()
        self.assertEqual(lines[0], "year,ref_date,kazoe,age,is_open,age_label,sex,population,precision,excludes_okinawa,basis,source_id")
        self.assertIn("1920,1920-10-01,false,85,true,85歳以上,male,1050000,1000,false,census,lt1920", lines)
        self.assertFalse(any(l.startswith("1944,") and ",0,false,0歳," in l for l in lines))  # null 行は出さない
        tot = writers.totals_csv(doc).splitlines()
        self.assertEqual(tot[0], "year,ref_date,sex,total,unknown_age,source_id")
        self.assertEqual(tot[1].split(",")[2], "male")


class VerifyTest(unittest.TestCase):
    schema = json.load(open(os.path.join(ROOT, "data", "schema", "pyramid.schema.json"), encoding="utf-8"))

    def run_verify(self, tables):
        doc = writers.build_document(tables, {})
        by_key = {(t.year, t.source_id): t for t in tables}
        return verify.verify(doc, tables, by_key, self.schema, partial_missing={"lt1920", "lt2000", "est2021", "est2022", "est2023", "est2024", "census2025"} - {t.source_id for t in tables})

    def levels(self, rep, check):
        return [f["level"] for f in rep.findings if f["check"] == check]

    def test_null_pattern_fail(self):
        t = make_table(1944)
        t.male[0] = 5
        self.assertIn("FAIL", self.levels(self.run_verify([t]), "nulls"))

    def test_sum_mismatch(self):
        t = make_table(1990)
        t.total_male += 20_000
        self.assertIn("WARN", self.levels(self.run_verify([t]), "sums"))
        t.total_male += 10_000_000
        self.assertIn("FAIL", self.levels(self.run_verify([t]), "sums"))

    def test_census_exact(self):
        t = make_table(2025)
        t.unknown_male, t.unknown_female = 5, 6
        t.total_male += 5
        t.total_female += 6
        t.total_both = t.total_male + t.total_female
        self.assertEqual(self.levels(self.run_verify([t]), "sums-exact"), [])
        t.total_male += 1
        self.assertIn("FAIL", self.levels(self.run_verify([t]), "sums-exact"))

    def test_sex_ratio(self):
        t = make_table(1990, ratio=0.9)
        self.assertIn("FAIL", self.levels(self.run_verify([t]), "sex-ratio"))
        self.assertEqual(self.levels(self.run_verify([make_table(1990, ratio=1.05)]), "sex-ratio"), [])

    def test_hinoeuma_requires_dip(self):
        t = make_table(1990)  # 凹みがない
        self.assertIn("FAIL", self.levels(self.run_verify([t]), "hinoeuma"))
        for sex in (t.male, t.female):
            sex[1990 - 1966] = int(sex[1990 - 1966] * 0.7)
        self.assertEqual(self.levels(self.run_verify([t]), "hinoeuma"), [])

    def test_cohort_ratio(self):
        a, b = make_table(1990), make_table(1991)
        for t in (a, b):
            t.male[30] = t.male[31] = 1_000_000
        b.male[31] = 500_000
        self.assertIn("FAIL", self.levels(self.run_verify([a, b]), "cohort"))

    def test_cohort_skips_kazoe_pairs(self):
        a, b = make_table(1944), make_table(1945)
        b.male[10] = 1
        self.assertEqual(self.levels(self.run_verify([a, b]), "cohort"), [])

    def test_published_total(self):
        t = make_table(1920)
        self.assertIn("FAIL", self.levels(self.run_verify([t]), "published-totals"))


@unittest.skipUnless(have(*[s["file"] for s in fetch.SOURCES.values()]), "data/raw が揃っていません")
class BuildTest(unittest.TestCase):
    def test_build_twice_identical(self):
        import build_data

        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "data", "schema"))
            shutil.copy(os.path.join(ROOT, "data", "schema", "pyramid.schema.json"), os.path.join(d, "data", "schema"))
            os.symlink(RAW, os.path.join(d, "data", "raw"))
            outs = []
            for _ in range(2):
                self.assertEqual(build_data.main(["--offline", "--root", d]), 0)
                outs.append({n: open(os.path.join(d, "data", n), "rb").read()
                             for n in ("pyramid.json", "population_by_age.csv", "population_totals.csv", "build_report.json", "sources.lock.json")})
            self.assertEqual(outs[0], outs[1])
            doc = json.loads(outs[0]["pyramid.json"])
            self.assertEqual(len(doc["years"]), 103)
            self.assertEqual([y["year"] for y in doc["years"]], YEARS)


if __name__ == "__main__":
    unittest.main()
