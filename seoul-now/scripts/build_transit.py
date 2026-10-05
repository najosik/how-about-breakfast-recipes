#!/usr/bin/env python3
"""대중교통 경로 계산용 노선망 → data/transit_network.json (컨시어지 오프라인 경로 엔진 입력)

- 지하철: 서울 열린데이터광장 API(SEOUL_API_KEY)
    SearchSTNBySubwayLineInfo  역코드·노선·외부코드(FR_CODE, 역 순서)·다국어 역명
    subwayStationMaster        역 좌표(LAT/LOT)
  두 결과를 노선+역명으로 맞춘 뒤, 노선마다 외부코드 순으로 이웃 역을 잇는다(지선은 거리로 판별).
- 버스: 버스 분석 결과(bus/data/routes/*.json)의 노선별 정류장 순서·좌표를 그대로 쓴다.
- 소요시간은 거리 기반 추정치다(실시간·시간표 아님). 출력에 estimated=true로 표시한다.
- API 키는 출력·로그에 넣지 않는다. 원문은 태그 제거·길이 제한만 한다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import fetch_events as fe   # fetch_page 재시도·오류 처리, clean_text, KST, write_atomic 재사용

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "transit_network.json"
ROUTES_DIR = ROOT / "bus" / "data" / "routes"
SEOUL_BOX = (37.40, 37.72, 126.76, 127.20)
MAX_SUBWAY_HOP_KM = 4.5     # 외부코드상 이웃이라도 이보다 멀면 잇지 않음(지선 시작점 등)


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def in_seoul(lat, lng) -> bool:
    return lat is not None and lng is not None and SEOUL_BOX[0] <= lat <= SEOUL_BOX[1] and SEOUL_BOX[2] <= lng <= SEOUL_BOX[3]


def norm_station(name: str) -> str:
    s = re.sub(r"\([^)]*\)", "", str(name or ""))
    s = re.sub(r"\s+", "", s)
    return s[:-1] if s.endswith("역") and len(s) > 2 else s


def norm_line(line: str) -> str:
    """'01호선' / '1호선' → '1호선'. 그 밖(경의중앙선 등)은 공백만 제거."""
    s = re.sub(r"\s+", "", str(line or ""))
    m = re.fullmatch(r"0*(\d+)호선", s)
    return f"{m.group(1)}호선" if m else s


def field(row: dict, *names: str) -> str:
    for n in names:
        if row.get(n) not in (None, ""):
            return str(row[n])
    return ""


def fetch_all(key: str, service: str) -> list[dict]:
    def page(s, e):
        url_service = fe.SERVICE
        fe.SERVICE = service
        try:
            return fe.extract(fe.fetch_page(key, s, e))
        finally:
            fe.SERVICE = url_service
    total, rows = page(1, fe.PAGE_SIZE)
    for p in range(2, min(fe.MAX_PAGES, (total + fe.PAGE_SIZE - 1) // fe.PAGE_SIZE) + 1):
        s = (p - 1) * fe.PAGE_SIZE + 1
        rows += page(s, s + fe.PAGE_SIZE - 1)[1]
    return rows


def code_key(fr: str) -> tuple:
    """외부코드 정렬키: '211' < '211-1' < '212', 'K110' 등 접두 문자 허용."""
    m = re.fullmatch(r"([A-Za-z]*)(\d+)(?:-(\d+))?", fr.strip())
    if not m:
        return ("~", 0, 0)
    return (m.group(1).upper(), int(m.group(2)), int(m.group(3) or 0))


def build_subway(line_rows: list[dict], coord_rows: list[dict]) -> tuple[list[dict], list[list], dict]:
    coords: dict[tuple[str, str], tuple[float, float]] = {}
    by_name: dict[str, tuple[float, float]] = {}
    for r in coord_rows:
        try:
            lat, lng = float(field(r, "LAT", "lat")), float(field(r, "LOT", "LNG", "lng"))
        except ValueError:
            continue
        if not in_seoul(lat, lng):
            continue
        name, line = norm_station(field(r, "BLDN_NM", "STATN_NM")), norm_line(field(r, "ROUTE", "LINE_NUM"))
        coords[(line, name)] = (round(lat, 6), round(lng, 6))
        by_name.setdefault(name, (round(lat, 6), round(lng, 6)))

    stations, unmatched = [], 0
    for r in line_rows:
        name_ko = fe.clean_text(field(r, "STATION_NM"), 40)
        line = norm_line(field(r, "LINE_NUM"))
        fr = fe.clean_text(field(r, "FR_CODE"), 12)
        if not name_ko or not line:
            continue
        xy = coords.get((line, norm_station(name_ko))) or by_name.get(norm_station(name_ko))
        if not xy:
            unmatched += 1
            continue
        stations.append({
            "id": f"s:{line}:{norm_station(name_ko)}", "line": line, "fr": fr, "lat": xy[0], "lng": xy[1],
            "name": {"ko": norm_station(name_ko), "en": fe.clean_text(field(r, "STATION_NM_ENG"), 60),
                     "ja": fe.clean_text(field(r, "STATION_NM_JPN"), 40), "zh": fe.clean_text(field(r, "STATION_NM_CHN"), 40)},
        })
    seen, uniq = set(), []
    for s in stations:
        if s["id"] not in seen:
            seen.add(s["id"])
            uniq.append(s)

    edges = []
    lines: dict[str, list[dict]] = {}
    for s in uniq:
        lines.setdefault(s["line"], []).append(s)
    for line, sts in lines.items():
        sts.sort(key=lambda s: code_key(s["fr"]))
        mains = [s for s in sts if code_key(s["fr"])[2] == 0]
        for a, b in zip(mains, mains[1:]):
            d = km((a["lat"], a["lng"]), (b["lat"], b["lng"]))
            if d <= MAX_SUBWAY_HOP_KM:
                edges.append([a["id"], b["id"], round(d, 3)])
        # 지선('211-1' 등): 같은 본선 코드 역에서 출발해 차례로 잇는다
        branches: dict[tuple, list[dict]] = {}
        for s in sts:
            k = code_key(s["fr"])
            if k[2]:
                branches.setdefault(k[:2], []).append(s)
        for base, bs in branches.items():
            root = next((s for s in mains if code_key(s["fr"])[:2] == base), None)
            chain = ([root] if root else []) + sorted(bs, key=lambda s: code_key(s["fr"]))
            for a, b in zip(chain, chain[1:]):
                d = km((a["lat"], a["lng"]), (b["lat"], b["lng"]))
                if d <= MAX_SUBWAY_HOP_KM:
                    edges.append([a["id"], b["id"], round(d, 3)])
        # 2호선 순환: 본선 처음·끝 역이 가까우면 잇는다
        if line == "2호선" and len(mains) > 2:
            a, b = mains[0], mains[-1]
            d = km((a["lat"], a["lng"]), (b["lat"], b["lng"]))
            if d <= MAX_SUBWAY_HOP_KM:
                edges.append([b["id"], a["id"], round(d, 3)])
    return uniq, edges, {"stations": len(uniq), "unmatched": unmatched, "lines": len(lines), "edges": len(edges)}


def build_bus(routes_dir: Path = ROUTES_DIR) -> tuple[list[dict], dict]:
    routes, kept_stops = [], 0
    for f in sorted(routes_dir.glob("*.json")):
        try:
            r = json.loads(f.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        stops = []
        for s in r.get("stops", []):
            if not isinstance(s, list) or len(s) < 4:
                continue
            seq, name, lat, lng = s[0], s[1], s[2], s[3]
            if in_seoul(lat, lng):
                stops.append([fe.clean_text(name, 40), round(lat, 5), round(lng, 5)])
            elif stops:
                stops.append(None)   # 서울 밖 구간: 끊김 표시(이 구간은 잇지 않음)
        while stops and stops[-1] is None:
            stops.pop()
        if sum(1 for s in stops if s) >= 2:
            no = fe.clean_text(r.get("no"), 12)
            routes.append({"no": no, "stops": stops})
            kept_stops += sum(1 for s in stops if s)
    return routes, {"routes": len(routes), "stops": kept_stops}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bus-only", action="store_true", help="지하철 수집 없이 버스만(기존 지하철 데이터 유지)")
    args = ap.parse_args()
    existing = {}
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
    subway = existing.get("subway") or {"stations": [], "edges": []}
    sub_stats = existing.get("stats", {}).get("subway", {})
    if not args.bus_only:
        key = os.environ.get("SEOUL_API_KEY", "").strip()
        if not fe.KEY_RE.match(key):
            print("SEOUL_API_KEY is missing or malformed.", file=sys.stderr)
            return 2
        try:
            line_rows = fetch_all(key, "SearchSTNBySubwayLineInfo")
            coord_rows = fetch_all(key, "subwayStationMaster")
        except fe.FetchError as e:
            print(f"Subway fetch failed: {e} - keeping previous subway data", file=sys.stderr)
        else:
            stations, edges, sub_stats = build_subway(line_rows, coord_rows)
            if stations and edges:
                subway = {"stations": stations, "edges": edges}
            else:
                print("Subway build produced no network - keeping previous data", file=sys.stderr)
    bus, bus_stats = build_bus()
    now = datetime.now(fe.KST).isoformat(timespec="seconds")
    fe.write_atomic(OUT_PATH, {"updatedAt": now, "estimated": True,
                               "source": {"subway": "서울 열린데이터광장 (지하철 역 정보·역사 마스터)", "bus": "서울 열린데이터광장 (버스 노선별 정류장 승하차)"},
                               "stats": {"subway": sub_stats, "bus": bus_stats}, "subway": subway, "bus": bus})
    print(f"transit network: subway {sub_stats}, bus {bus_stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
