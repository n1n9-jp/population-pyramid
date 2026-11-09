"""pyramid.json / CSV / build_report.json の書き出し（バイト単位で決定的）。"""
from __future__ import annotations

import csv
import io
import json
import math
import os

from .fetch import SOURCES
from .model import AGE_MAX
from .notes import GAPS, NOTES, note_ids_for

BASIS_LABELS = {"census": "国勢調査", "survey": "人口調査", "intercensal": "補間補正人口", "estimate": "推計人口"}
ATTRIBUTION = "出典：総務省統計局「人口推計」「令和7年国勢調査」（e-Stat）を加工して作成"
X_STEP = 250000


def build_document(tables, lock) -> dict:
    max_v = max(v for t in tables for s in (t.male, t.female) for v in s if v is not None)
    sources = {}
    for sid, src in SOURCES.items():
        d = {"title": src["title"], "table": src["table"], "url": src["url"], "unitInSource": src["unitInSource"]}
        if sid in lock:
            d["sha256"] = lock[sid]["sha256"]
            d["retrieved"] = lock[sid]["retrieved"]
        sources[sid] = d
    years = []
    for t in tables:
        years.append({
            "year": t.year, "refDate": t.ref_date, "kazoe": t.kazoe, "minAge": t.min_age,
            "openAge": t.open_age, "excludesOkinawa": t.excludes_okinawa, "basis": t.basis,
            "sourceId": t.source_id, "precision": t.precision,
            "total": {"male": t.total_male, "female": t.total_female, "both": t.total_both},
            "unknownAge": {"male": t.unknown_male, "female": t.unknown_female},
            "noteIds": note_ids_for(t.year),
            "male": list(t.male), "female": list(t.female),
        })
    return {
        "schemaVersion": 1, "fixture": False, "unit": "person", "ageMax": AGE_MAX,
        "yearMin": 1920, "yearMax": 2025,
        "xMaxPerSex": math.ceil(max_v / X_STEP) * X_STEP,
        "gaps": [dict(g) for g in GAPS],
        "basisLabels": dict(BASIS_LABELS), "attribution": ATTRIBUTION,
        "sources": sources,
        "notes": {k: {"kind": v["kind"], "short": v["short"], "text": v["text"],
                      "appliesTo": [list(a) for a in v["appliesTo"]]} for k, v in NOTES.items()},
        "years": years,
    }


def dumps_json(doc) -> str:
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"


def _csv_text(header, rows) -> str:
    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def age_csv(doc) -> str:
    rows = []
    for y in doc["years"]:
        for sex in ("male", "female"):
            for age, v in enumerate(y[sex]):
                if v is None:
                    continue
                is_open = age == y["openAge"]
                rows.append([
                    y["year"], y["refDate"], str(y["kazoe"]).lower(), age, str(is_open).lower(),
                    f"{age}歳以上" if is_open else f"{age}歳", sex, v, y["precision"],
                    str(y["excludesOkinawa"]).lower(), y["basis"], y["sourceId"],
                ])
    return _csv_text("year,ref_date,kazoe,age,is_open,age_label,sex,population,precision,excludes_okinawa,basis,source_id".split(","), rows)


def totals_csv(doc) -> str:
    rows = []
    for y in doc["years"]:
        u = y["unknownAge"]
        for sex, unk in (("male", u["male"]), ("female", u["female"]), ("both", u["male"] + u["female"])):
            rows.append([y["year"], y["refDate"], sex, y["total"][sex], unk, y["sourceId"]])
    return _csv_text("year,ref_date,sex,total,unknown_age,source_id".split(","), rows)


def _write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def write_all(doc, data_dir):
    os.makedirs(data_dir, exist_ok=True)
    _write(os.path.join(data_dir, "pyramid.json"), dumps_json(doc))
    _write(os.path.join(data_dir, "population_by_age.csv"), age_csv(doc))
    _write(os.path.join(data_dir, "population_totals.csv"), totals_csv(doc))


def write_report(report, data_dir):
    os.makedirs(data_dir, exist_ok=True)
    _write(os.path.join(data_dir, "build_report.json"),
           json.dumps(report, ensure_ascii=False, indent=1) + "\n")
