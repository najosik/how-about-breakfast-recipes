#!/usr/bin/env python3
"""1회 탐색: 따릉이 관련 서울 열린데이터광장 서비스의 존재·건수·항목명만 출력(저장소에 쓰지 않음).

키는 환경변수(SEOUL_BIKE_KEY 우선, 없으면 SEOUL_API_KEY)로만 받고 출력·오류에 넣지 않는다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bus_foreigner as bf  # noqa: E402  (SeoulApi·http_get 재사용: 재시도·키 비노출)

CANDIDATES = [
    ("tbCycleStationInfo", []), ("bikeStationMaster", []), ("bikeList", []),
    ("tbCycleRentUseMonthInfo", ["202607"]), ("tbCycleRentUseDayInfo", ["20260715"]),
    ("tbCycleRentUseTimeInfo", ["20260715"]), ("tbCycleRentUseTimeInfo", ["202607"]),
    ("tbCycleStationUseMonthInfo", ["202607"]), ("tbCycleRentData", ["2026-07-15"]),
    ("tbCycleRentData", ["20260715"]), ("tbCycleUseStatusInfo", ["202607"]),
]


def short(v):
    s = str(v)
    return s if len(s) <= 40 else s[:37] + "..."


def main() -> int:
    key = (os.environ.get("SEOUL_BIKE_KEY") or os.environ.get("SEOUL_API_KEY") or "").strip()
    which = "SEOUL_BIKE_KEY" if os.environ.get("SEOUL_BIKE_KEY", "").strip() else "SEOUL_API_KEY"
    api = bf.SeoulApi(key)
    out = [f"## 따릉이 데이터 탐색 (키: {which})", "", "| 서비스 | 인자 | 결과 | 건수 | 항목 |", "|---|---|---|---:|---|"]
    samples = []
    for svc, args in CANDIDATES:
        try:
            total, rows = api.page(svc, 1, 3, *args)
            fields = ", ".join(rows[0].keys()) if rows else ""
            out.append(f"| {svc} | {'/'.join(args)} | OK | {total} | {fields} |")
            if rows:
                samples.append(f"**{svc} {'/'.join(args)}**: " + json.dumps({k: short(v) for k, v in rows[0].items()}, ensure_ascii=False))
        except bf.FetchError as e:
            out.append(f"| {svc} | {'/'.join(args)} | {short(e)} | | |")
    text = "\n".join(out + ["", "### 표본 1행", ""] + samples)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
