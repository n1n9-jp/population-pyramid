"""fetch_all が sources.lock.json の知らないキーを残すことの確認。"""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from pyramid_data import fetch  # noqa: E402


class LockKeepsUnknownKeys(unittest.TestCase):
    def test_unknown_keys_survive(self):
        with tempfile.TemporaryDirectory() as d:
            rd, lock_path = os.path.join(d, "raw"), os.path.join(d, "lock.json")
            os.makedirs(rd)
            for src in fetch.SOURCES.values():
                with open(os.path.join(rd, src["file"]), "wb") as f:
                    f.write(b"PK-test-" + src["file"].encode())
            extra = {"file": "census_ts3.xlsx", "url": "u", "sha256": "abc", "retrieved": "2026-01-01"}
            with open(lock_path, "w", encoding="utf-8") as f:
                json.dump({"census_ts3": extra}, f)
            ret = fetch.fetch_all(rd, lock_path, offline=True, today="2026-01-01", log=lambda *_: None)
            self.assertNotIn("census_ts3", ret)
            with open(lock_path, encoding="utf-8") as f:
                saved = json.load(f)
            self.assertEqual(saved["census_ts3"], extra)
            self.assertTrue(set(fetch.SOURCES) <= set(saved))


if __name__ == "__main__":
    unittest.main()
