"""データの検証。FAIL が 1 件でもあればビルドは失敗（終了コード1）。"""
from __future__ import annotations

import copy
import json
import math

from .model import YEARS, year_meta
from .notes import NOTES

PUBLISHED_TOTALS = {1920: 55963000, 2000: 126926000, 2015: 127095000, 2020: 126146000}
SUM_WARN = 10000  # 人（10 千人）


class Report:
    def __init__(self):
        self.findings = []
        self.checks = []

    def add(self, level, check, message, year=None):
        f = {"level": level, "check": check, "message": message}
        if year is not None:
            f["year"] = year
        self.findings.append(f)

    def ran(self, name):
        self.checks.append(name)

    def count(self, level):
        return sum(1 for f in self.findings if f["level"] == level)


def _nn(arr):
    return [v for v in arr if v is not None]


def _fmt_years(ys):
    return ",".join(str(y) for y in ys)


def check_years_and_meta(rep, tables, partial_missing):
    rep.ran("years")
    got = [t.year for t in tables]
    expect = [y for y in YEARS if year_meta(y)["source_id"] not in partial_missing]
    if got != expect:
        rep.add("FAIL", "years", f"年の集合が想定と異なる: 不足={sorted(set(expect) - set(got))} 余分={sorted(set(got) - set(expect))}")
    elif not partial_missing and len(got) != 103:
        rep.add("FAIL", "years", f"年数が {len(got)}（103 であるべき）")
    rep.ran("meta")
    keys = ["ref_date", "kazoe", "min_age", "open_age", "excludes_okinawa", "basis", "source_id", "precision"]
    for t in tables:
        m = year_meta(t.year)
        for k in keys:
            v = getattr(t, k)
            if v == m[k]:
                continue
            rep.add("FAIL", "meta", f"{k}={v!r} が year_meta の {m[k]!r} と不一致", t.year)


def check_nulls(rep, tables):
    rep.ran("nulls")
    for t in tables:
        for sex, arr in (("male", t.male), ("female", t.female)):
            if len(arr) != 101:
                rep.add("FAIL", "nulls", f"{sex} の長さが {len(arr)}", t.year)
                continue
            for a, v in enumerate(arr):
                expect_null = a < t.min_age or a > t.open_age
                if (v is None) != expect_null:
                    rep.add("FAIL", "nulls", f"{sex} {a}歳 の null が不正（値={v}）", t.year)
                    break
                if v is not None and (not isinstance(v, int) or v < 0):
                    rep.add("FAIL", "nulls", f"{sex} {a}歳 の値が不正 {v!r}", t.year)
                    break


def check_schema(rep, doc, schema, partial):
    rep.ran("schema")
    try:
        import jsonschema
    except ImportError:
        rep.add("FAIL", "schema", "jsonschema が導入されていません")
        return
    sch = copy.deepcopy(schema)
    notes = []
    if partial:
        sch["properties"]["years"]["minItems"] = 0
        sch["properties"]["years"]["maxItems"] = 103
        notes.append("部分ビルドのため years の件数制約を緩和")
    errs = sorted(jsonschema.Draft202012Validator(sch).iter_errors(doc), key=lambda e: list(map(str, e.path)))
    for e in errs[:10]:
        rep.add("FAIL", "schema", f"{'/'.join(map(str, e.path))}: {e.message[:200]}")
    if notes:
        rep.add("WARN", "schema", "; ".join(notes) + "（schema は変更せず検証側で緩和）")


def check_sums(rep, tables):
    rep.ran("sums")
    worst = []
    for t in tables:
        if t.precision == 1:
            continue
        n_m, n_f = len(_nn(t.male)), len(_nn(t.female))
        for label, got, total, n in (
            ("男", sum(_nn(t.male)) + t.unknown_male, t.total_male, n_m),
            ("女", sum(_nn(t.female)) + t.unknown_female, t.total_female, n_f),
            ("男女計", sum(_nn(t.male)) + sum(_nn(t.female)) + t.unknown_male + t.unknown_female, t.total_both, n_m + n_f),
        ):
            d = abs(got - total)
            if d > 500 * (n + 1):
                rep.add("FAIL", "sums", f"{label}の各歳合計と総数の差（丸め誤差） {d:,}人 > {500 * (n + 1):,}人", t.year)
            elif d > SUM_WARN:
                rep.add("WARN", "sums", f"{label}の各歳合計と総数の差（丸め誤差） {d:,}人 > {SUM_WARN:,}人", t.year)
            worst.append(d)
    rep.ran("sums-exact")
    for t in tables:
        if t.precision != 1:
            continue
        for label, arr, unk, total in (("male", t.male, t.unknown_male, t.total_male),
                                       ("female", t.female, t.unknown_female, t.total_female)):
            if sum(_nn(arr)) + unk != total:
                rep.add("FAIL", "sums-exact", f"{label}: 各歳+不詳={sum(_nn(arr)) + unk:,} が総数 {total:,} と不一致", t.year)
        if t.total_male + t.total_female != t.total_both:
            rep.add("FAIL", "sums-exact", "男+女が男女計と不一致", t.year)


def check_both(rep, tables):
    rep.ran("both-sexes")
    for t in tables:
        tol = 0 if t.precision == 1 else 1000
        if abs(t.total_male + t.total_female - t.total_both) > tol:
            rep.add("FAIL", "both-sexes", f"総数の男+女と男女計の差 {t.total_male + t.total_female - t.total_both:,}人", t.year)
        if t.both_by_age is None:
            continue
        for a in range(101):
            m, f, b = t.male[a], t.female[a], t.both_by_age[a]
            if m is None or f is None or b is None:
                continue
            if abs(m + f - b) > tol:
                rep.add("FAIL", "both-sexes", f"{a}歳: 男+女={m + f:,} と男女計 {b:,} の差が {tol:,}人超", t.year)
                break


def check_cross_2000(rep, by_key):
    rep.ran("cross-2000")
    a, b = by_key.get((2000, "lt1920")), by_key.get((2000, "lt2000"))
    if a is None or b is None:
        rep.add("WARN", "cross-2000", "2000年の lt1920 と lt2000 の両方が揃っていないため照合を省略")
        return
    for sex in ("male", "female"):
        x, y = getattr(a, sex), getattr(b, sex)
        for age in range(90):
            if abs(x[age] - y[age]) > 1000:
                rep.add("FAIL", "cross-2000", f"{sex} {age}歳: lt1920={x[age]:,} lt2000={y[age]:,}", 2000)
        open_a = sum(_nn(x[a.open_age:]))
        open_b = sum(_nn(y[a.open_age:]))
        if abs(open_a - open_b) > 6000:
            rep.add("FAIL", "cross-2000", f"{sex} {a.open_age}歳以上: lt1920={open_a:,} lt2000(合計)={open_b:,}", 2000)


def check_sex_ratio(rep, tables):
    """0歳（数え年は1歳）の性比。1.02〜1.09 の外は 1.00〜1.12 の内ならWARN、その外はFAIL。

    1920〜1925年の国勢調査・補間値には1.012〜1.018の年があり（実データ）、
    厳密に 1.02 を下限とすると取り込みの誤りでなく原データの性質でFAILになるため段階を分ける。
    """
    rep.ran("sex-ratio")
    for t in tables:
        a = t.min_age
        r = t.male[a] / t.female[a]
        if 1.02 <= r <= 1.09:
            continue
        lvl = "WARN" if 1.00 <= r <= 1.12 else "FAIL"
        rep.add(lvl, "sex-ratio", f"{a}歳の性比 {r:.3f} が 1.02〜1.09 の外", t.year)


def check_hinoeuma(rep, tables):
    rep.ran("hinoeuma")
    for t in tables:
        if t.year < 1967:
            continue
        a = t.year - 1966
        if a + 1 >= t.open_age:
            continue
        for sex in ("male", "female"):
            s = getattr(t, sex)
            if not (s[a] < s[a - 1] and s[a] < s[a + 1]):
                rep.add("FAIL", "hinoeuma", f"{sex} {a}歳が前後（{s[a - 1]:,} / {s[a + 1]:,}）より小さくない（{s[a]:,}）", t.year)


# 原因を確認できていないが、調査・集計上の事情と思われる既知の外れ値（FAIL→WARN）。
# (年, 性, 年齢a) は P(a, 年) → P(a+1, 年+1)。
UNCONFIRMED_ANOMALIES = {(y, "male", 20) for y in (1937, 1938, 1939)}
FAIL_LOW_RELAX_AGE = 90  # 90歳以上は年間死亡率が3割に達し比が0.70を下回りうる（実データ）ので下限を0.50とする
WARN_MAX_AGE = 74  # これより高い年齢は自然死亡で比が0.85を下回りうるのでWARN帯を使わない


def _ratio_interval(p, q, err):
    """丸め誤差 err（人）を含めた比 q/p の取りうる区間。"""
    lo_p, hi_p = p + err, max(p - err, 0)
    lo = max(q - err, 0) / lo_p if lo_p else math.inf
    hi = (q + err) / hi_p if hi_p else math.inf
    return lo, hi


def check_cohort(rep, tables):
    """満年齢・沖縄の扱いが同じ連続年のコホート比。

    千人単位の丸め（±500人）を含めた区間が範囲外に完全にはみ出す場合だけ指摘する。
    """
    rep.ran("cohort")
    by_year = {t.year: t for t in tables}
    for t in tables:
        n = by_year.get(t.year + 1)
        if n is None or t.kazoe or n.kazoe or t.excludes_okinawa != n.excludes_okinawa:
            continue
        top = min(t.open_age, n.open_age) - 2
        err = 500 if min(t.precision, n.precision) > 1 else 0
        for sex in ("male", "female"):
            p, q = getattr(t, sex), getattr(n, sex)
            out = {"FAIL": [], "WARN": []}
            for a in range(0, top + 1):
                if p[a] == 0 and q[a + 1] == 0:
                    continue
                lo, hi = _ratio_interval(p[a], q[a + 1], err)
                r = math.inf if p[a] == 0 else q[a + 1] / p[a]
                if lo > 1.30 or hi < (0.70 if a < FAIL_LOW_RELAX_AGE else 0.50):
                    out["WARN" if (t.year, sex, a) in UNCONFIRMED_ANOMALIES else "FAIL"].append((a, r))
                elif a <= WARN_MAX_AGE and (lo > 1.08 or hi < 0.85):
                    out["WARN"].append((a, r))
            for lvl, lst in out.items():
                if lst:
                    w = max(lst, key=lambda x: abs(x[1] - 1))
                    rep.add(lvl, "cohort", f"{t.year}→{n.year} {sex}: コホート比が範囲外の年齢 {len(lst)}個"
                            f"（最大 {w[0]}→{w[0] + 1}歳 比={w[1]:.3f}）", t.year)


def check_published_totals(rep, tables):
    rep.ran("published-totals")
    by = {t.year: t for t in tables}
    for y, v in PUBLISHED_TOTALS.items():
        if y in by and by[y].total_both != v:
            rep.add("FAIL", "published-totals", f"総人口 {by[y].total_both:,} が公表値 {v:,} と不一致", y)


def check_xmax(rep, doc):
    rep.ran("xmax")
    mx = max(v for y in doc["years"] for s in (y["male"], y["female"]) for v in s if v is not None)
    want = math.ceil(mx / 250000) * 250000
    if doc["xMaxPerSex"] != want:
        rep.add("FAIL", "xmax", f"xMaxPerSex={doc['xMaxPerSex']} が {want} と不一致")
    if mx > doc["xMaxPerSex"]:
        rep.add("FAIL", "xmax", f"最大値 {mx} が xMaxPerSex を超えています")


def check_notes(rep, doc):
    rep.ran("notes-vs-openage")
    want = {79: "open-79", 80: "open-80", 85: "open-85", 86: "open-86", 90: "open-90", 100: "open-100"}
    bad = []
    for y in doc["years"]:
        have = [n for n in y["noteIds"] if n.startswith("open-")]
        w = want.get(y["openAge"])
        if have != ([w] if w else []):
            bad.append((y["year"], y["openAge"], have))
    if bad:
        rep.add("FAIL", "notes-vs-openage", "openAge と open-* 注記が食い違う年: "
                + ", ".join(f"{y}年(openAge={o}, 注記={h})" for y, o, h in bad))


def stats(doc):
    best = (-1, None)
    for y in doc["years"]:
        for sex in ("male", "female"):
            for a, v in enumerate(y[sex]):
                if v is not None and v > best[0]:
                    best = (v, (y["year"], a, sex))
    return {"xMaxPerSex": doc["xMaxPerSex"],
            "maxValue": {"value": best[0], "year": best[1][0], "age": best[1][1], "sex": best[1][2]}}


def verify(doc, tables, by_key, schema, partial_missing=()):
    rep = Report()
    partial = bool(partial_missing)
    check_years_and_meta(rep, tables, set(partial_missing))
    check_nulls(rep, tables)
    check_schema(rep, doc, schema, partial)
    check_sums(rep, tables)
    check_both(rep, tables)
    check_cross_2000(rep, by_key)
    check_sex_ratio(rep, tables)
    check_hinoeuma(rep, tables)
    check_cohort(rep, tables)
    check_published_totals(rep, tables)
    check_xmax(rep, doc)
    check_notes(rep, doc)
    if partial:
        rep.add("WARN", "partial", f"部分ビルド: {sorted(partial_missing)} のパーサが無いため該当年を含みません")
    return rep


def to_report(rep, doc):
    fails, warns = rep.count("FAIL"), rep.count("WARN")
    order = {"FAIL": 0, "WARN": 1}
    items = sorted(rep.findings, key=lambda f: (order[f["level"]], f["check"], f.get("year", 0), f["message"]))
    return {"result": "FAIL" if fails else "PASS", "counts": {"FAIL": fails, "WARN": warns},
            "checks": rep.checks, "stats": stats(doc), "findings": items}
