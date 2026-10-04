"""event_history.py 단위 테스트: python3 -m unittest discover -s seoul-now/analysis -p 'test_event_history.py'"""
import unittest

import event_history as h


def row(title, start, end=None, cat="축제-문화/예술", reg="2025-01-01"):
    return {"TITLE": title, "STRTDATE": f"{start} 00:00:00.0", "END_DATE": f"{end or start} 00:00:00.0",
            "CODENAME": cat, "RGSTDATE": reg}


class History(unittest.TestCase):
    def test_title_key_groups_years_and_rounds(self):
        self.assertEqual(h.title_key("2024 서울 빛초롱 축제"), h.title_key("제16회 서울빛초롱축제 2025년"))
        self.assertNotEqual(h.title_key("서울 빛초롱 축제"), h.title_key("한강 불꽃 축제"))

    def test_summarize_counts_and_recurring(self):
        rows = [row("2024 서울 빛초롱 축제", "2024-12-13", "2025-01-05"),
                row("2025 서울 빛초롱 축제", "2025-12-12", "2026-01-04"),
                row("단발 축제", "2025-05-01"),
                row("클래식 공연", "2025-05-02", cat="클래식"),
                row("깨진 데이터", "bad")]
        s = h.summarize(rows)
        self.assertEqual(s["by_year"], {"2024": 1, "2025": 3})
        self.assertEqual(s["festivals_by_year"], {"2024": 1, "2025": 2})
        self.assertEqual(s["recurring_count"], 1)
        self.assertEqual(list(s["recurring"][0]["dates"]), ["2024", "2025"])
        self.assertEqual((s["earliest"], s["latest"]), ("2024-12-13", "2025-12-12"))

    def test_markdown_is_safe(self):
        rows = [row("::set-output name=x::| `evil` <b>x</b>\n축제", "2024-05-01"),
                row("::set-output name=x::| `evil` <b>x</b>\n축제", "2025-05-01")]
        md = h.to_markdown(2, h.summarize(rows), "now")
        line = [l for l in md.splitlines() if "set-output" in l][0]
        self.assertNotIn("::", line)
        self.assertNotIn("`", line)
        self.assertNotIn("<b>", line)
        self.assertEqual(line.count("|"), 4)   # 표 칸이 깨지지 않음


if __name__ == "__main__":
    unittest.main()
