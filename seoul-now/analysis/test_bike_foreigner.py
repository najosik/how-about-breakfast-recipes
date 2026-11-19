"""python3 -m unittest discover -s seoul-now/analysis"""
import json
import unittest
from pathlib import Path

import bike_foreigner as bk
import bus_foreigner as bf

DATA = Path(__file__).resolve().parent.parent / "bus" / "data"


def square(code, name, x0, y0):
    ring = [[x0, y0], [x0 + 1, y0], [x0 + 1, y0 + 1], [x0, y0 + 1], [x0, y0]]
    return {"properties": {"code": code, "name": name}, "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]}}


GJ = {"features": [square("11110001", "종로구 A동", 126.0, 37.0), square("11140002", "중구 B동", 127.0, 37.0),
                   square("26000000", "부산", 128.0, 37.0)]}
HOURLY = {"month": "202607", "dongs": {
    "11110001": {"all": {"f": [10] * 24, "l": [90] * 24}},
    "11140002": {"all": {"f": [0] * 24, "l": [100] * 24}},
    "11999999": {"all": {"f": [1] * 3, "l": [1] * 3}}}}   # 길이 불량 → 무시


class BikeTest(unittest.TestCase):
    def test_station_no(self):
        self.assertEqual(bk.station_no("00108"), "108")
        self.assertEqual(bk.station_no(" 731 "), "731")
        self.assertEqual(bk.station_no("ST-10"), "")
        self.assertEqual(bk.station_no("<b>"), "")

    def test_shares(self):
        sh = bk.dong_shares(HOURLY)
        self.assertAlmostEqual(sh["11110001"], 0.1)
        self.assertEqual(sh["11140002"], 0.0)
        self.assertNotIn("11999999", sh)

    def test_aggregate_drops_demographics(self):
        rows = [{"STATION_NO": "00108", "RENT_TYPE": "정기권", "GENDER_CD": "M", "AGE_TYPE": "20대", "USE_CNT": "6"},
                {"STATION_NO": "108", "RENT_TYPE": "일일권(비회원)", "GENDER_CD": "", "AGE_TYPE": "기타", "USE_CNT": "4"},
                {"STATION_NO": "x", "USE_CNT": "99"}]
        u = bk.aggregate_use(rows)
        self.assertEqual(dict(u["108"]), {"use": 10.0, "day": 4.0})
        self.assertEqual(len(u), 1)

    def test_compute_merge(self):
        idx = bk.dong_index_from_geojson(GJ)
        self.assertEqual(len(idx.items), 2)   # 서울 밖 제외
        st = bk.parse_stations([
            {"RENT_NO": "00001", "RENT_NM": "<b>가</b>", "STA_LOC": "종로구", "STA_LAT": "37.5", "STA_LONG": "126.6"},
            {"RENT_NO": "00002", "RENT_NM": "나", "STA_LOC": "중구", "STA_LAT": "37.5", "STA_LONG": "127.4"},
            {"RENT_NO": "00003", "RENT_NM": "밖", "STA_LOC": "?", "STA_LAT": "35.1", "STA_LONG": "129.0"}])
        self.assertEqual([s["no"] for s in st], ["1", "2"])
        self.assertNotIn("<", st[0]["name"])
        use = {"1": 100.0, "2": 50.0}
        rows, stats = bk.compute(st, use, idx, bk.dong_shares(HOURLY), {"1": 0.2})
        self.assertEqual(rows[0]["no"], "1")
        self.assertAlmostEqual(rows[0]["foreign"], 10.0)
        self.assertAlmostEqual(rows[0]["local"], 90.0)
        self.assertEqual(rows[0]["dayPass"], 0.2)
        self.assertIsNone(rows[1]["dayPass"])
        self.assertEqual(stats["matchRate"], 1.0)
        self.assertEqual(stats["foreign"], 10)
        rows2, _ = bk.compute(st, use, idx, bk.dong_shares(HOURLY))
        self.assertIsNone(rows2[0]["dayPass"])

    def test_station_use_by_name_number(self):
        u = bk.station_use([{"stationName": "108. 서교동 사거리", "rentCnt": "1216"},
                            {"stationName": "00108. 중복", "rentCnt": "4"},
                            {"stationName": "번호없음", "rentCnt": "9"}])
        self.assertEqual(u, {"108": 1220.0})

    def test_day_pass_budget(self):
        class Api:
            def all_rows(self, *a, **k):
                for i in range(20000):
                    yield {"STATION_NO": "1", "RENT_TYPE": "일일권", "USE_CNT": "1"}
        self.assertIsNone(bk.day_pass_ratio(Api(), "202607", budget=-1))
        self.assertEqual(bk.day_pass_ratio(Api(), "202607", budget=60), {"1": 1.0})

    def test_real_boundary_locates_myeongdong(self):
        if not (DATA / "dongs.geojson").exists():
            self.skipTest("no data")
        idx = bk.dong_index_from_geojson(json.loads((DATA / "dongs.geojson").read_text("utf-8")))
        self.assertEqual(idx.locate(126.9850, 37.5636)[1], "중구 명동")


if __name__ == "__main__":
    unittest.main()
