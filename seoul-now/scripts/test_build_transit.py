"""build_transit.py 단위 테스트(네트워크 없음)"""
import json
import tempfile
import unittest
from pathlib import Path

import build_transit as b


def line_row(name, line, fr, en=""):
    return {"STATION_NM": name, "LINE_NUM": line, "FR_CODE": fr, "STATION_NM_ENG": en, "STATION_NM_JPN": "", "STATION_NM_CHN": ""}


def coord_row(name, line, lat, lng):
    return {"BLDN_NM": name, "ROUTE": line, "LAT": str(lat), "LOT": str(lng)}


class Norm(unittest.TestCase):
    def test_names_and_lines(self):
        self.assertEqual(b.norm_station("서울역"), "서울")
        self.assertEqual(b.norm_station("동대문역사문화공원(DDP)"), "동대문역사문화공원")
        self.assertEqual(b.norm_line("02호선"), "2호선")
        self.assertEqual(b.norm_line("경의 중앙선"), "경의중앙선")
        self.assertLess(b.code_key("211"), b.code_key("211-1"))
        self.assertLess(b.code_key("211-1"), b.code_key("212"))


class Subway(unittest.TestCase):
    def test_join_order_branch_loop_and_far_hop(self):
        lines = [line_row("시청", "02호선", "201", "City Hall"), line_row("을지로입구", "02호선", "202"),
                 line_row("을지로3가", "02호선", "203"), line_row("성수", "02호선", "211"),
                 line_row("용답", "02호선", "211-1"), line_row("충정로", "02호선", "243"),
                 line_row("없는역", "02호선", "299")]
        coords = [coord_row("시청", "2호선", 37.5657, 126.9769), coord_row("을지로입구", "2호선", 37.5660, 126.9826),
                  coord_row("을지로3가", "2호선", 37.5663, 126.9911), coord_row("성수", "2호선", 37.5446, 127.0559),
                  coord_row("용답", "2호선", 37.5619, 127.0509), coord_row("충정로", "2호선", 37.5599, 126.9637)]
        stations, edges, stats = b.build_subway(lines, coords)
        ids = {s["name"]["ko"]: s["id"] for s in stations}
        pairs = {(a, c) for a, c, _ in edges}
        self.assertEqual(stats["unmatched"], 1)
        self.assertIn((ids["시청"], ids["을지로입구"]), pairs)
        self.assertIn((ids["성수"], ids["용답"]), pairs)              # 지선
        self.assertIn((ids["충정로"], ids["시청"]), pairs)            # 2호선 순환
        self.assertNotIn((ids["을지로3가"], ids["성수"]), pairs)      # 5km 넘는 이웃(데이터 누락 구간)은 잇지 않음
        self.assertEqual(stations[0]["name"]["en"], "City Hall")

    def test_outside_seoul_and_bad_coords_skipped(self):
        stations, _, stats = b.build_subway([line_row("인천", "01호선", "161")], [coord_row("인천", "1호선", 37.47, 126.62), {"BLDN_NM": "x", "LAT": "bad"}])
        self.assertEqual(stations, [])
        self.assertEqual(stats["unmatched"], 1)


class Bus(unittest.TestCase):
    def test_breaks_outside_seoul_and_cleans(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "r1.json").write_text(json.dumps({"no": "5531", "stops": [
                [1, "군포", None, None, 1, 0], [2, "<b>노량진</b>", 37.5133, 126.9425, 1, 0], [3, "대방", 37.5134, 126.9264, 1, 0],
                [4, "안양", 37.39, 126.92, 1, 0], [5, "구로", 37.5030, 126.8820, 1, 0]]}), "utf-8")
            Path(d, "r2.json").write_text(json.dumps({"no": "1", "stops": [[1, "a", 37.55, 126.97, 0, 0]]}), "utf-8")
            Path(d, "bad.json").write_text("{", "utf-8")
            routes, stats = b.build_bus(Path(d))
        self.assertEqual(stats["routes"], 1)
        stops = routes[0]["stops"]
        self.assertEqual(stops[0][0], "노량진")
        self.assertIn(None, stops)          # 안양(서울 밖)에서 끊김
        self.assertEqual(stops[-1][0], "구로")


if __name__ == "__main__":
    unittest.main()
