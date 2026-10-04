"""archive_festivals.py · build_calendar.py 단위 테스트"""
import unittest

import archive_festivals as a
import build_calendar as b


def fest(title, start, end=None, cat="축제-문화/예술", fid=None):
    return {"id": fid or f"{abs(hash((title, start))) % 16**12:012x}", "title": title, "category": cat,
            "district": "중구", "place": "광장", "start": start, "end": end or start, "link": ""}


def row(title, start, cat="축제-문화/예술"):
    return {"TITLE": title, "STRTDATE": f"{start} 00:00:00.0", "END_DATE": f"{start} 00:00:00.0",
            "CODENAME": cat, "PLACE": "광장", "GUNAME": "중구", "ORG_LINK": "https://example.org/x"}


class Archive(unittest.TestCase):
    def test_keeps_old_and_only_festivals(self):
        old = {"aaaaaaaaaaaa": fest("2021 사라진 축제", "2021-10-10", fid="aaaaaaaaaaaa")}
        merged, added = a.merge(old, [row("2026 새 축제", "2026-05-01"), row("클래식 공연", "2026-05-01", "클래식")])
        self.assertEqual(added, 1)
        self.assertIn("aaaaaaaaaaaa", merged)
        self.assertEqual(len(merged), 2)
        new = [v for k, v in merged.items() if k != "aaaaaaaaaaaa"][0]
        self.assertEqual(set(new), set(a.KEEP))
        self.assertEqual(new["link"], "https://example.org/x")

    def test_idempotent(self):
        m1, _ = a.merge({}, [row("축제", "2026-05-01")])
        m2, added = a.merge(m1, [row("축제", "2026-05-01")])
        self.assertEqual((m1, added), (m2, 0))


class Calendar(unittest.TestCase):
    def test_series_key(self):
        self.assertEqual(b.series_key("[미래한강본부] 2026 한강페스티벌-가을[Fall]"), b.series_key("2023 한강페스티벌 가을"))
        self.assertEqual(b.series_key("제 14회 북촌우리음악축제"), b.series_key("제15회 북촌우리음악축제 2025"))
        self.assertNotEqual(b.series_key("한강페스티벌-봄"), b.series_key("한강페스티벌-가을"))
        self.assertEqual(b.display_name("[동대문문화재단] 2026 제47회 선농대제"), "선농대제")
        self.assertEqual(b.display_name("제28회 서울세계무용축제(SIDance2025)"), "서울세계무용축제(SIDance)")

    def _items(self, fs, target=2027):
        return {i["name"]: i for i in b.forecast({f["id"]: f for f in fs}, target)}

    def test_confidence_levels(self):
        fs = [fest(f"{y} 빛섬축제", f"{y}-10-0{d}") for y, d in ((2023, 6), (2024, 4), (2025, 3))]
        fs += [fest(f"{y} 들쭉날쭉 축제", s) for y, s in ((2024, "2024-04-01"), (2025, "2025-09-01"))]
        fs += [fest(f"{y} 두해 축제", s) for y, s in ((2025, "2025-05-10"), (2026, "2026-05-20"))]
        fs += [fest(f"{y} 끊긴 축제", s) for y, s in ((2022, "2022-05-10"), (2023, "2023-05-10"), (2024, "2024-05-10"))]
        fs += [fest("2027 확정 축제", "2027-03-02"), fest("2025 확정 축제", "2025-03-01")]
        fs += [fest("2026 한번 축제", "2026-06-01")]
        it = self._items(fs)
        self.assertEqual(it["빛섬축제"]["confidence"], "high")
        self.assertEqual((it["빛섬축제"]["month"], it["빛섬축제"]["part"]), (10, "early"))
        self.assertEqual(it["들쭉날쭉 축제"]["confidence"], "low")
        self.assertEqual(it["두해 축제"]["confidence"], "medium")
        self.assertNotIn("끊긴 축제", it)      # 최근 2년 미개최 → 제외
        self.assertNotIn("한번 축제", it)      # 1회만 → 제외
        self.assertEqual(it["확정 축제"]["status"], "confirmed")
        self.assertEqual(it["확정 축제"]["start"], "2027-03-02")

    def test_december_january_wrap(self):
        fs = [fest(f"{y} 윈터페스타", s, e) for y, s, e in
              ((2023, "2023-12-28", "2024-01-20"), (2024, "2025-01-03", "2025-01-20"), (2025, "2025-12-30", "2026-01-18"))]
        it = self._items(fs)["윈터페스타"]
        self.assertIn(it["month"], (12, 1))
        self.assertLessEqual(it["spread_days"], 10)

    def test_bad_rows_ignored(self):
        self.assertEqual(b.forecast({"x": "bad", "y": {"title": "t", "start": "bad"}}, 2027), [])


if __name__ == "__main__":
    unittest.main()
