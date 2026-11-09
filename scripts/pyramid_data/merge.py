"""年ごとに source_id が year_meta と一致する表を採用して 103 年分にまとめる。"""
from __future__ import annotations

from .model import YEARS, year_meta


class MergeError(ValueError):
    pass


def merge(tables, allow_missing_sources=()):
    """(採用した表のリスト, {(year, source_id): 表}) を返す。

    allow_missing_sources: その source_id の年が無くてもよい（部分ビルド用）。
    """
    by_key = {}
    for t in tables:
        key = (t.year, t.source_id)
        if key in by_key:
            raise MergeError(f"{t.year}年（{t.source_id}）が重複しています")
        by_key[key] = t
    chosen, missing = [], []
    for y in YEARS:
        sid = year_meta(y)["source_id"]
        if (y, sid) in by_key:
            chosen.append(by_key[(y, sid)])
        elif sid not in allow_missing_sources:
            missing.append((y, sid))
    if missing:
        raise MergeError(f"採用すべき表がありません: {missing}")
    return chosen, by_key
