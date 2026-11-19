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
BEHAVIOR_BUDGET = 4200         # 초. 이용권 집계(약 11만 행, 응답이 느림) 수집 시간 상한. 환경변수로 바꿀 수 있음
SMOOTH_K = 50                   # 평활: 대여 50건만큼 서울 평균을 섞음


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


def behavior(api, ym: str, budget: float | None = None) -> dict | None:
    """대여소별 이용권 집계(tbCycleRentUseMonthInfo). 시간 예산을 넘기면 None.
    visitor 신호: 이용권 이름에 '비회원'이 있으면 그것, 없으면 '일일'(일일권 전체).
    성별·연령은 서울 전체 합계만 남기고(투명성 확인용) 대여소 단위로는 남기지 않는다."""
    budget = float(os.environ.get("BEHAVIOR_BUDGET", BEHAVIOR_BUDGET)) if budget is None else budget
    deadline = time.monotonic() + budget
    st = defaultdict(lambda: [0.0, 0.0, 0.0])   # no -> [use, 비회원, 일일]
    types, ages = defaultdict(float), defaultdict(float)
    start = time.monotonic()
    for i, r in enumerate(api.all_rows("tbCycleRentUseMonthInfo", ym, root="cycleRentUseMonthInfo")):
        if i % 1000 == 999:
            print(f"  behavior rows: {i + 1} ({time.monotonic() - start:.0f}s)", flush=True)
            if time.monotonic() > deadline:
                print("  behavior budget exceeded; skipping", flush=True)
                return None
        no = station_no(r.get("STATION_NO"))
        n = bf.num(r.get("USE_CNT"))
        typ = bf.clean(r.get("RENT_TYPE"), 20) or "(없음)"
        types[typ] += n
        ages[bf.clean(r.get("AGE_TYPE"), 10) or "(없음)"] += n
        if not no:
            continue
        x = st[no]
        x[0] += n
        if "비회원" in typ:
            x[1] += n
        if "일일" in typ:
            x[2] += n
    signal = "비회원" if any("비회원" in t for t in types) else "일일"
    idx = 1 if signal == "비회원" else 2
    return {"signal": signal,
            "stations": {no: {"use": v[0], "visitor": v[idx], "day": v[2]} for no, v in st.items() if v[0] > 0},
            "rentTypes": {k: round(v) for k, v in sorted(types.items(), key=lambda kv: -kv[1])},
            "ageTypes": {k: round(v) for k, v in sorted(ages.items(), key=lambda kv: -kv[1])}}


def adjust(rows: list[dict], beh: dict | None, k: float = SMOOTH_K, lo: float = 0.2, hi: float = 5.0) -> dict | None:
    """행태 보정: 대여소의 관광형 이용권 비율이 서울 평균보다 높으면 외국인 추정을 올리고, 낮으면 내린다.
    - 작은 대여소는 서울 평균 쪽으로 당겨(평활 k건) 우연한 값에 휘둘리지 않게 한다.
    - 배수는 lo~hi로 제한하고, 서울 전체 외국인 추정 합계는 보정 전과 같게 맞춘다(배분만 바꿈).
    rows를 제자리에서 고치고 요약을 돌려준다. beh가 없으면 아무것도 하지 않는다."""
    if not beh or not beh.get("stations"):
        return None
    bs = beh["stations"]
    tu = sum(v["use"] for v in bs.values())
    vbar = sum(v["visitor"] for v in bs.values()) / tu if tu else 0
    if vbar <= 0:
        return None
    base_total, raw = 0.0, []
    for r in rows:
        b = bs.get(r["no"])
        if b:
            v = (b["visitor"] + k * vbar) / (b["use"] + k)
            m = min(hi, max(lo, v / vbar))
            r["visitorRatio"] = round(b["visitor"] / b["use"], 4)
            r["dayPass"] = round(b["day"] / b["use"], 4)
        else:
            m = 1.0
            r["visitorRatio"] = None
        r["mult"] = round(m, 3)
        base_total += r["foreignBase"]
        raw.append(r["foreignBase"] * m)
    scale = base_total / sum(raw) if sum(raw) else 1.0
    for r, x in zip(rows, raw):
        f = min(x * scale, r["use"] * 0.95)
        r["foreign"], r["local"] = round(f, 1), round(r["use"] - f, 1)
    rows.sort(key=lambda x: x["foreign"], reverse=True)
    return {"signal": beh["signal"], "cityVisitorRatio": round(vbar, 5), "smoothK": k, "clamp": [lo, hi],
            "rentTypes": beh["rentTypes"], "ageTypes": beh["ageTypes"]}


def compute(stations: list[dict], use: dict, dong_index, shares: dict) -> tuple[list[dict], dict]:
    """1단계(동네 비율): use(대여소 번호 → 월 대여) × 행정동 외국인 비율. 행태 보정은 adjust()에서."""
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
        out.append({"no": s["no"], "name": s["name"], "gu": s["gu"], "dong": name, "lat": s["lat"], "lng": s["lng"],
                    "use": round(u), "dayPass": None, "visitorRatio": None, "mult": 1.0,
                    "share": round(share, 4), "foreignBase": round(f, 1), "foreign": round(f, 1), "local": round(u - f, 1)})
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
    d = defaultdict(lambda: {"use": 0.0, "foreign": 0.0, "base": 0.0, "stations": 0, "share": 0.0})
    for r in rows:
        x = d[r["dong"]]
        x["use"] += r["use"]; x["foreign"] += r["foreign"]; x["base"] += r["foreignBase"]; x["stations"] += 1; x["share"] = r["share"]
    res = [{"dong": k, "use": round(v["use"]), "foreign": round(v["foreign"], 1), "foreignBase": round(v["base"], 1),
            "stations": v["stations"], "share": v["share"]}
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
        beh = behavior(api, ym)
    except bf.FetchError as e:   # 보정용이라 실패해도 1단계 결과는 저장
        print(f"Behavior data skipped: {e}", flush=True)
        beh = None
    dong_index = dong_index_from_geojson(json.loads((BUS_DATA / "dongs.geojson").read_text("utf-8")))
    shares = dong_shares(hourly)
    rows, stats = compute(stations, use, dong_index, shares)
    adj = adjust(rows, beh)
    stats["foreign"] = round(sum(x["foreign"] for x in rows))
    stats["local"] = round(sum(x["local"] for x in rows))
    if stats["matchRate"] < 0.8:
        print(f"Match rate too low ({stats['matchRate']:.1%}); not saving.", file=sys.stderr)
        return 1
    city = stats["foreign"] / (stats["foreign"] + stats["local"]) if rows else 0
    result = {
        "month": ym, "popMonth": pop_ym, "generatedAt": datetime.now(bf.KST).isoformat(timespec="seconds"),
        "method": ("base = monthly rentals x short-stay foreigner share of the station's dong (07-22h); "
                   "foreign = base x clamp(smoothed station visitor-pass ratio / city ratio), rescaled to the city base total"),
        "shareHours": [SHARE_HOURS.start, SHARE_HOURS.stop - 1], "minUse": MIN_USE, "cityShare": round(city, 5),
        "stats": {**stats, "apiCalls": api.calls},
        "dayPass": adj is not None,
        "adjust": adj,
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
