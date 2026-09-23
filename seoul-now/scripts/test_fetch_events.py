"""python -m unittest discover -s scripts"""
import unittest
from datetime import date
from unittest import mock

import fetch_events as fe


def row(**kw):
    base = {
        "TITLE": "테스트 공연", "CODENAME": "콘서트", "GUNAME": "종로구",
        "STRTDATE": "2026-09-20 00:00:00.0", "END_DATE": "2026-09-30 00:00:00.0",
        "PLACE": "세종문화회관", "IS_FREE": "무료", "LAT": "37.57", "LOT": "126.97",
    }
    base.update(kw)
    return base


class NormalizeTest(unittest.TestCase):
    def test_basic(self):
        ev = fe.normalize(row())
        self.assertEqual(ev["start"], "2026-09-20")
        self.assertEqual(ev["end"], "2026-09-30")
        self.assertTrue(ev["free"])
        self.assertEqual((ev["lat"], ev["lng"]), (37.57, 126.97))

    def test_swapped_coords(self):
        ev = fe.normalize(row(LAT="126.97", LOT="37.57"))
        self.assertEqual((ev["lat"], ev["lng"]), (37.57, 126.97))

    def test_strips_markup(self):
        ev = fe.normalize(row(TITLE="<script>alert(1)</script>공연 &amp; 축제"))
        self.assertNotIn("<", ev["title"])
        self.assertIn("공연 & 축제", ev["title"])

    def test_rejects_dangerous_urls(self):
        ev = fe.normalize(row(ORG_LINK="javascript:alert(1)", HMPG_ADDR="data:text/html,x",
                              MAIN_IMG="http://culture.seoul.go.kr/a.jpg"))
        self.assertEqual(ev["link"], "")
        self.assertEqual(ev["homepage"], "")
        self.assertEqual(ev["image"], "https://culture.seoul.go.kr/a.jpg")

    def test_missing_required(self):
        self.assertIsNone(fe.normalize(row(TITLE="")))
        self.assertIsNone(fe.normalize(row(STRTDATE="bad")))

    def test_end_before_start(self):
        ev = fe.normalize(row(END_DATE="2026-01-01"))
        self.assertEqual(ev["end"], ev["start"])


class ExtractTest(unittest.TestCase):
    def test_error_code(self):
        with self.assertRaises(fe.FetchError):
            fe.extract({"RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키 오류"}})

    def test_ok(self):
        total, rows = fe.extract({"culturalEventInfo": {
            "list_total_count": 1, "RESULT": {"CODE": "INFO-000"}, "row": [row()]}})
        self.assertEqual((total, len(rows)), (1, 1))


class SecretHandlingTest(unittest.TestCase):
    def test_error_message_has_no_key(self):
        key = "SECRETKEY1234567890"
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError), \
                mock.patch("time.sleep"):
            with self.assertRaises(fe.FetchError) as cm:
                fe.fetch_page(key, 1, 10)
        self.assertNotIn(key, str(cm.exception))

    def test_collect_filters_past(self):
        payload = {"culturalEventInfo": {"list_total_count": 2, "RESULT": {"CODE": "INFO-000"},
                   "row": [row(), row(TITLE="지난 행사", STRTDATE="2020-01-01", END_DATE="2020-01-02")]}}
        with mock.patch.object(fe, "fetch_page", return_value=payload):
            events = fe.collect("x", date(2026, 9, 23))
        self.assertEqual([e["title"] for e in events], ["테스트 공연"])


if __name__ == "__main__":
    unittest.main()
