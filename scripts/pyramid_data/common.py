"""パーサ共通の小さな道具。"""
from __future__ import annotations

import re
import unicodedata


class ParseError(ValueError):
    pass


def norm(v) -> str:
    """NFKC 正規化して空白をすべて除く。"""
    if v is None:
        return ""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(v)))


def age_label(v):
    """('total',None) | ('age',n) | ('open',n) | None を返す。"""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return ("age", int(v)) if float(v).is_integer() else None
    s = norm(v)
    if s == "総数":
        return ("total", None)
    m = re.fullmatch(r"(\d+)(?:歳)?(以上)?", s)
    if not m:
        return None
    return ("open" if m.group(2) else "age", int(m.group(1)))


def num(v):
    """セル値を int か None に。千人表の欠損「－」は None。"""
    if v is None:
        return None
    if isinstance(v, bool):
        raise ParseError(f"unexpected boolean {v!r}")
    if isinstance(v, (int, float)):
        if float(v) != int(v):
            raise ParseError(f"non-integer value {v!r}")
        return int(v)
    s = norm(v)
    if s in {"", "－", "-", "‐", "−", "—", "―", "…"}:
        return None
    try:
        return int(s.replace(",", ""))
    except ValueError:
        raise ParseError(f"unexpected cell {v!r}") from None


def check_meta(table, year, label_open_age, known_open_age=None):
    """表から読んだ値が year_meta と食い違えば ParseError。"""
    from .model import year_meta

    m = year_meta(year)
    pairs = {
        "ref_date": table.ref_date, "kazoe": table.kazoe, "min_age": table.min_age,
        "excludes_okinawa": table.excludes_okinawa, "basis": table.basis,
        "source_id": table.source_id, "precision": table.precision,
    }
    for k, v in pairs.items():
        if m[k] != v:
            raise ParseError(f"{year}: {k} が year_meta と食い違い: {v!r} != {m[k]!r}")
    expected = known_open_age if known_open_age is not None else m["open_age"]
    if label_open_age != expected:
        raise ParseError(f"{year}: 表の最終区分 {label_open_age}歳以上 が year_meta の {expected} と食い違い")
