"""PLAN.md §3 の notes 表（文言・appliesTo はそのまま）。"""
from __future__ import annotations

KIND_ORDER = ["callout", "badge", "footnote"]  # timeline は noteIds に含めない

# 定義順が「同 kind 内の順」になる
NOTES = {
    "open-85": {"kind": "callout", "short": "85歳以上",
                "text": "1920〜1944年と1947〜1979年は、85歳以上の人口をまとめて「85」の行に表示しています。",
                "appliesTo": [[1920, 1940], [1944, 1944], [1947, 1979]]},
    "open-86": {"kind": "callout", "short": "86歳以上",
                "text": "1945・1946年は、数え年86歳以上の人口をまとめて「86」の行に表示しています。",
                "appliesTo": [[1945, 1946]]},
    "open-90": {"kind": "callout", "short": "90歳以上",
                "text": "1980〜1999年は、90歳以上の人口をまとめて「90」の行に表示しています。",
                "appliesTo": [[1980, 1999]]},
    "open-100": {"kind": "callout", "short": "100歳以上",
                 "text": "2000年以降は、100歳以上の人口をまとめて「100」の行に表示しています。",
                 "appliesTo": [[2000, 2025]]},
    "kazoe": {"kind": "badge", "short": "数え年",
              "text": "1944〜1946年の年齢は数え年（生まれた年を1歳とし、正月ごとに1歳を加える数え方）です。0歳の区分がなく、満年齢より1〜2歳高く表示されます。調査日も1944年2月22日、1945年11月1日、1946年4月26日と異なります。",
              "appliesTo": [[1944, 1946]]},
    "no-okinawa": {"kind": "badge", "short": "沖縄県を含まない",
                   "text": "1945〜1971年の人口は沖縄県を含みません。",
                   "appliesTo": [[1945, 1971]]},
    "est-base-2020": {"kind": "footnote", "short": "2020年国勢調査基準",
                      "text": "2021〜2024年は令和2年国勢調査を基準とする推計人口で、2025年国勢調査による補正前の値です。",
                      "appliesTo": [[2021, 2024]]},
    "unknown-age": {"kind": "footnote", "short": "年齢不詳を除く",
                    "text": "2025年は年齢「不詳」の男565人・女506人を図に含めていません（総人口には含みます）。",
                    "appliesTo": [[2025, 2025]]},
    "gap-1941-1943": {"kind": "timeline", "short": "推計なし",
                      "text": "1941〜1943年は年齢別の人口推計が行われていないため、表示していません。",
                      "appliesTo": [[1941, 1943]]},
}

GAPS = [{"start": 1941, "end": 1943, "noteId": "gap-1941-1943"}]


def applies(note_id: str, year: int) -> bool:
    return any(a <= year <= b for a, b in NOTES[note_id]["appliesTo"])


def note_ids_for(year: int) -> list:
    order = {k: i for i, k in enumerate(KIND_ORDER)}
    ids = [n for n, d in NOTES.items() if d["kind"] in order and applies(n, year)]
    pos = {n: i for i, n in enumerate(NOTES)}
    return sorted(ids, key=lambda n: (order[NOTES[n]["kind"]], pos[n]))
