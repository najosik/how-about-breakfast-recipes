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
    for ds in DATASETS:
        print(f"== {ds} ==")
        try:
            html = get(f"https://data.seoul.go.kr/dataList/{ds}/S/1/datasetView.do")
        except (urllib.error.URLError, TimeoutError) as e:
            print("   page fetch failed:", type(e).__name__); continue
        t = TITLE_RE.search(html)
        print("   title:", re.sub(r"\s+", " ", t.group(1)).strip()[:120] if t else "?")
        samples = sorted(set(SAMPLE_RE.findall(html)))
        print("   sample urls:", samples[:5])
        for svc, tail in samples[:2]:
            # 1) 샘플 URL의 인자 그대로, 2) 인자 없이, 3) 최근 날짜들
            report(svc, [a for a in tail.split("/") if a])
            report(svc, [])
            for back in (5, 10, 20, 35, 50, 70):
                if report(svc, [(today - timedelta(days=back)).strftime("%Y%m%d")]):
                    break
                time.sleep(0.3)
    return 0


if __name__ == "__main__":
    sys.exit(main())
