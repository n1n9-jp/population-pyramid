import os
import unittest

from scripts.pyramid_data.model import AGE_MAX, year_meta
from scripts.pyramid_data.parse_lt1920 import TABLE_OPEN_AGE

RAW = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw", "lt1920.xlsx")
EXPECTED_YEARS = list(range(1920, 1941)) + list(range(1944, 2001))


@unittest.skipUnless(os.path.exists(RAW), "data/raw/lt1920.xlsx not downloaded")
class TestParseLt1920(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from scripts.pyramid_data.parse_lt1920 import parse
        cls.tables = parse(RAW)
        cls.by_year = {t.year: t for t in cls.tables}

    def test_years(self):
        self.assertEqual([t.year for t in self.tables], EXPECTED_YEARS)
        self.assertEqual(len(self.tables), 78)

    def test_1920_totals(self):
        t = self.by_year[1920]
        self.assertEqual(t.total_male, 28044000)
        self.assertEqual(t.total_female, 27919000)
        self.assertEqual(t.total_both, 55963000)

    def test_meta_and_nulls(self):
        for t in self.tables:
            m = year_meta(t.year)
            with self.subTest(year=t.year):
                for k in ("ref_date", "kazoe", "min_age", "excludes_okinawa", "basis", "precision"):
                    self.assertEqual(getattr(t, k), m[k], k)
                self.assertEqual(t.open_age, TABLE_OPEN_AGE.get(t.year, m["open_age"]))
                if t.year < 2000:
                    self.assertEqual(t.source_id, m["source_id"])
                for arr in (t.male, t.female):
                    self.assertEqual(len(arr), AGE_MAX + 1)
                    for a, v in enumerate(arr):
                        if a < t.min_age or a > t.open_age:
                            self.assertIsNone(v, a)
                        else:
                            self.assertIsInstance(v, int, a)
                            self.assertGreaterEqual(v, 0)
                self.assertTrue(t.sheet)
                self.assertTrue(t.raw_notes)

    def test_sum_matches_total(self):
        for t in self.tables:
            n = t.open_age - t.min_age + 1
            tol = 0.5 * (n + 1) * 1000
            with self.subTest(year=t.year):
                self.assertLessEqual(abs(sum(t.male[t.min_age:t.open_age + 1]) - t.total_male), tol)
                self.assertLessEqual(abs(sum(t.female[t.min_age:t.open_age + 1]) - t.total_female), tol)

    def test_both_matches_male_plus_female(self):
        for t in self.tables:
            for a in range(t.min_age, t.open_age + 1):
                with self.subTest(year=t.year, age=a):
                    self.assertLessEqual(abs(t.male[a] + t.female[a] - t.both_by_age[a]), 1000)

    def test_1945(self):
        t = self.by_year[1945]
        self.assertEqual((t.min_age, t.open_age, t.kazoe), (1, 86, True))
        self.assertIsNone(t.male[0])
        self.assertEqual(t.male[86], 26000)
        self.assertEqual(t.female[86], 58000)
        self.assertEqual(t.male[85], 8000)

    def test_1944_kazoe(self):
        t = self.by_year[1944]
        self.assertEqual((t.min_age, t.open_age), (1, 85))
        self.assertEqual(t.ref_date, "1944-02-22")

    def test_open_ages(self):
        self.assertEqual(self.by_year[1979].open_age, 85)
        self.assertEqual(self.by_year[1980].open_age, 90)
        self.assertEqual(self.by_year[1946].open_age, 86)
        self.assertEqual(self.by_year[1947].open_age, 85)
        self.assertEqual(self.by_year[1950].open_age, 85)
        self.assertEqual([self.by_year[y].open_age for y in range(1951, 1956)], [80, 79, 80, 80, 85])
        self.assertEqual(self.by_year[2000].open_age, 90)
        self.assertEqual(self.by_year[2000].source_id, "lt1920")


if __name__ == "__main__":
    unittest.main()
