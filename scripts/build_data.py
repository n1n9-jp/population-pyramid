#!/usr/bin/env python3
"""各歳・男女別人口を取得・整形・検証し、Web用 JSON と CSV を出力する。

終了コード: 0=合格, 1=検証FAIL, 2=取得失敗
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)  # python3 -I でも scripts/ 配下を import できるように

from pyramid_data import (fetch, merge, parse_census2025, parse_est, parse_lt2000,  # noqa: E402
                          verify, writers)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="data/raw を取得し直す")
    ap.add_argument("--offline", action="store_true", help="取得せず data/raw のみ使う")
    ap.add_argument("-v", "--verbose", action="store_true", help="WARN も表示")
    ap.add_argument("--root", default=ROOT, help="リポジトリのルート（テスト用）")
    args = ap.parse_args(argv)

    raw = os.path.join(args.root, "data", "raw")
    data = os.path.join(args.root, "data")
    lock_path = os.path.join(data, "sources.lock.json")

    try:
        lock = fetch.fetch_all(raw, lock_path, refresh=args.refresh, offline=args.offline)
    except fetch.FetchError as e:
        print(f"取得失敗: {e}", file=sys.stderr)
        return 2

    def p(sid):
        return os.path.join(raw, fetch.SOURCES[sid]["file"])

    tables = []
    partial_missing = []
    try:
        from pyramid_data import parse_lt1920
        tables += parse_lt1920.parse(p("lt1920"))
    except ImportError:
        partial_missing.append("lt1920")
        print("警告: parse_lt1920 が見つからないため lt1920 の年（1920–1999）を除いて処理します", file=sys.stderr)
    tables += parse_lt2000.parse(p("lt2000"))
    for y in (2021, 2022, 2023, 2024):
        tables += parse_est.parse(p(f"est{y}"))
    tables += parse_census2025.parse(p("census2025"))

    chosen, by_key = merge.merge(tables, allow_missing_sources=partial_missing)
    doc = writers.build_document(chosen, lock)
    with open(os.path.join(data, "schema", "pyramid.schema.json"), encoding="utf-8") as f:
        schema = json.load(f)
    rep = verify.verify(doc, chosen, by_key, schema, partial_missing)
    report = verify.to_report(rep, doc)
    writers.write_report(report, data)
    writers.write_all(doc, data)

    print(f"検証: {report['result']}（FAIL {report['counts']['FAIL']} / WARN {report['counts']['WARN']}）")
    for f in report["findings"]:
        if f["level"] == "FAIL" or args.verbose:
            print(f"  [{f['level']}] {f['check']} {f.get('year', '')} {f['message']}")
    return 1 if report["counts"]["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
