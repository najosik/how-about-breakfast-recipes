"""select_tourism.py(1차 선별, 예시 기준) 단위 테스트"""
import json
import unittest
from pathlib import Path

import select_tourism as s

RULES = json.loads((Path(__file__).resolve().parent.parent / "data" / "tourism_rules.json").read_text("utf-8"))


def ev(**o):
    base = {"id": "abc123", "title": "행사", "category": "전시/미술", "district": "노원구", "start": "2026-10-01",
            "end": "2026-10-03", "free": False, "target": "성인"}
    base.update(o)
    return base


class Select(unittest.TestCase):
    def test_needs_tourism_value_and_two_points(self):
        self.assertFalse(s.judge(ev(free=True, target="누구나"), RULES, set())["pass"])     # 시민 수요만 2개
        self.assertFalse(s.judge(ev(district="중구"), RULES, set())["pass"])               # 관광 가치 1개뿐
        r = s.judge(ev(district="중구", free=True), RULES, set())
        self.assertTrue(r["pass"])
        self.assertEqual(r["tourism_value"], ["관광 밀집 자치구(중구)"])
        self.assertEqual(r["citizen_demand"], ["무료"])

    def test_recurring_and_long_run(self):
        hist = {"1": {"title": "2024 서울빛초롱축제", "start": "2024-12-13"}, "2": {"title": "2025 서울빛초롱축제", "start": "2025-12-12"}}
        rec = s.recurring_keys(hist, 2)
        r = s.judge(ev(title="2026 서울빛초롱축제", category="축제-문화/예술", start="2026-12-11", end="2027-01-18"), RULES, rec)
        self.assertIn("반복 개최(축제 이력)", r["tourism_value"])
        self.assertIn("축제 분류", r["tourism_value"])
        self.assertTrue(any(x.startswith("장기 운영") for x in r["citizen_demand"]))

    def test_overrides_exclude_beats_pin(self):
        events = [ev(id="aaa111", district="중구", free=True), ev(id="bbb222")]
        out = s.select_all(events, RULES, {"pin": ["bbb222", {"id": "aaa111"}], "exclude": ["aaa111"]}, {})
        self.assertEqual((out["aaa111"]["pass"], out["aaa111"]["override"]), (False, "exclude"))
        self.assertEqual((out["bbb222"]["pass"], out["bbb222"]["override"]), (True, "pin"))

    def test_bad_id_skipped(self):
        self.assertEqual(s.select_all([ev(id="../x")], RULES, {}, {}), {})


if __name__ == "__main__":
    unittest.main()
