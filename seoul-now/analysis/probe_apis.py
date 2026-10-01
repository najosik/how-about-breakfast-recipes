#!/usr/bin/env python3
"""임시: 서울 열린데이터광장 API의 서비스명·항목명·최신 데이터 시점 확인용.

각 후보 서비스에서 몇 건만 받아 결과 코드, 항목 이름, 샘플 값을 출력합니다.
API 키는 출력하지 않습니다. 분석 스크립트 작성 후 삭제 예정.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

API = "http://openapi.seoul.go.kr:8088"
KEY = os.environ.get("SEOUL_API_KEY", "").strip()
KST = timezone(timedelta(hours=9))
today = datetime.now(KST).date()


def call(service, *args, start=1, end=3):
    path = "/".join([KEY, "json", service, str(start), str(end), *[str(a) for a in args]])
    try:
        with urllib.request.urlopen(f"{API}/{path}/", timeout=30) as r:
            return json.loads(r.read(5_000_000).decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as e:
        return {"_error": type(e).__name__}


def summarize(label, service, *args):
    data = call(service, *args)
    body = data.get(service) if isinstance(data, dict) else None
    if isinstance(body, dict):
        rows = body.get("row") or []
        print(f"[OK] {label} {service} args={args} total={body.get('list_total_count')} "
              f"code={(body.get('RESULT') or {}).get('CODE')}")
        if rows:
            print("     fields:", list(rows[0].keys()))
            print("     sample:", json.dumps(rows[0], ensure_ascii=False)[:600])
        return True
    res = data.get("RESULT") or {}
    print(f"[--] {label} {service} args={args} -> {res.get('CODE') or data.get('_error')} {res.get('MESSAGE', '')}")
    return False


def main():
    if not KEY:
        print("SEOUL_API_KEY missing"); return 1

    print("== 버스 노선별 정류장별 시간대별 승하차 (월 단위) ==")
    for svc in ("CardBusTimeNew",):
        for m in range(0, 4):
            ym = (today.replace(day=1) - timedelta(days=28 * m)).strftime("%Y%m")
            if summarize("bus-time", svc, ym):
                break
            time.sleep(0.3)

    print("== 버스 노선별 정류장별 일별 승하차 ==")
    for back in (3, 5, 7, 10):
        if summarize("bus-daily", "CardBusStatisticsServiceNew", (today - timedelta(days=back)).strftime("%Y%m%d")):
            break

    print("== 생활인구: 단기체류 외국인(행정동) / 내국인(행정동) ==")
    for svc in ("SPOP_FORN_TEMP_RESD_DONG", "SPOP_LOCAL_RESD_DONG"):
        for back in (3, 5, 7, 10, 14, 21, 30):
            if summarize("spop", svc, (today - timedelta(days=back)).strftime("%Y%m%d")):
                break
            time.sleep(0.3)

    print("== 버스 정류소 위치 ==")
    for svc in ("busStopLocationXyInfo", "TbBusStationInfo", "busStopLocation"):
        summarize("stop-xy", svc)
        time.sleep(0.3)
    return 0


if __name__ == "__main__":
    sys.exit(main())
