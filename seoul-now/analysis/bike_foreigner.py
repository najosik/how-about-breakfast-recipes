#!/usr/bin/env python3
"""따릉이 대여소별 '외국인·내국인 이용 추정' → seoul-now/bike/data/bike-foreigner.json

방법(추정):
  대여소 월 대여 건수(tbCycleStationUseMonthInfo, 대여소별 월 집계)
  × 대여소가 속한 행정동의 단기체류 외국인 비율(버스 분석이 저장한 dong-hourly.json, 07~22시 일평균)
  = 외국인 추정 이용, 나머지 = 내국인 추정 이용.
  보조 지표: 일일권(비회원 포함) 비율 — 정기권보다 관광·단기 이용 성격이 강함.
           tbCycleRentUseMonthInfo(약 11만 행, 응답이 느림)에서 시간 예산 안에서만 수집하고, 넘기면 생략한다.

데이터: 서울 열린데이터광장 tbCycleStationInfo(대여소 위치), tbCycleStationUseMonthInfo(대여소별 월 대여),
        tbCycleRentUseMonthInfo(이용권별 월 이용 집계, 일일권 비율용)
        + seoul-now/bus/data/dongs.geojson(행정동 경계) + dong-hourly.json(행정동×시간대 생활인구).
개인정보: 집계 데이터만 사용한다(개인 단위 대여이력 tbCycleRentData는 쓰지 않음). 성별·연령 항목은 합산 후 버린다.
보안: API 키는 환경변수로만 받고 로그·결과물에 남기지 않음(bus_foreigner.SeoulApi 재사용: 재시도·키 비노출).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bus_foreigner as bf  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BUS_DATA = ROOT / "bus" / "data"
OUT_PATH = ROOT / "bike" / "data" / "bike-foreigner.json"
SHARE_HOURS = range(7, 23)      # 따릉이 이용이 몰리는 07~22시
MIN_USE = 30                    # 비율 순위에 넣을 최소 월 대여 건수(소규모 대여소 잡음 방지)
TOP = 30
NO_RE = re.compile(r"^\d{1,6}$")
NAME_NO_RE = re.compile(r"^\s*(\d{1,6})\s*\.")   # '108. 서교동 사거리' → 108
DAYPASS_BUDGET = 600            # 초. 일일권 비율 수집 시간 상한


def dong_index_from_geojson(gj: dict) -> bf.DongIndex:
    """버스 분석이 저장한 단순화 경계(dongs.geojson)를 DongIndex 형태로."""
    feats = []
    for f in gj.get("features") or []:
        p = f.get("properties") or {}
        code, name = str(p.get("code", "")), str(p.get("name", ""))
        if not re.fullmatch(r"11\d{6}", code) or not name:
            continue
        feats.append({"properties": {"adm_cd2": code + "00", "adm_nm": "서울특별시 " + name},
                      "geometry": f.get("geometry") or {}})
    return bf.DongIndex(feats)


def dong_shares(hourly: dict, hours=SHARE_HOURS) -> dict[str, float]:
    """행정동별 단기체류 외국인 비율 = Σf ÷ Σ(f+l), 지정 시간대·전체 일 평균."""
    out = {}
    for code, row in (hourly.get("dongs") or {}).items():
        a = row.get("all") or {}
        fs, ls = a.get("f") or [], a.get("l") or []
        if len(fs) != 24 or len(ls) != 24:
            continue
        f = sum(bf.num(fs[h]) for h in hours)
        t = f + sum(bf.num(ls[h]) for h in hours)
        if t > 0:
            out[code] = f / t
    return out


def station_no(v) -> str:
    """대여소 번호 정규화: '00108' / '108' → '108'."""
    s = str(v or "").strip()
    return str(int(s)) if NO_RE.match(s) else ""


def station_use(rows) -> dict[str, float]:
    """tbCycleStationUseMonthInfo: 대여소 이름 앞 번호로 대여소를 찾아 월 대여 건수 합산."""
    out = defaultdict(float)
    for r in rows:
        m = NAME_NO_RE.match(str(r.get("stationName", "")))
        if m:
            out[str(int(m.group(1)))] += bf.num(r.get("rentCnt"))
    return dict(out)


def day_pass_ratio(api, ym: str, budget: float = DAYPASS_BUDGET) -> dict[str, float] | None:
    """일일권 비율(대여소별). 시간 예산을 넘기면 None(지표 생략)."""
    deadline = time.monotonic() + budget
    rows = []
    for i, r in enumerate(api.all_rows("tbCycleRentUseMonthInfo", ym, root="cycleRentUseMonthInfo")):
        rows.append(r)
        if i % 10000 == 9999:
            print(f"  day-pass rows: {i + 1}", flush=True)
            if time.monotonic() > deadline:
                print("  day-pass budget exceeded; skipping", flush=True)
                return None
    agg = aggregate_use(rows)
    return {no: v["day"] / v["use"] for no, v in agg.items() if v["use"] > 0}


def aggregate_use(rows) -> dict[str, dict]:
    """대여소별 월 대여 합계와 일일권 건수. 성별·연령은 합산만 하고 남기지 않는다."""
    use = defaultdict(lambda: {"use": 0.0, "day": 0.0})
    for r in rows:
        no = station_no(r.get("STATION_NO"))
        if not no:
            continue
        n = bf.num(r.get("USE_CNT"))
        use[no]["use"] += n
        if "일일" in str(r.get("RENT_TYPE", "")):
            use[no]["day"] += n
    return use


def compute(stations: list[dict], use: dict, dong_index, shares: dict, day: dict | None = None) -> tuple[list[dict], dict]:
    """use: 대여소 번호 → 월 대여 건수. day: 대여소 번호 → 일일권 비율(없으면 null)."""
    out, unmatched_use, total = [], 0.0, 0.0
    for s in stations:
        u = use.get(s["no"]) or 0.0
        if u <= 0:
            continue
        total += u
        code, name = dong_index.locate(s["lng"], s["lat"])
        share = shares.get(code) if code else None
        if share is None:
            unmatched_use += u
            continue
        f = u * share
        dp = day.get(s["no"]) if day else None
        out.append({"no": s["no"], "name": s["name"], "gu": s["gu"], "dong": name, "lat": s["lat"], "lng": s["lng"],
                    "use": round(u), "dayPass": round(dp, 4) if dp is not None else None,
                    "share": round(share, 4), "foreign": round(f, 1), "local": round(u - f, 1)})
    out.sort(key=lambda x: x["foreign"], reverse=True)
    stats = {"stations": len(out), "totalUse": round(total),
             "matchRate": round(1 - unmatched_use / total, 4) if total else 0,
             "foreign": round(sum(x["foreign"] for x in out)), "local": round(sum(x["local"] for x in out))}
    return out, stats


def parse_stations(rows) -> list[dict]:
    out = []
    for r in rows:
        no = station_no(r.get("RENT_NO"))
        lat, lng = bf.num(r.get("STA_LAT")), bf.num(r.get("STA_LONG"))
        if not no or not (37.3 < lat < 37.8 and 126.5 < lng < 127.5):
            continue
        name = bf.clean(r.get("RENT_NM"), 60)
        out.append({"no": no, "name": name, "gu": bf.clean(r.get("STA_LOC"), 10), "lat": round(lat, 6), "lng": round(lng, 6)})
    return out


def dong_table(rows: list[dict]) -> list[dict]:
    """행정동별 합계(따릉이 외국인 추정 이용 상위)."""
    d = defaultdict(lambda: {"use": 0.0, "foreign": 0.0, "stations": 0, "share": 0.0})
    for r in rows:
        x = d[r["dong"]]
        x["use"] += r["use"]; x["foreign"] += r["foreign"]; x["stations"] += 1; x["share"] = r["share"]
    res = [{"dong": k, "use": round(v["use"]), "foreign": round(v["foreign"], 1), "stations": v["stations"], "share": v["share"]}
           for k, v in d.items()]
    res.sort(key=lambda x: x["foreign"], reverse=True)
    return res[:TOP]


def main() -> int:
    hourly = json.loads((BUS_DATA / "dong-hourly.json").read_text("utf-8"))
    pop_ym = str(hourly.get("month", ""))
    ym = os.environ.get("TARGET_YM", "").strip() or pop_ym
    if not re.fullmatch(r"20\d{2}(0[1-9]|1[0-2])", ym):
        print("target month must be YYYYMM", file=sys.stderr)
        return 1
    if OUT_PATH.exists() and not os.environ.get("FORCE"):
        try:
            prev = json.loads(OUT_PATH.read_text("utf-8"))
            if prev.get("month") == ym and prev.get("popMonth") == pop_ym:
                print(f"{ym} already analyzed; nothing to do.")
                return 0
        except (OSError, json.JSONDecodeError):
            pass
    try:
        api = bf.SeoulApi(os.environ.get("SEOUL_API_KEY", "").strip())
        stations = parse_stations(api.all_rows("tbCycleStationInfo", root="stationInfo"))
        print(f"Stations with coordinates: {len(stations)}", flush=True)
        use = station_use(api.all_rows("tbCycleStationUseMonthInfo", ym, root="stationUseMonthInfo"))
        print(f"Stations with use in {ym}: {len(use)}", flush=True)
    except bf.FetchError as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        return 1
    try:
        day = day_pass_ratio(api, ym)
    except bf.FetchError as e:   # 보조 지표라 실패해도 계속
        print(f"Day-pass ratio skipped: {e}", flush=True)
        day = None
    dong_index = dong_index_from_geojson(json.loads((BUS_DATA / "dongs.geojson").read_text("utf-8")))
    shares = dong_shares(hourly)
    rows, stats = compute(stations, use, dong_index, shares, day)
    if stats["matchRate"] < 0.8:
        print(f"Match rate too low ({stats['matchRate']:.1%}); not saving.", file=sys.stderr)
        return 1
    city = stats["foreign"] / (stats["foreign"] + stats["local"]) if rows else 0
    result = {
        "month": ym, "popMonth": pop_ym, "generatedAt": datetime.now(bf.KST).isoformat(timespec="seconds"),
        "method": "foreign = monthly rentals x short-stay foreigner share of the station's dong (07-22h, all days)",
        "shareHours": [SHARE_HOURS.start, SHARE_HOURS.stop - 1], "minUse": MIN_USE, "cityShare": round(city, 5),
        "stats": {**stats, "apiCalls": api.calls},
        "dayPass": day is not None,
        "sources": ["서울 열린데이터광장: 서울시 공공자전거 대여소 정보 (tbCycleStationInfo)",
                    "서울 열린데이터광장: 서울시 공공자전거 대여소별 이용정보(월별) (tbCycleStationUseMonthInfo)",
                    "서울 열린데이터광장: 서울시 공공자전거 이용정보(월별) (tbCycleRentUseMonthInfo, 일일권 비율)",
                    "서울 열린데이터광장: 행정동 단위 서울 생활인구(단기체류 외국인·내국인)",
                    f"행정동 경계: {bf.BOUNDARY_VERSION} (github.com/vuski/admdongkor)"],
        "dongs": dong_table(rows),
        "stations": rows,
    }
    bf.write_atomic(OUT_PATH, result)
    print(f"Saved {stats['stations']} stations; match {stats['matchRate']:.1%}; foreign share {city:.2%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
