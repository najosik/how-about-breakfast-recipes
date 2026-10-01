"""python3 -m unittest discover -s seoul-now/analysis"""
import unittest
from unittest import mock

import bus_foreigner as bf

SQUARE_A = [[[126.0, 37.0], [127.0, 37.0], [127.0, 38.0], [126.0, 38.0], [126.0, 37.0]]]
SQUARE_B = [[[127.0, 37.0], [128.0, 37.0], [128.0, 38.0], [127.0, 38.0], [127.0, 37.0]]]


def feature(code, name, rings):
    return {"properties": {"adm_cd2": code + "00", "adm_nm": "서울특별시 " + name},
            "geometry": {"type": "MultiPolygon", "coordinates": [rings]}}


DONGS = bf.DongIndex([feature("11110001", "종로구 A동", SQUARE_A), feature("11140002", "중구 B동", SQUARE_B),
                      feature("26000000", "부산", SQUARE_A)])


def bus_row(rno, sid, hour, on, off):
    r = {"RTE_NO": rno, "RTE_NM": f"{rno}번", "STOPS_ID": sid, "STOPS_ARS_NO": "01001",
         "SBWY_STNS_NM": "정류장" + sid, "TRFC_MNS_TYPE_NM": "간선"}
    suffix = "NOPE" if hour == 1 else "TNOPE"
    r[f"HR_{hour}_GET_ON_{suffix}"] = on
    r[f"HR_{hour}_GET_OFF_{suffix}"] = off
    return r


class SpatialTest(unittest.TestCase):
    def test_locate(self):
        self.assertEqual(DONGS.locate(126.5, 37.5), ("11110001", "종로구 A동"))
        self.assertEqual(DONGS.locate(127.5, 37.5), ("11140002", "중구 B동"))
        self.assertEqual(DONGS.locate(125.0, 37.5), (None, None))

    def test_non_seoul_excluded(self):
        self.assertEqual(len(DONGS.items), 2)

    def test_hole(self):
        hole = [[126.4, 37.4], [126.6, 37.4], [126.6, 37.6], [126.4, 37.6], [126.4, 37.4]]
        idx = bf.DongIndex([feature("11110001", "A", SQUARE_A + [hole])])
        self.assertEqual(idx.locate(126.5, 37.5), (None, None))
        self.assertEqual(idx.locate(126.2, 37.2)[0], "11110001")


class ValueTest(unittest.TestCase):
    def test_hour_field_quirk(self):
        self.assertEqual(bf.hour_value(bus_row("1", "s", 1, 5, 7), 1, "ON"), 5)
        self.assertEqual(bf.hour_value(bus_row("1", "s", 9, 3, 4), 9, "OFF"), 4)
        self.assertEqual(bf.hour_value({}, 9, "OFF"), 0)

    def test_num_rejects_bad(self):
        self.assertEqual(bf.num("abc"), 0); self.assertEqual(bf.num(-3), 0); self.assertEqual(bf.num("nan"), 0)

    def test_month_days(self):
        self.assertEqual(len(bf.month_days("202602")), 28)
        self.assertEqual(bf.month_days("202607")[-1], "20260731")


class ComputeTest(unittest.TestCase):
    def setUp(self):
        # A동 10시: 외국인 20, 내국인 80 → 20%; B동 10시: 외국인 0 → 0%
        self.pop = {("11110001", 10): [20.0, 5.0, 15.0, 80.0], ("11140002", 10): [0.0, 0.0, 0.0, 100.0]}
        self.xy = {"sA": (126.5, 37.5), "sB": (127.5, 37.5)}

    def test_exposure_and_index(self):
        rows = [bus_row("100", "sA", 10, 60, 40), bus_row("100", "sB", 10, 50, 50),
                bus_row("200", "sB", 10, 100, 0)]
        routes, used, matched, names = bf.compute(rows, self.xy, DONGS, self.pop)
        r100 = routes["100"]
        self.assertEqual(r100["use"], 200)
        self.assertAlmostEqual(r100["exp"], 100 * 0.2)
        self.assertAlmostEqual(r100["expChina"], 100 * 0.05)
        self.assertEqual(routes["200"]["exp"], 0)
        out = bf.summarize(routes, used, matched, names, self.pop, "202607", 31, 0)
        self.assertEqual(out["routes"][0]["no"], "100")
        self.assertAlmostEqual(out["cityIndex"], 20 / 300, places=4)
        self.assertEqual(out["stats"]["matchRate"], 1.0)
        self.assertEqual(out["topDongs"][0]["name"], "종로구 A동")

    def test_unmatched_stop_counts_use_not_exposure(self):
        rows = [bus_row("100", "sX", 10, 10, 0)]
        routes, used, matched, _ = bf.compute(rows, self.xy, DONGS, self.pop)
        self.assertEqual(routes["100"]["use"], 10)
        self.assertEqual(routes["100"]["exp"], 0)
        self.assertEqual(len(matched), 0)

    def test_markup_stripped(self):
        rows = [bus_row("<b>9</b>", "sA", 10, 1, 0)]
        routes, *_ = bf.compute(rows, self.xy, DONGS, self.pop)
        self.assertIn("9", routes)


class SecurityTest(unittest.TestCase):
    def test_bad_key_rejected(self):
        with self.assertRaises(bf.FetchError):
            bf.SeoulApi("bad key!")

    def test_error_has_no_key(self):
        key = "SECRETKEY1234567890"
        api = bf.SeoulApi(key)
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError), mock.patch("time.sleep"):
            with self.assertRaises(bf.FetchError) as cm:
                api.page("CardBusTimeNew", 1, 10, "202607")
        self.assertNotIn(key, str(cm.exception))

    def test_boundary_hash_enforced(self):
        with mock.patch.object(bf, "http_get", return_value=b'{"features": []}'):
            with self.assertRaises(bf.FetchError):
                bf.load_boundary()

    def test_target_month_validated(self):
        with self.assertRaises(bf.FetchError):
            bf.pick_month(None, None, "2026-07")


if __name__ == "__main__":
    unittest.main()
