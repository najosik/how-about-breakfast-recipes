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
    ("tbCycleStationInfo", []), ("bikeList", []),
    ("tbCycleRentUseMonthInfo", ["202607"]), ("tbCycleRentUseDayInfo", ["20260715"]),
    ("tbCycleStationUseMonthInfo", ["202607"]),
    ("tbCycleRentUseTimeInfo", ["2026-07-15"]), ("tbCycleRentUseTimeInfo", ["20260715"]),
    ("tbCycleRentData", ["2026-07-15"]), ("tbCycleRentData", ["2026-07-15", "00"]),
]


def short(v):
    s = str(v)
    return s if len(s) <= 40 else s[:37] + "..."


def main() -> int:
    key = (os.environ.get("SEOUL_BIKE_KEY") or os.environ.get("SEOUL_API_KEY") or "").strip()
    which = "SEOUL_BIKE_KEY" if os.environ.get("SEOUL_BIKE_KEY", "").strip() else "SEOUL_API_KEY"
    if not bf.KEY_RE.match(key):
        print("key missing or malformed")
        return 1
    out = [f"## 따릉이 데이터 탐색 2 (키: {which})", ""]
    for svc, args in CANDIDATES:
        url = "/".join([bf.API_BASE, key, "json", svc, "1", "2", *args]) + "/"
        label = f"{svc} {'/'.join(args)}"
        try:
            raw = bf.http_get(url, 2 * 1024 * 1024, label)
        except bf.FetchError as e:
            out.append(f"- **{label}**: {short(e)}")
            continue
        text = raw.decode("utf-8", "replace").replace(key, "***")   # 키가 되돌아와도 출력하지 않음
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            out.append(f"- **{label}**: JSON 아님: `{text[:160].replace(chr(10), ' ')}`")
            continue
        if not isinstance(data, dict):
            out.append(f"- **{label}**: 예상 밖 형식")
            continue
        root = [k for k in data if k != "RESULT"]
        res = data.get("RESULT") or {}
        line = f"- **{label}**: 최상위 {list(data)[:4]} RESULT={short(res.get('CODE', ''))} {short(res.get('MESSAGE', ''))}"
        for k in root:
            body = data[k]
            if isinstance(body, dict):
                rows = body.get("row") or []
                r0 = rows[0] if rows and isinstance(rows[0], dict) else {}
                line += f" | {k}: total={body.get('list_total_count')} 결과={short((body.get('RESULT') or {}).get('CODE', ''))}"
                if r0:
                    line += " | 표본 " + json.dumps({kk: short(v) for kk, v in r0.items()}, ensure_ascii=False)
        out.append(line)
    text = "\n".join(out)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
