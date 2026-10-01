#!/usr/bin/env python3
"""서울 버스 노선별 '외국인 관광객 이용 추정' 분석 → seoul-now/bus/data/bus-foreigner.json

방법(추정):
  정류장 승하차(노선·정류장·시간대, 월 합계) × 정류장이 속한 행정동의
  같은 시간대 '단기체류 외국인 비율' = 외국인 노출 추정 이용량.
  비율 = 단기체류 외국인 생활인구 ÷ (내국인 + 단기체류 외국인 생활인구), 해당 월 일평균.

데이터: 서울 열린데이터광장(CardBusTimeNew, busStopLocationXyInfo,
        SPOP_FORN_TEMP_RESD_DONG, SPOP_LOCAL_RESD_DONG) + 행정동 경계(vuski/admdongkor, 커밋·해시 고정).
보안: API 키는 환경변수로만 받고 로그·결과물에 남기지 않음. 외부 파일은 해시 검증.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API_BASE = "http://openapi.seoul.go.kr:8088"   # 서울 열린데이터광장은 HTTP만 지원
PAGE = 1000
TIMEOUT = 40
KST = timezone(timedelta(hours=9))
KEY_RE = re.compile(r"^[A-Za-z0-9]{10,100}$")

BOUNDARY_URL = ("https://raw.githubusercontent.com/vuski/admdongkor/"
                "dd1881663fcabc69b81393604e91ebf3a4202e9a/ver20260701/HangJeongDong_ver20260701.geojson")
BOUNDARY_SHA256 = "c01ef44a0eb00978662ba7a6240ccb1da287fb52abd85104a1758969d391132f"
BOUNDARY_VERSION = "admdongkor ver20260701"

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "bus" / "data" / "bus-foreigner.json"
MIN_ROUTE_USE = 30000      # 비중 지수 순위에 넣을 노선의 최소 월 승하차(소규모 노선 잡음 방지)
TOP_STOPS = 5


class FetchError(Exception):
    """API 키 등 민감정보를 포함하지 않는 오류."""


# ---------------------------------------------------------------- HTTP
def http_get(url: str, limit: int, label: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "seoul-now-analysis/1.0"})
    last = "unknown"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:  # noqa: S310 (고정 호스트)
                return r.read(limit)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            last = f"network error ({type(e.reason).__name__})"
        except TimeoutError:
            last = "timeout"
        time.sleep(2 ** (attempt + 1))
    raise FetchError(f"{label}: {last}")  # URL(키 포함)은 넣지 않는다


class SeoulApi:
    def __init__(self, key: str):
        if not KEY_RE.match(key):
            raise FetchError("SEOUL_API_KEY is missing or malformed")
        self._key = key
        self.calls = 0

    def page(self, service: str, start: int, end: int, *args: str) -> tuple[int, list[dict]]:
        parts = [self._key, "json", service, str(start), str(end), *args]
        raw = http_get(f"{API_BASE}/{'/'.join(parts)}/", 30 * 1024 * 1024, f"{service} {start}-{end}")
        self.calls += 1
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise FetchError(f"{service}: invalid JSON") from None
        body = data.get(service)
        if not isinstance(body, dict):
            code = str((data.get("RESULT") or {}).get("CODE", "UNKNOWN"))[:20]
            if code == "INFO-200":          # 해당 데이터 없음
                return 0, []
            raise FetchError(f"{service}: API error {code}")
        rows = [r for r in (body.get("row") or []) if isinstance(r, dict)]
        return int(body.get("list_total_count") or 0), rows

    def all_rows(self, service: str, *args: str, max_pages: int = 200):
        total, rows = self.page(service, 1, PAGE, *args)
        yield from rows
        pages = min(max_pages, (total + PAGE - 1) // PAGE)
        for p in range(2, pages + 1):
            s = (p - 1) * PAGE + 1
            _, rows = self.page(service, s, s + PAGE - 1, *args)
            yield from rows
            time.sleep(0.05)

    def has_data(self, service: str, *args: str) -> bool:
        total, _ = self.page(service, 1, 1, *args)
        return total > 0


# ---------------------------------------------------------------- 값 처리
def num(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if f == f and f >= 0 else 0.0   # NaN·음수 방지


def hour_value(row: dict, h: int, kind: str) -> float:
    """kind: 'ON'|'OFF'. 원천 항목명이 시간대마다 다름(HR_1_* 만 _NOPE)."""
    for suffix in ("TNOPE", "NOPE"):
        k = f"HR_{h}_GET_{kind}_{suffix}"
        if k in row:
            return num(row[k])
    return 0.0


def clean(v, limit=80) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", str(v or ""))).strip()[:limit]


# ---------------------------------------------------------------- 공간 처리
def point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def point_in_multipolygon(x: float, y: float, polys: list) -> bool:
    for poly in polys:  # poly = [outer, hole1, ...]
        if poly and point_in_ring(x, y, poly[0]) and not any(point_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


class DongIndex:
    def __init__(self, features: list[dict]):
        self.items = []
        for f in features:
            p, g = f.get("properties") or {}, f.get("geometry") or {}
            code = str(p.get("adm_cd2", ""))[:8]
            if not code.startswith("11"):
                continue
            polys = g.get("coordinates") if g.get("type") == "MultiPolygon" else [g.get("coordinates")]
            xs = [pt[0] for poly in polys for ring in poly for pt in ring]
            ys = [pt[1] for poly in polys for ring in poly for pt in ring]
            name = str(p.get("adm_nm", "")).replace("서울특별시 ", "")
            self.items.append((min(xs), min(ys), max(xs), max(ys), code, name, polys))

    def locate(self, x: float, y: float):
        for x0, y0, x1, y1, code, name, polys in self.items:
            if x0 <= x <= x1 and y0 <= y <= y1 and point_in_multipolygon(x, y, polys):
                return code, name
        return None, None


def load_boundary() -> DongIndex:
    raw = http_get(BOUNDARY_URL, 80 * 1024 * 1024, "boundary")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != BOUNDARY_SHA256:
        raise FetchError("boundary file hash mismatch - refusing to use it")
    return DongIndex(json.loads(raw.decode("utf-8"))["features"])


# ---------------------------------------------------------------- 수집
def month_days(ym: str) -> list[str]:
    y, m = int(ym[:4]), int(ym[4:])
    d = date(y, m, 1)
    out = []
    while d.month == m:
        out.append(d.strftime("%Y%m%d"))
        d += timedelta(days=1)
    return out


def pick_month(api: SeoulApi, today: date, override: str = "") -> str:
    if override:
        if not re.fullmatch(r"20\d{2}(0[1-9]|1[0-2])", override):
            raise FetchError("TARGET_YM must be YYYYMM")
        return override
    ym_date = today.replace(day=1)
    for _ in range(6):
        ym_date = (ym_date - timedelta(days=1)).replace(day=1)
        ym = ym_date.strftime("%Y%m")
        last_day = month_days(ym)[-1]
        if (api.has_data("SPOP_FORN_TEMP_RESD_DONG", last_day)
                and api.has_data("SPOP_LOCAL_RESD_DONG", last_day)
                and api.has_data("CardBusTimeNew", ym)):
            return ym
    raise FetchError("no month with both bus and living-population data in the last 6 months")


def living_population(api: SeoulApi, ym: str):
    """행정동×시간대 일평균: 단기체류 외국인(전체/중국/기타), 내국인."""
    sums = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])  # (dong, hour) -> [forn, china, etc, local]
    days_seen = set()
    for day in month_days(ym):
        n = 0
        for r in api.all_rows("SPOP_FORN_TEMP_RESD_DONG", day):
            k = (str(r.get("ADSTRD_CODE_SE", ""))[:8], int(num(r.get("TMZON_PD_SE"))))
            s = sums[k]
            s[0] += num(r.get("TOT_LVPOP_CO")); s[1] += num(r.get("CHINA_STAYPOP_CO")); s[2] += num(r.get("ETC_STAYPOP_CO"))
            n += 1
        for r in api.all_rows("SPOP_LOCAL_RESD_DONG", day):
            k = (str(r.get("ADSTRD_CODE_SE", ""))[:8], int(num(r.get("TMZON_PD_SE"))))
            sums[k][3] += num(r.get("TOT_LVPOP_CO"))
        if n:
            days_seen.add(day)
    nd = max(1, len(days_seen))
    return {k: [v / nd for v in vals] for k, vals in sums.items()}, len(days_seen)


# ---------------------------------------------------------------- 계산
def compute(bus_rows, stop_xy, dong_index, pop, hours=range(24)):
    """노선별 지표 계산. 테스트를 위해 수집과 분리."""
    stop_dong = {}
    for sid, (x, y) in stop_xy.items():
        stop_dong[sid] = dong_index.locate(x, y)

    def share(dong, h):
        f, c, e, l = pop.get((dong, h), (0.0, 0.0, 0.0, 0.0))
        denom = f + l
        return (f / denom, c / denom, e / denom) if denom > 0 else (0.0, 0.0, 0.0)

    routes = {}
    stops_used, stops_matched = set(), set()
    dong_names = {}
    for r in bus_rows:
        rno = clean(r.get("RTE_NO"), 20)
        sid = str(r.get("STOPS_ID", "")).strip()
        if not rno or not sid:
            continue
        stops_used.add(sid)
        dong, dname = stop_dong.get(sid, (None, None))
        if dong:
            stops_matched.add(sid)
            dong_names[dong] = dname
        rt = routes.setdefault(rno, {
            "no": rno, "name": clean(r.get("RTE_NM"), 80), "type": clean(r.get("TRFC_MNS_TYPE_NM"), 20),
            "use": 0.0, "exp": 0.0, "expChina": 0.0, "expEtc": 0.0,
            "hourUse": [0.0] * 24, "hourExp": [0.0] * 24, "stops": {},
        })
        st = rt["stops"].setdefault(sid, {"id": sid, "ars": clean(r.get("STOPS_ARS_NO"), 10),
                                          "name": clean(r.get("SBWY_STNS_NM"), 60), "dong": dname or "",
                                          "use": 0.0, "exp": 0.0})
        for h in hours:
            u = hour_value(r, h, "ON") + hour_value(r, h, "OFF")
            if not u:
                continue
            sh, shc, she = share(dong, h) if dong else (0.0, 0.0, 0.0)
            rt["use"] += u; rt["hourUse"][h] += u
            st["use"] += u
            if dong:
                rt["exp"] += u * sh; rt["expChina"] += u * shc; rt["expEtc"] += u * she
                rt["hourExp"][h] += u * sh
                st["exp"] += u * sh
    return routes, stops_used, stops_matched, dong_names


def summarize(routes, stops_used, stops_matched, dong_names, pop, ym, days, api_calls):
    total_use = sum(r["use"] for r in routes.values())
    total_exp = sum(r["exp"] for r in routes.values())
    city_index = total_exp / total_use if total_use else 0.0
    out_routes = []
    for r in routes.values():
        if r["use"] <= 0:
            continue
        idx = r["exp"] / r["use"]
        top = sorted(r["stops"].values(), key=lambda s: s["exp"], reverse=True)[:TOP_STOPS]
        out_routes.append({
            "no": r["no"], "name": r["name"], "type": r["type"],
            "use": round(r["use"]), "exp": round(r["exp"], 1),
            "index": round(idx, 5), "lift": round(idx / city_index, 3) if city_index else 0,
            "chinaShare": round(r["expChina"] / r["exp"], 3) if r["exp"] else 0,
            "eligible": r["use"] >= MIN_ROUTE_USE,
            "hourUse": [round(v) for v in r["hourUse"]],
            "hourExp": [round(v, 1) for v in r["hourExp"]],
            "topStops": [{"name": s["name"], "ars": s["ars"], "dong": s["dong"], "use": round(s["use"]),
                          "exp": round(s["exp"], 1), "index": round(s["exp"] / s["use"], 5) if s["use"] else 0}
                         for s in top],
        })
    out_routes.sort(key=lambda r: r["exp"], reverse=True)

    # 낮 시간(10~18시) 단기체류 외국인 비율 상위 행정동
    dong_rows = []
    for dong, name in dong_names.items():
        f = sum(pop.get((dong, h), (0, 0, 0, 0))[0] for h in range(10, 19))
        l = sum(pop.get((dong, h), (0, 0, 0, 0))[3] for h in range(10, 19))
        if f + l > 0:
            dong_rows.append({"code": dong, "name": name, "share": round(f / (f + l), 4), "foreign": round(f / 9)})
    dong_rows.sort(key=lambda d: d["share"], reverse=True)

    return {
        "month": ym,
        "generatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "method": "exposure = sum(boardings+alightings x short-stay foreigner share of the stop's dong at that hour)",
        "minRouteUse": MIN_ROUTE_USE,
        "cityIndex": round(city_index, 5),
        "stats": {
            "routes": len(out_routes), "stops": len(stops_used), "stopsMatched": len(stops_matched),
            "matchRate": round(len(stops_matched) / len(stops_used), 4) if stops_used else 0,
            "populationDays": days, "totalUse": round(total_use), "apiCalls": api_calls,
        },
        "sources": [
            "서울 열린데이터광장: 서울시 버스노선별 정류장별 시간대별 승하차 인원 정보 (CardBusTimeNew)",
            "서울 열린데이터광장: 서울시 버스정류소 위치정보 (busStopLocationXyInfo)",
            "서울 열린데이터광장: 행정동 단위 서울 생활인구(단기체류 외국인) (SPOP_FORN_TEMP_RESD_DONG)",
            "서울 열린데이터광장: 행정동 단위 서울 생활인구(내국인) (SPOP_LOCAL_RESD_DONG)",
            f"행정동 경계: {BOUNDARY_VERSION} (github.com/vuski/admdongkor)",
        ],
        "topDongs": dong_rows[:20],
        "routes": out_routes,
    }


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".bus-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> int:
    try:
        api = SeoulApi(os.environ.get("SEOUL_API_KEY", "").strip())
        ym = pick_month(api, datetime.now(KST).date(), os.environ.get("TARGET_YM", "").strip())
        if OUT_PATH.exists() and not os.environ.get("FORCE"):
            try:
                if json.loads(OUT_PATH.read_text("utf-8")).get("month") == ym:
                    print(f"{ym} already analyzed; nothing to do.")
                    return 0
            except (OSError, json.JSONDecodeError):
                pass
        print(f"Target month: {ym}")
        dongs = load_boundary()
        print(f"Boundary: {len(dongs.items)} Seoul dongs")
        stop_xy = {}
        for r in api.all_rows("busStopLocationXyInfo"):
            x, y = num(r.get("XCRD")), num(r.get("YCRD"))
            if 126.5 < x < 127.5 and 37.3 < y < 37.8:
                stop_xy[str(r.get("STOPS_NO", "")).strip()] = (x, y)
        print(f"Stops with coordinates: {len(stop_xy)}")
        bus_rows = list(api.all_rows("CardBusTimeNew", ym))
        print(f"Bus rows: {len(bus_rows)}")
        pop, days = living_population(api, ym)
        print(f"Population: {len(pop)} dong-hours over {days} days")
        if not bus_rows or days < 20:
            raise FetchError("insufficient data for the target month")
        routes, used, matched, names = compute(bus_rows, stop_xy, dongs, pop)
        result = summarize(routes, used, matched, names, pop, ym, days, api.calls)
    except FetchError as e:
        print(f"Analysis failed: {e}", file=sys.stderr)
        return 1
    if result["stats"]["matchRate"] < 0.8:
        print(f"Stop match rate too low ({result['stats']['matchRate']:.1%}); not saving.", file=sys.stderr)
        return 1
    write_atomic(OUT_PATH, result)
    print(f"Saved {result['stats']['routes']} routes; match rate {result['stats']['matchRate']:.1%}; "
          f"city index {result['cityIndex']:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
