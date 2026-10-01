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


def main():
    if not KEY:
        print("SEOUL_API_KEY missing"); return 1
    for svc in ("SPOP_FORN_TEMP_RESD_DONG", "SPOP_LOCAL_RESD_DONG"):
        print(f"== {svc} ==")
        data = call(svc)
        body = data.get(svc) if isinstance(data, dict) else None
        if not (isinstance(body, dict) and body.get("row")):
            report(svc, []); continue
        row = body["row"][0]
        print("   total:", body.get("list_total_count"))
        print("   fields:", list(row.keys()))
        print("   sample:", json.dumps(row, ensure_ascii=False)[:700])
        # 날짜 필터 형식 확인: 첫 행의 기준일 값으로 다시 호출
        date_val = next((str(v) for k, v in row.items() if "DE" in k.upper() and str(v).isdigit()), "")
        if date_val:
            report(svc, [date_val])
        time.sleep(0.3)
    return 0


if __name__ == "__main__":
    sys.exit(main())
