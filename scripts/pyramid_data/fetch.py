"""入力Excelの取得と data/sources.lock.json の記録。"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import tempfile
import urllib.request

E_STAT = "https://www.e-stat.go.jp/stat-search/file-download?statInfId={}&fileKind={}"

SOURCES = {
    "lt1920": {
        "file": "lt1920.xlsx",
        "url": E_STAT.format("000000090264", 0),
        "title": "人口推計 長期時系列データ 我が国の推計人口（大正9年～平成12年）",
        "table": "第4表 年齢（各歳），男女別人口",
        "unitInSource": "千人",
    },
    "lt2000": {
        "file": "lt2000.xlsx",
        "url": E_STAT.format("000013168604", 4),
        "title": "人口推計 長期時系列データ 総人口・日本人人口（平成12年～令和2年）",
        "table": "第4表 年齢（各歳），男女別人口－総人口",
        "unitInSource": "千人",
    },
}
for _y in (2021, 2022, 2023, 2024):
    SOURCES[f"est{_y}"] = {
        "file": f"est{_y}.xlsx",
        "url": f"https://www.stat.go.jp/data/jinsui/{_y}np/zuhyou/05k{_y}-1.xlsx",
        "title": f"人口推計（{_y}年（令和{_y - 2018}年）10月1日現在）",
        "table": "第1表 年齢（各歳），男女別人口及び人口性比－総人口",
        "unitInSource": "千人",
    }
SOURCES["census2025"] = {
    "file": "census2025.xlsx",
    "url": E_STAT.format("000040506653", 0),
    "title": "令和7年国勢調査 人口等基本集計（不詳補完値）",
    "table": "第2－1表 男女，年齢（各歳），国籍総数か日本人別人口－全国",
    "unitInSource": "人",
}


class FetchError(RuntimeError):
    pass


def sha256_of(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "population-pyramid-build/1.0"})
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest), suffix=".part")
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(req, timeout=120) as resp:
            shutil.copyfileobj(resp, out)
        with open(tmp, "rb") as f:
            magic = f.read(2)
        if magic != b"PK":
            raise FetchError(f"xlsx ではない応答です（先頭2バイトが PK でない）: {url}")
        os.replace(tmp, dest)
    except FetchError:
        raise
    except Exception as e:  # ネットワーク系の失敗はまとめて取得失敗にする
        raise FetchError(f"取得に失敗しました: {url}: {e}") from e
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_lock(lock_path) -> dict:
    if os.path.exists(lock_path):
        with open(lock_path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def fetch_all(raw_dir, lock_path, refresh=False, offline=False, today=None, log=print) -> dict:
    """全ソースを data/raw に揃え、ロックを更新して返す。"""
    os.makedirs(raw_dir, exist_ok=True)
    today = today or datetime.date.today().isoformat()
    old = read_lock(lock_path)
    lock = {}
    for sid, src in SOURCES.items():
        path = os.path.join(raw_dir, src["file"])
        have = os.path.exists(path)
        if (refresh and not offline) or not have:
            if offline:
                raise FetchError(f"--offline ですが {path} がありません")
            log(f"取得: {sid} <- {src['url']}")
            _download(src["url"], path)
            fetched = True
        else:
            fetched = False
        with open(path, "rb") as f:
            if f.read(2) != b"PK":
                raise FetchError(f"{path} は xlsx ではありません（先頭2バイトが PK でない）")
        digest = sha256_of(path)
        prev = old.get(sid, {})
        retrieved = today if fetched or prev.get("sha256") != digest else prev.get("retrieved", today)
        lock[sid] = {"file": src["file"], "url": src["url"], "sha256": digest, "retrieved": retrieved}
    write_lock(lock_path, lock)
    return lock


def write_lock(lock_path, lock: dict) -> None:
    text = json.dumps(lock, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    old = None
    if os.path.exists(lock_path):
        with open(lock_path, encoding="utf-8") as f:
            old = f.read()
    if old != text:
        with open(lock_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
