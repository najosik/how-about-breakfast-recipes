#!/usr/bin/env python3
"""임시: 생활인구 데이터셋 페이지에서 OpenAPI 서비스명·샘플 URL을 찾아 실제 호출해 봅니다.

API 키는 출력하지 않습니다. 분석 스크립트 작성 후 삭제 예정.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

API = "http://openapi.seoul.go.kr:8088"
KEY = os.environ.get("SEOUL_API_KEY", "").strip()
KST = timezone(timedelta(hours=9))
today = datetime.now(KST).date()
DATASETS = ["OA-14991", "OA-14992", "OA-14993"]
SAMPLE_RE = re.compile(r"openapi\.seoul\.go\.kr:8088/sample/(?:xml|json)/([A-Za-z0-9_]+)/1/5/?([^\"'<>\s]*)")
TITLE_RE = re.compile(r"<title>([^<]*)</title>", re.S)


def get(url, limit=3_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 seoul-now-probe"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(limit).decode("utf-8", "replace")


def call(service, *args):
    path = "/".join([KEY, "json", service, "1", "3", *[str(a) for a in args]])
    try:
        return json.loads(get(f"{API}/{path}/", 5_000_000))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return {"_error": type(e).__name__}


def report(service, args):
    data = call(service, *args)
    body = data.get(service) if isinstance(data, dict) else None
    if isinstance(body, dict) and body.get("row"):
        row = body["row"][0]
        print(f"   [OK] {service} args={args} total={body.get('list_total_count')}")
        print("        fields:", list(row.keys()))
        print("        sample:", json.dumps(row, ensure_ascii=False)[:500])
        return True
    res = (data.get("RESULT") or (body or {}).get("RESULT") or {}) if isinstance(data, dict) else {}
    print(f"   [--] {service} args={args} -> {res.get('CODE') or data.get('_error')} {res.get('MESSAGE', '')}")
    return False


def count(svc, ymd):
    data = call(svc, ymd)
    body = data.get(svc) if isinstance(data, dict) else None
    return int(body.get("list_total_count") or 0) if isinstance(body, dict) else 0


def main():
    if not KEY:
        print("SEOUL_API_KEY missing"); return 1
    months = [f"{y}{m:02d}" for y in range(2019, 2027) for m in range(1, 13) if f"{y}{m:02d}" <= today.strftime("%Y%m")]
    for svc in ("SPOP_FORN_TEMP_RESD_DONG", "SPOP_LOCAL_RESD_DONG"):
        have = []
        for ym in months:
            n = count(svc, ym + "15")
            if n:
                have.append(ym)
            time.sleep(0.15)
        print(f"== {svc}: months with data on the 15th ({len(have)}) ==")
        print("   ", have)
        if have:
            last = have[-1]
            y, m = int(last[:4]), int(last[4:])
            days = [f"{last}{d:02d}" for d in range(1, 32)]
            nxt = f"{y + (m == 12)}{(m % 12) + 1:02d}"
            days += [f"{nxt}{d:02d}" for d in range(1, 16)]
            avail = [d for d in days if count(svc, d)]
            print("    latest days:", avail[-5:], "| rows/day:", count(svc, avail[-1]) if avail else 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
